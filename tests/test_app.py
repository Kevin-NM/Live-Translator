import unittest
import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np
from fastapi.testclient import TestClient

from app.main import app, audio_socket
from app.translation import TranslationConfig, translate
from app.transcripts import TranscriptStore


class TranslationSettingsTests(unittest.TestCase):
    def test_general_translation_uses_selected_source_and_reply_languages(self):
        calls=[]
        def handler(request):
            calls.append(json.loads(request.content))
            return httpx.Response(200,json={'choices':[{'message':{'content':'Bonjour'}}]})
        real_client=httpx.AsyncClient
        config=TranslationConfig.from_payload({'provider':'openai','api_key':'test','source_language':'en','target_language':'fr','reply_language':'ko'})
        with patch('app.translation.httpx.AsyncClient',side_effect=lambda **kwargs:real_client(transport=httpx.MockTransport(handler))):
            asyncio.run(translate('Hello','source-target',config))
            asyncio.run(translate('Bonjour','reply',config))
        self.assertIn('English',calls[0]['messages'][0]['content'])
        self.assertIn('French',calls[0]['messages'][0]['content'])
        self.assertIn('Korean',calls[1]['messages'][0]['content'])
        with self.assertRaises(ValueError): TranslationConfig.from_payload({'provider':'openai','api_key':'test','source_language':'xx'})

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
        self.assertEqual(TestClient(app).get('/api/status').json()['protocol_version'], 10)

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
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = TranscriptStore(Path(self.directory.name) / 'test.sqlite3')
        self.store_patch = patch('app.main.transcripts', self.store)
        self.store_patch.start()

    def tearDown(self):
        self.store_patch.stop()
        self.directory.cleanup()

    def test_auto_detected_language_is_used_and_full_transcript_is_saved(self):
        packet=np.full(3200,9000,dtype='<i2').tobytes()
        with patch('app.main.acquire_model',return_value=object()),patch('app.main.transcribe_pcm',return_value=('Hello','en')),patch('app.main.translate',return_value='你好') as translator:
            with TestClient(app).websocket_connect('/ws/audio') as ws:
                ws.send_json({'translation':{'provider':'custom','endpoint':'http://localhost:1234/chat/completions','model':'test'},'recognition':{'language':'auto','previews':False}})
                ws.receive_json(); ready=ws.receive_json()
                for _ in range(20): ws.send_bytes(packet)
                ws.receive_json(); ws.receive_json()
                ws.send_json({'type':'timeline','sample_ms':0,'media_ms':120000,'rate':1})
                ws.send_json({'type':'eos'})
            record=self.store.get(ready['transcript_id'])
            self.assertEqual(record['cues'][0]['source'],'Hello')
            self.assertEqual(record['cues'][0]['translation'],'你好')
            self.assertEqual(record['offset_ms'],120000)
            self.assertEqual(translator.call_args.args[2].source_language,'en')

    def test_translation_delivery_failure_keeps_saved_transcript(self):
        packet = (np.full(3200,9000,dtype='<i2')).tobytes()
        messages = iter([{'type':'websocket.receive','bytes':packet} for _ in range(5)] + [{'type':'websocket.receive','text':'{"type":"eos"}'}])
        class Socket:
            headers = {}
            identity = None
            async def accept(self): pass
            async def receive_text(self): return '{"translation":{"provider":"custom","endpoint":"http://localhost:1234/chat/completions","model":"test"},"recognition":{"previews":false}}'
            async def receive(self): return next(messages)
            async def send_json(self, value):
                if value['type'] == 'ready': self.identity = value['transcript_id']
                if value['type'] == 'translation': raise RuntimeError('Browser closed')
            async def close(self): pass
        socket = Socket()
        with patch('app.main.acquire_model',return_value=object()),patch('app.main.release_model'),patch('app.main.transcribe_pcm',return_value='Hello'),patch('app.main.translate',return_value='你好'):
            asyncio.run(audio_socket(socket))
        record=self.store.get(socket.identity)
        self.assertEqual(record['cues'][0]['translation'],'你好')
        self.assertEqual(record['cues'][0]['status'],'translated')
        self.assertTrue(record['completed'])

    def test_cancel_after_load_releases_owned_model(self):
        class Socket:
            headers = {}
            async def accept(self): pass
            async def receive_text(self): return '{"translation":{"provider":"none"}}'
            async def send_json(self, value):
                if value['type'] == 'ready': raise asyncio.CancelledError()
        with patch('app.main.acquire_model', return_value=object()), patch('app.main.release_model') as release:
            with self.assertRaises(asyncio.CancelledError): asyncio.run(audio_socket(Socket()))
            release.assert_called_once()

    def test_cancel_during_native_load_collects_and_releases_late_lease(self):
        import threading
        class Socket:
            headers = {}
            async def accept(self): pass
            async def receive_text(self): return '{"translation":{"provider":"none"}}'
            async def send_json(self, value): pass
        async def scenario():
            started = asyncio.Event()
            gate = threading.Event()
            loop = asyncio.get_running_loop()
            def load(_):
                loop.call_soon_threadsafe(started.set)
                gate.wait(timeout=3)
                return object()
            with patch('app.main.acquire_model', side_effect=load), patch('app.main.release_model') as release:
                task = asyncio.create_task(audio_socket(Socket()))
                await started.wait()
                task.cancel(); gate.set()
                with self.assertRaises(asyncio.CancelledError): await task
                release.assert_called_once()
        asyncio.run(scenario())

    def test_model_selection_is_passed_and_lease_released_on_disconnect(self):
        with patch('app.main.acquire_model', return_value=object()) as acquire, patch('app.main.release_model') as release:
            with TestClient(app).websocket_connect('/ws/audio') as ws:
                ws.send_json({'translation': {'provider': 'none'}, 'recognition': {'model': 'small'}})
                ws.receive_json(); ws.receive_json()
            acquire.assert_called_once_with('small')
            release.assert_called_once()

    def test_failed_model_load_emits_error_without_releasing_unowned_lease(self):
        with patch('app.main.acquire_model', side_effect=RuntimeError('模型尚未下載')), patch('app.main.release_model') as release:
            with TestClient(app).websocket_connect('/ws/audio') as ws:
                ws.send_json({'translation': {'provider': 'none'}})
                ws.receive_json()
                self.assertEqual(ws.receive_json()['type'], 'error')
            release.assert_not_called()

    def test_web_ui_and_model_registry_are_served(self):
        client = TestClient(app)
        self.assertIn('留言助手 API', client.get('/').text)
        self.assertEqual(client.get('/static/platform.js').status_code, 200)
        models = client.get('/api/status').json()['models']
        self.assertEqual({entry['id'] for entry in models}, {'small', 'medium', 'large-v3', 'large-v3-turbo'})
        self.assertTrue(all('download_command' in entry for entry in models))

    def test_translated_only_skips_previews_and_finalises_at_four_seconds(self):
        packet = np.full(3200, 9000, dtype='<i2').tobytes()
        with patch('app.main.acquire_model', return_value=object()), patch('app.main.transcribe_pcm', return_value='テスト') as decode, patch('app.main.translate', return_value='測試'):
            with TestClient(app).websocket_connect('/ws/audio') as ws:
                ws.send_json({'translation': {'provider': 'custom', 'endpoint': 'http://localhost:1234/v1/chat/completions', 'model': 'test'}, 'recognition': {'previews': False, 'segment_seconds': 4}})
                ws.receive_json(); ws.receive_json()
                for _ in range(20): ws.send_bytes(packet)
                final = ws.receive_json()
                self.assertEqual(final['type'], 'final')
                self.assertEqual(final['end_ms'], 4000)
                translated = ws.receive_json()
                self.assertEqual(translated['type'], 'translation')
                self.assertGreaterEqual(translated['required_delay_ms'], 4000)
                self.assertEqual(decode.call_count, 1)
                self.assertTrue(decode.call_args.kwargs['final'])
                ws.send_json({'type': 'eos'})

    def test_caption_timestamps_include_silence_before_voice(self):
        silence = (np.zeros(3200, dtype="<i2")).tobytes()
        voice = (np.full(3200, 9000, dtype="<i2")).tobytes()
        with patch("app.main.acquire_model", return_value=object()), patch("app.main.transcribe_pcm", return_value="こんにちは"):
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
        with patch("app.main.acquire_model", return_value=object()):
            with TestClient(app).websocket_connect("/ws/audio", headers={"origin": "chrome-extension://test-extension"}) as ws:
                ws.send_json({"translation": {"provider": "none"}})
                self.assertEqual(ws.receive_json()["type"], "status")
                self.assertEqual(ws.receive_json()["type"], "ready")
                ws.send_json({"type": "eos"})

    def test_pcm_stream_emits_partial_and_final(self):
        packet = (np.full(3200, 9000, dtype="<i2")).tobytes()
        with patch("app.main.acquire_model", return_value=object()), patch("app.main.transcribe_pcm", return_value="こんにちは"):
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
        with patch('app.main.acquire_model', return_value=object()), patch('app.main.transcribe_pcm', return_value='テスト') as decode:
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
                self.assertEqual(decode.call_args.kwargs, {'final': True, 'quality': 'accurate', 'vocabulary': 'DIALOGUE＋', 'model': unittest.mock.ANY, 'language':'ja', 'with_language':True})


if __name__ == "__main__":
    unittest.main()

class UiCacheTests(unittest.TestCase):
    def test_web_assets_are_content_versioned_and_served_without_cache(self):
        import hashlib
        import re
        client = TestClient(app)
        page = client.get('/')
        self.assertEqual(page.headers['cache-control'], 'no-store')
        urls = re.findall(r'(?:src|href)="(/static/[^"?]+)\?v=([a-f0-9]{16})"', page.text)
        self.assertEqual({path for path, _ in urls}, {'/static/panel.css','/static/caption-transport.js','/static/caption-ui.js','/static/platform.js','/static/video-delay.js','/static/viewer.js','/static/panel.js'})
        for path, digest in urls:
            response = client.get(path + '?v=' + digest)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(hashlib.sha256(response.content).hexdigest()[:16], digest)
            conditional = client.get(path, headers={'If-None-Match': response.headers['etag']})
            self.assertEqual(conditional.status_code, 304)
            self.assertEqual(conditional.headers['cache-control'], 'no-store')
        self.assertEqual(client.get('/api/status').headers['cache-control'], 'no-store')
        self.assertEqual(client.get('/static/missing.js').headers['cache-control'], 'no-store')

    def test_asset_versions_are_deterministic_and_follow_content_changes(self):
        import build_ui
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'web').mkdir(); (root/'chrome-extension').mkdir()
            for path in (build_ui.ROOT/'chrome-extension').iterdir():
                if path.is_file(): (root/'chrome-extension'/path.name).write_bytes(path.read_bytes())
            for name in ('platform.js','viewer.js','video-delay.js'):
                (root/'web'/name).write_bytes((build_ui.ROOT/'web'/name).read_bytes())
            with patch.object(build_ui,'ROOT',root):
                build_ui.build(); first = (root/'web/index.html').read_bytes()
                build_ui.build(); self.assertEqual((root/'web/index.html').read_bytes(),first)
                build_ui.build(check=True)
                script = root/'chrome-extension/caption-ui.js'
                script.write_bytes(script.read_bytes()+b'\n// cache regression fixture\n')
                with self.assertRaises(SystemExit):build_ui.build(check=True)
                build_ui.build(); self.assertNotEqual((root/'web/index.html').read_bytes(),first)
                build_ui.build(check=True)
