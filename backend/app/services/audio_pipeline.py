import asyncio
import base64
import io
import logging
import struct
import subprocess
import shutil
import numpy as np
from typing import Optional

logger = logging.getLogger(__name__)


def check_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def decode_webm_to_pcm(webm_bytes: bytes, sample_rate: int = 16000) -> Optional[np.ndarray]:
    if not check_ffmpeg():
        logger.error("ffmpeg not found in PATH")
        return None

    try:
        proc = subprocess.run(
            [
                "ffmpeg", "-i", "pipe:0",
                "-f", "s16le",
                "-acodec", "pcm_s16le",
                "-ar", str(sample_rate),
                "-ac", "1",
                "-loglevel", "error",
                "pipe:1",
            ],
            input=webm_bytes,
            capture_output=True,
            timeout=10,
        )
        if proc.returncode != 0:
            logger.error(f"ffmpeg decode failed: {proc.stderr.decode('utf-8', errors='replace')[:200]}")
            return None

        pcm_bytes = proc.stdout
        if len(pcm_bytes) < 320:
            return None

        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        return audio

    except subprocess.TimeoutExpired:
        logger.error("ffmpeg decode timed out")
        return None
    except Exception as e:
        logger.error(f"Audio decode error: {e}")
        return None


class AudioBuffer:
    def __init__(self, sample_rate: int = 16000, chunk_seconds: float = 3.0):
        self.sample_rate = sample_rate
        self.chunk_seconds = chunk_seconds
        self.chunk_samples = int(sample_rate * chunk_seconds)
        self._buffer = np.array([], dtype=np.float32)
        self._total_samples = 0
        self._lock = asyncio.Lock()

    async def add_audio(self, pcm_data: np.ndarray) -> Optional[np.ndarray]:
        async with self._lock:
            self._buffer = np.concatenate([self._buffer, pcm_data])
            self._total_samples += len(pcm_data)

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

    async def process_chunk(self, session_id: int, webm_bytes: bytes) -> Optional[np.ndarray]:
        pcm = decode_webm_to_pcm(webm_bytes, self._sample_rate)
        if pcm is None:
            return None
        buffer = self.get_buffer(session_id)
        return await buffer.add_audio(pcm)

    async def flush_session(self, session_id: int) -> Optional[np.ndarray]:
        buffer = self.get_buffer(session_id)
        return await buffer.flush()


audio_pipeline = AudioPipeline()
