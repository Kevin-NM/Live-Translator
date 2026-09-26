import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import numpy as np
from app.stt import transcribe_pcm


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
