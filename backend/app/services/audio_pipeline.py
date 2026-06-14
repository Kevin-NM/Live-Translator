import asyncio
import logging
import numpy as np
from typing import Optional

logger = logging.getLogger(__name__)


def resample_pcm(pcm: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    if src_rate == dst_rate:
        return pcm
    duration = len(pcm) / src_rate
    dst_len = int(duration * dst_rate)
    indices = np.linspace(0, len(pcm) - 1, dst_len)
    return np.interp(indices, np.arange(len(pcm)), pcm).astype(np.float32)


class AudioBuffer:
    def __init__(self, sample_rate: int = 16000, chunk_seconds: float = 3.0):
        self.sample_rate = sample_rate
        self.chunk_seconds = chunk_seconds
        self.chunk_samples = int(sample_rate * chunk_seconds)
        self._buffer = np.array([], dtype=np.float32)
        self._total_samples = 0
        self._lock = asyncio.Lock()
        self._src_sample_rate = sample_rate

    def set_source_rate(self, rate: int):
        self._src_sample_rate = rate

    async def add_pcm(self, pcm_data: np.ndarray, source_rate: int) -> Optional[np.ndarray]:
        async with self._lock:
            if source_rate != self.sample_rate:
                pcm_data = resample_pcm(pcm_data, source_rate, self.sample_rate)

            self._buffer = np.concatenate([self._buffer, pcm_data])
            self._total_samples += len(pcm_data)

            logger.debug(
                f"AudioBuffer: added {len(pcm_data)} samples, "
                f"buffer={len(self._buffer)} ({len(self._buffer)/self.sample_rate:.1f}s), "
                f"total={self._total_samples} ({self._total_samples/self.sample_rate:.1f}s)"
            )

            if len(self._buffer) >= self.chunk_samples:
                chunk = self._buffer[:self.chunk_samples]
                self._buffer = self._buffer[self.chunk_samples:]
                return chunk
            return None

    async def flush(self) -> Optional[np.ndarray]:
        async with self._lock:
            if len(self._buffer) > self.sample_rate * 0.5:
                chunk = self._buffer.copy()
                self._buffer = np.array([], dtype=np.float32)
                return chunk
            self._buffer = np.array([], dtype=np.float32)
            return None

    @property
    def buffered_seconds(self) -> float:
        return len(self._buffer) / self.sample_rate

    @property
    def total_seconds(self) -> float:
        return self._total_samples / self.sample_rate

    def reset(self):
        self._buffer = np.array([], dtype=np.float32)
        self._total_samples = 0


class AudioPipeline:
    def __init__(self):
        self._buffers: dict[int, AudioBuffer] = {}
        self._chunk_seconds = 3.0
        self._sample_rate = 16000

    def configure(self, chunk_seconds: float = 3.0, sample_rate: int = 16000):
        self._chunk_seconds = chunk_seconds
        self._sample_rate = sample_rate

    def get_buffer(self, session_id: int) -> AudioBuffer:
        if session_id not in self._buffers:
            self._buffers[session_id] = AudioBuffer(
                sample_rate=self._sample_rate,
                chunk_seconds=self._chunk_seconds,
            )
        return self._buffers[session_id]

    def remove_buffer(self, session_id: int):
        self._buffers.pop(session_id, None)

    async def process_pcm_s16le(
        self, session_id: int, pcm_bytes: bytes, source_rate: int, channels: int
    ) -> Optional[np.ndarray]:
        pcm_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
        pcm_float32 = pcm_int16.astype(np.float32) / 32768.0

        if channels > 1:
            pcm_float32 = pcm_float32.reshape(-1, channels).mean(axis=1)

        buffer = self.get_buffer(session_id)
        buffer.set_source_rate(source_rate)
        return await buffer.add_pcm(pcm_float32, source_rate)

    async def process_pcm_f32le(
        self, session_id: int, pcm_bytes: bytes, source_rate: int, channels: int
    ) -> Optional[np.ndarray]:
        pcm_float32 = np.frombuffer(pcm_bytes, dtype=np.float32)

        if channels > 1:
            pcm_float32 = pcm_float32.reshape(-1, channels).mean(axis=1)

        buffer = self.get_buffer(session_id)
        buffer.set_source_rate(source_rate)
        return await buffer.add_pcm(pcm_float32, source_rate)

    async def flush_session(self, session_id: int) -> Optional[np.ndarray]:
        buffer = self.get_buffer(session_id)
        return await buffer.flush()

    def get_buffer_info(self, session_id: int) -> dict:
        buffer = self._buffers.get(session_id)
        if not buffer:
            return {"buffered_seconds": 0, "total_seconds": 0}
        return {
            "buffered_seconds": round(buffer.buffered_seconds, 2),
            "total_seconds": round(buffer.total_seconds, 2),
        }


audio_pipeline = AudioPipeline()
