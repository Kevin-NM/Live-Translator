import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TranslationJob:
    session_id: int
    segment_id: int
    source_text: str
    source_language: str
    mode: str = "realtime"


@dataclass
class TranslationJobResult:
    session_id: int
    segment_id: int
    translated_text: str
    provider_name: str
    model: str
    latency_ms: float
    status: str
    error_message: Optional[str] = None


WORKER_COUNT = 3
HARD_TIMEOUT_SECONDS = 15.0


class TranslationPipeline:
    def __init__(self):
        self._queue: asyncio.Queue[TranslationJob] = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self._on_result_callbacks: list = []
        self._active_jobs = 0
        self._timeout_count = 0
        self._last_error = ""

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    @property
    def active_jobs(self) -> int:
        return self._active_jobs

    @property
    def timeout_count(self) -> int:
        return self._timeout_count

    @property
    def last_error(self) -> str:
        return self._last_error

    def on_result(self, callback):
        self._on_result_callbacks.append(callback)

    def remove_callback(self, callback):
        if callback in self._on_result_callbacks:
            self._on_result_callbacks.remove(callback)

    async def start(self):
        if self._running:
            return
        self._running = True
        for i in range(WORKER_COUNT):
            task = asyncio.create_task(self._process_loop(f"worker-{i}"))
            self._tasks.append(task)
        logger.info(f"Translation pipeline started with {WORKER_COUNT} workers")

    async def stop(self):
        self._running = False
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("Translation pipeline stopped")

    async def submit(self, job: TranslationJob):
        await self._queue.put(job)
        logger.debug(f"Translation job queued: session={job.session_id} segment={job.segment_id} queue_size={self._queue.qsize()}")

    async def _process_loop(self, worker_name: str):
        logger.info(f"Translation worker {worker_name} started")
        while self._running:
            try:
                job = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            self._active_jobs += 1
            try:
                result = await asyncio.wait_for(
                    self._translate_job(job),
                    timeout=HARD_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                self._timeout_count += 1
                self._last_error = f"Job timed out after {HARD_TIMEOUT_SECONDS}s"
                logger.error(f"Translation job timed out: session={job.session_id} segment={job.segment_id}")
                result = TranslationJobResult(
                    session_id=job.session_id, segment_id=job.segment_id,
                    translated_text="", provider_name="", model="",
                    latency_ms=HARD_TIMEOUT_SECONDS * 1000, status="error",
                    error_message=f"Translation timed out after {HARD_TIMEOUT_SECONDS}s",
                )
                self._update_segment_error(job, result.error_message)
            except Exception as e:
                self._last_error = str(e)
                logger.error(f"Translation worker {worker_name} exception: {e}")
                result = TranslationJobResult(
                    session_id=job.session_id, segment_id=job.segment_id,
                    translated_text="", provider_name="", model="",
                    latency_ms=0, status="error", error_message=str(e),
                )
                self._update_segment_error(job, str(e))
            finally:
                self._active_jobs -= 1

            for cb in self._on_result_callbacks:
                try:
                    await cb(result)
                except Exception as e:
                    logger.error(f"Translation result callback error: {e}")

    def _update_segment_error(self, job: TranslationJob, error_message: str):
        try:
            from app.database import SessionLocal
            from app import crud
            db = SessionLocal()
            try:
                crud.update_segment_result(
                    db, job.segment_id,
                    translated_text="", provider_name="", model="",
                    latency_ms=0, status="error", error_message=error_message,
                )
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Failed to update segment error: {e}")

    async def _translate_job(self, job: TranslationJob) -> TranslationJobResult:
        from app.database import SessionLocal
        from app import crud, translator as translator_mod

        db = SessionLocal()
        try:
            session = crud.get_session(db, job.session_id)
            if not session:
                return TranslationJobResult(
                    session_id=job.session_id, segment_id=job.segment_id,
                    translated_text="", provider_name="", model="",
                    latency_ms=0, status="error", error_message="Session not found"
                )

            provider = None
            if session.provider_id:
                provider = crud.get_provider(db, session.provider_id)
            if not provider:
                providers = crud.get_providers(db)
                enabled = [p for p in providers if p.enabled]
                if enabled:
                    provider = enabled[0]

            if not provider:
                error_msg = "provider_not_configured"
                crud.update_segment_result(
                    db, job.segment_id,
                    translated_text="", provider_name="none", model="none",
                    latency_ms=0, status="error", error_message=error_msg
                )
                return TranslationJobResult(
                    session_id=job.session_id, segment_id=job.segment_id,
                    translated_text="", provider_name="none", model="none",
                    latency_ms=0, status="error", error_message=error_msg
                )

            target_language = session.target_language or "zh-TW"

            logger.info(
                f"Translation job started: session={job.session_id} segment={job.segment_id} "
                f"provider_id={provider.id} provider_name={provider.provider_name} "
                f"model={provider.model} source_language={job.source_language} "
                f"target_language={target_language} mode={job.mode} "
                f"source_text='{job.source_text[:60]}' prompt=build_translation_messages"
            )

            result = await translator_mod.translate_text(
                provider=provider,
                source_text=job.source_text,
                source_language=job.source_language,
                mode=job.mode,
                target_language=target_language,
            )

            status = "translated" if result.status == "completed" else "error"

            crud.update_segment_result(
                db, job.segment_id,
                translated_text=result.translated_text,
                provider_name=result.provider_name,
                model=result.model,
                latency_ms=result.latency_ms,
                status=status,
                error_message=result.error_message,
            )

            logger.info(
                f"Translation job done: segment={job.segment_id} "
                f"latency_ms={result.latency_ms:.0f} "
                f"result='{result.translated_text[:60]}' status={status}"
            )

            if status == "error":
                self._last_error = result.error_message or "unknown"

            return TranslationJobResult(
                session_id=job.session_id,
                segment_id=job.segment_id,
                translated_text=result.translated_text,
                provider_name=result.provider_name,
                model=result.model,
                latency_ms=result.latency_ms,
                status=status,
                error_message=result.error_message,
            )
        except Exception as e:
            logger.error(f"Translation job error: {e}")
            self._last_error = str(e)
            return TranslationJobResult(
                session_id=job.session_id, segment_id=job.segment_id,
                translated_text="", provider_name="", model="",
                latency_ms=0, status="error", error_message=str(e)
            )
        finally:
            db.close()


translation_pipeline = TranslationPipeline()
