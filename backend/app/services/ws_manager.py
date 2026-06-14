import asyncio
import json
import logging
from typing import Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class LiveConnectionManager:
    def __init__(self):
        self._connections: dict[int, list[WebSocket]] = {}
        self._audio_connections: dict[int, WebSocket] = {}

    async def connect_live(self, ws: WebSocket, session_id: int):
        await ws.accept()
        if session_id not in self._connections:
            self._connections[session_id] = []
        self._connections[session_id].append(ws)
        logger.info(f"Live WS connected: session={session_id}")

    def disconnect_live(self, ws: WebSocket, session_id: int):
        if session_id in self._connections:
            self._connections[session_id] = [
                c for c in self._connections[session_id] if c != ws
            ]
            if not self._connections[session_id]:
                del self._connections[session_id]
        logger.info(f"Live WS disconnected: session={session_id}")

    async def connect_audio(self, ws: WebSocket, session_id: int):
        await ws.accept()
        self._audio_connections[session_id] = ws
        logger.info(f"Audio WS connected: session={session_id}")

    def disconnect_audio(self, session_id: int):
        self._audio_connections.pop(session_id, None)
        logger.info(f"Audio WS disconnected: session={session_id}")

    def get_audio_ws(self, session_id: int) -> Optional[WebSocket]:
        return self._audio_connections.get(session_id)

    def is_audio_connected(self, session_id: int) -> bool:
        return session_id in self._audio_connections

    async def broadcast_live(self, session_id: int, message: dict):
        conns = self._connections.get(session_id, [])
        dead = []
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_live(ws, session_id)

    def get_active_sessions(self) -> list[int]:
        return list(self._audio_connections.keys())


ws_manager = LiveConnectionManager()
