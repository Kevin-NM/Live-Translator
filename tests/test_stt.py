import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import numpy as np
from app.stt import transcribe_pcm
from app import stt
from app.models import model_dir


class DecodeSettingsTests(unittest.TestCase):
    def test_final_uses_accurate_decode_and_vocabulary(self):
        model = Mock()
        model.transcribe.return_value = ([SimpleNamespace(text='テスト')], None)
        with patch('app.stt.get_model', return_value=model):
            self.assertEqual(transcribe_pcm(np.ones(16000), final=True, vocabulary='DIALOGUE＋'), 'テスト')
        settings = model.transcribe.call_args.kwargs
        self.assertEqual(settings['beam_size'], 5)
        self.assertTrue(settings['vad_filter'])
        self.assertEqual(settings['initial_prompt'], 'DIALOGUE＋')
        self.assertFalse(settings['condition_on_previous_text'])

    def test_partial_and_fast_mode_keep_light_decode(self):
        model = Mock()
        model.transcribe.return_value = ([], None)
        with patch('app.stt.get_model', return_value=model):
            for options in ({}, {'final': True, 'quality': 'fast'}):
                transcribe_pcm(np.ones(16000), **options)
                self.assertEqual(model.transcribe.call_args.kwargs['beam_size'], 1)
                self.assertFalse(model.transcribe.call_args.kwargs['vad_filter'])


class ModelSwitchTests(unittest.TestCase):
    def setUp(self):
        self.state = (stt._model, stt._model_id, stt._leases)
        stt._model, stt._model_id, stt._leases = None, None, 0

    def tearDown(self):
        stt._model, stt._model_id, stt._leases = self.state

    def test_active_sessions_share_model_and_block_switch(self):
        with patch('app.stt.model_ready', return_value=True), patch('app.stt.WhisperModel') as factory:
            first = stt.acquire_model('small')
            self.assertIs(stt.acquire_model('small'), first)
            with self.assertRaisesRegex(RuntimeError, '停止所有擷取'):
                stt.acquire_model('medium')
            stt.release_model()
            with self.assertRaises(RuntimeError): stt.acquire_model('medium')
            stt.release_model()
            stt.acquire_model('medium')
            first.model.unload_model.assert_called_once()
            self.assertEqual(factory.call_count, 2)
            self.assertEqual(stt._leases, 1)
            stt.release_model()

    def test_missing_or_unknown_model_never_loads(self):
        with patch('app.stt.model_ready', return_value=False), patch('app.stt.WhisperModel') as factory:
            with self.assertRaisesRegex(RuntimeError, '尚未下載'): stt.acquire_model('medium')
            with self.assertRaises(ValueError): stt.acquire_model('../../escape')
            factory.assert_not_called()
        self.assertEqual(stt._leases, 0)
        self.assertEqual(model_dir('small').name, 'faster-whisper-small')

    def test_load_failure_has_no_lease_and_can_retry(self):
        with patch('app.stt.model_ready', return_value=True), patch('app.stt.WhisperModel', side_effect=[RuntimeError('out of memory'), Mock()]):
            with self.assertRaisesRegex(RuntimeError, 'GPU 模型載入失敗'): stt.acquire_model('large-v3')
            self.assertIsNone(stt._model_id)
            self.assertEqual(stt._leases, 0)
            stt.acquire_model('small')
            self.assertEqual(stt._model_id, 'small')
            stt.release_model()
