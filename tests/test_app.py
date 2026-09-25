import unittest
import asyncio
import json
from unittest.mock import patch

import httpx
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.translation import TranslationConfig, translate


class TranslationSettingsTests(unittest.TestCase):
    def test_presets_and_custom_local_endpoint(self):
        nvidia = TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test"})
        self.assertEqual(nvidia.endpoint, "https://integrate.api.nvidia.com/v1/chat/completions")
        openai = TranslationConfig.from_payload({"provider": "openai", "api_key": "test"})
        self.assertEqual(openai.endpoint, "https://api.openai.com/v1/chat/completions")
        local = TranslationConfig.from_payload({"provider": "custom", "endpoint": "http://localhost:1234/v1/chat/completions", "model": "local"})
        self.assertEqual(local.model, "local")
        with self.assertRaises(ValueError):
            TranslationConfig.from_payload({"provider": "custom", "endpoint": "http://example.com/v1/chat/completions", "model": "x"})

    def test_chat_completion_payload_and_response(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "こんにちは"}}]})

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def client_factory(*args, **kwargs):
            return real_client(transport=transport)

        config = TranslationConfig.from_payload({"provider": "openai", "api_key": "test-key"})
        with patch("app.translation.httpx.AsyncClient", side_effect=client_factory):
            result = asyncio.run(translate("你好", "zh-ja", config, "短句"))
        self.assertEqual(result, "こんにちは")
        self.assertEqual(calls[0].url.path, "/v1/chat/completions")
        self.assertEqual(calls[0].headers["authorization"], "Bearer test-key")
        self.assertIn("短句", calls[0].content.decode("utf-8"))

    def test_nvidia_uses_supported_default_and_user_message(self):
        calls = []

        def handler(request):
            calls.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": "你好"}}]})

        real_client = httpx.AsyncClient
        with patch("app.translation.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler))):
            config = TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test-key"})
            result = asyncio.run(translate("こんにちは", "ja-zh", config))
        self.assertEqual(result, "你好")
        self.assertEqual(calls[0]["model"], "google/gemma-4-31b-it")
        self.assertEqual([item["role"] for item in calls[0]["messages"]], ["user"])

    def test_retired_model_error_is_actionable(self):
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(lambda request: httpx.Response(410, json={"detail": "Model retired"}))
        with patch("app.translation.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=transport)):
            config = TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test-key", "model": "old-model"})
            with self.assertRaisesRegex(ValueError, "模型或 API 網址無效.*HTTP 410"):
                asyncio.run(translate("こんにちは", "ja-zh", config))


class AudioSocketTests(unittest.TestCase):
    def test_extension_origin_can_connect(self):
        with patch("app.main.get_model", return_value=object()):
            with TestClient(app).websocket_connect("/ws/audio", headers={"origin": "chrome-extension://test-extension"}) as ws:
                ws.send_json({"translation": {"provider": "none"}})
                self.assertEqual(ws.receive_json()["type"], "status")
                self.assertEqual(ws.receive_json()["type"], "ready")
                ws.send_json({"type": "eos"})

    def test_pcm_stream_emits_partial_and_final(self):
        packet = (np.full(3200, 9000, dtype="<i2")).tobytes()
        with patch("app.main.get_model", return_value=object()), patch("app.main.transcribe_pcm", return_value="こんにちは"):
            with TestClient(app).websocket_connect("/ws/audio") as ws:
                ws.send_json({"translation": {"provider": "none"}})
                self.assertEqual(ws.receive_json()["type"], "status")
                self.assertEqual(ws.receive_json()["type"], "ready")
                for _ in range(6):
                    ws.send_bytes(packet)
                partial = ws.receive_json()
                self.assertEqual(partial, {"type": "partial", "text": "こんにちは"})
                ws.send_json({"type": "eos"})
                final = ws.receive_json()
                self.assertEqual(final["type"], "final")
                self.assertEqual(final["text"], "こんにちは")


if __name__ == "__main__":
    unittest.main()
