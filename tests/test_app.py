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
    def test_custom_riva_pivots_japanese_through_english_to_chinese(self):
        calls = []
        def handler(request):
            body = json.loads(request.content)
            calls.append(body)
            pair = body['messages'][0]['content']
            result = {'ja-en': 'Congratulations!', 'en-zh-tw': '恭喜！'}[pair]
            return httpx.Response(200, json={"choices": [{"message": {"content": result}}]})
        real_client = httpx.AsyncClient
        config = TranslationConfig.from_payload({"provider": "custom", "endpoint": "https://api.banana2556.com/v1/chat/completions", "model": "nvidia/riva-translate-4b-instruct-v2", "api_key": "test"})
        with patch("app.translation.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler))):
            self.assertEqual(asyncio.run(translate('おめでとう！', 'ja-zh', config)), '恭喜！')
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]['messages'][1]['content'], 'Congratulations!')

    def test_protocol_version(self):
        self.assertEqual(TestClient(app).get('/api/status').json()['protocol_version'], 5)

    def test_target_language_selection_and_riva_payload(self):
        calls = []
        def handler(request):
            calls.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": "Congratulations!"}}]})
        real_client = httpx.AsyncClient
        with patch("app.translation.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler))):
            config = TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test", "target_language": "en"})
            self.assertEqual(asyncio.run(translate("おめでとう", "ja-zh", config)), "Congratulations!")
            self.assertEqual(len(calls), 1)
            self.assertIn("English", calls[0]["messages"][0]["content"])
            config = TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test", "model": "nvidia/riva-translate-4b-instruct-v2", "target_language": "en"})
            asyncio.run(translate("おめでとう", "ja-zh", config))
            self.assertEqual(calls[1]["messages"], [{"role": "system", "content": "ja-en"}, {"role": "user", "content": "おめでとう"}])
        with self.assertRaisesRegex(ValueError, "目標語言"):
            TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test", "target_language": "unknown"})

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

    def test_english_result_is_retried_in_traditional_chinese(self):
        calls = []

        def handler(request):
            calls.append(json.loads(request.content))
            output = "Air purifier" if len(calls) == 1 else "空氣清淨機"
            return httpx.Response(200, json={"choices": [{"message": {"content": output}}]})

        real_client = httpx.AsyncClient
        with patch("app.translation.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler))):
            config = TranslationConfig.from_payload({"provider": "nvidia", "api_key": "test-key"})
            result = asyncio.run(translate("空気清浄機", "ja-zh", config))
        self.assertEqual(result, "空氣清淨機")
        self.assertEqual(len(calls), 2)


class AudioSocketTests(unittest.TestCase):
    def test_caption_timestamps_include_silence_before_voice(self):
        silence = (np.zeros(3200, dtype="<i2")).tobytes()
        voice = (np.full(3200, 9000, dtype="<i2")).tobytes()
        with patch("app.main.get_model", return_value=object()), patch("app.main.transcribe_pcm", return_value="こんにちは"):
            with TestClient(app).websocket_connect("/ws/audio") as ws:
                ws.send_json({"translation": {"provider": "none"}})
                ws.receive_json(); ws.receive_json()
                for _ in range(2): ws.send_bytes(silence)
                for _ in range(6): ws.send_bytes(voice)
                partial = ws.receive_json()
                self.assertEqual((partial["start_ms"], partial["end_ms"]), (400, 1600))
                ws.send_json({"type": "eos"})
                final = ws.receive_json()
                self.assertEqual((final["start_ms"], final["end_ms"]), (400, 1600))

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
                for _ in range(8):
                    ws.send_bytes(packet)
                partial = ws.receive_json()
                self.assertEqual(partial, {"type": "partial", "text": "こんにちは", "start_ms": 0, "end_ms": 1600})
                ws.send_json({"type": "eos"})
                final = ws.receive_json()
                self.assertEqual(final["type"], "final")
                self.assertEqual(final["text"], "こんにちは")
                self.assertEqual((final["start_ms"], final["end_ms"]), (0, 1600))

    def test_preroll_preserves_quiet_onset_and_recognition_settings(self):
        quiet = np.full(3200, 100, dtype='<i2').tobytes()
        voice = np.full(3200, 9000, dtype='<i2').tobytes()
        with patch('app.main.get_model', return_value=object()), patch('app.main.transcribe_pcm', return_value='テスト') as decode:
            with TestClient(app).websocket_connect('/ws/audio') as ws:
                ws.send_json({'translation': {'provider': 'none'}, 'recognition': {'quality': 'accurate', 'vocabulary': 'DIALOGUE＋'}})
                ws.receive_json(); ws.receive_json()
                for _ in range(4): ws.send_bytes(quiet)
                for _ in range(6): ws.send_bytes(voice)
                ws.receive_json()
                ws.send_json({'type': 'eos'})
                ws.receive_json()
                pcm = decode.call_args.args[0]
                self.assertEqual(pcm.size, 25600)
                np.testing.assert_allclose(pcm[:6400], 100 / 32768)
                self.assertEqual(decode.call_args.kwargs, {'final': True, 'quality': 'accurate', 'vocabulary': 'DIALOGUE＋'})


if __name__ == "__main__":
    unittest.main()
