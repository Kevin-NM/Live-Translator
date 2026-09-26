import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.transcripts import TranscriptStore, export_transcript, timestamp

class TranscriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = TranscriptStore(Path(self.temp.name)/'transcripts.sqlite3')
        self.identity = self.store.create('en','zh-TW',750500,1)

    def tearDown(self): self.temp.cleanup()

    def test_full_record_survives_ui_limit_and_reopen_with_late_translation(self):
        for number in range(1,61): self.store.cue(self.identity,number,(number-1)*2000,number*2000,'Source '+str(number))
        self.store.translated(self.identity,1,'第一句')
        self.store.finish(self.identity)
        reopened=TranscriptStore(self.store.path)
        record=reopened.get(self.identity)
        self.assertEqual(record['count'],60)
        self.assertEqual(record['cues'][0]['translation'],'第一句')
        self.assertEqual(record['pending'],0)
        self.assertEqual(record['cues'][-1]['status'],'interrupted')
        output=export_transcript(record,'srt','bilingual')
        self.assertIn('60\n',output)
        self.assertIn('00:12:30,500 --> 00:12:32,500',output)
        self.assertIn('Source 1\n第一句',output)

    def test_export_formats_language_modes_and_safe_ass_text(self):
        self.store.cue(self.identity,1,0,2500,'Hello\r\n\r\n{\\pos(1,2)} 🌸')
        self.store.translated(self.identity,1,'你好\n世界')
        self.store.cue(self.identity,2,3000,4000,'Only source')
        self.store.translated(self.identity,2,'','error')
        record=self.store.get(self.identity)
        translation=export_transcript(record,'srt','translation')
        self.assertNotIn('Only source',translation)
        self.assertIn('你好\n世界',translation)
        self.assertNotIn('error',translation)
        ass=export_transcript(record,'ass')
        self.assertIn('Dialogue: 0,0:12:30.50,0:12:33.00,Default',ass)
        self.assertIn('｛＼pos(1,2)｝ 🌸\\N你好\\N世界',ass)
        self.assertNotIn('{\\pos',ass)
        self.assertIn('[00:12:30.500',export_transcript(record,'txt','source'))
        self.assertEqual(timestamp(3600000,True),'1:00:00.00')
        self.assertEqual(timestamp(59999),'00:00:59,999')
        self.assertEqual(timestamp(60000),'00:01:00,000')
        with self.assertRaises(ValueError): export_transcript(record,'exe')

    def test_video_anchors_preserve_media_time_across_pause_and_speed(self):
        self.store.anchor(self.identity,0,120000,1)
        self.store.anchor(self.identity,2000,122000,0)
        self.store.anchor(self.identity,12000,122000,2)
        self.store.cue(self.identity,1,13000,14000,'after pause',False)
        output=export_transcript(self.store.get(self.identity),'srt','source')
        self.assertIn('00:02:04,000 --> 00:02:06,000',output)
        self.store.timeline(self.identity,5000,1)
        self.assertIn('00:00:18,000 --> 00:00:19,000',export_transcript(self.store.get(self.identity),'srt','source'))

    def test_api_attachment_manual_offset_and_session_isolation(self):
        self.store.cue(self.identity,1,0,1000,'Original')
        self.store.translated(self.identity,1,'譯文')
        with patch('app.main.transcripts',self.store):
            client=TestClient(app)
            response=client.get(f'/api/transcripts/{self.identity}/export?format=srt&content=bilingual')
            self.assertEqual(response.status_code,200)
            self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
            self.assertIn('attachment;',response.headers['content-disposition'])
            response=client.post(f'/api/transcripts/{self.identity}/timeline',json={'offset_ms':3600000,'rate':2})
            self.assertEqual(response.status_code,200)
            self.assertIn('01:00:00,000 --> 01:00:02,000',client.get(f'/api/transcripts/{self.identity}/export?content=source').text)
            self.assertEqual(client.get('/api/transcripts/not-a-session/export').status_code,404)
            self.assertEqual(client.post(f'/api/transcripts/{self.identity}/timeline',json={'offset_ms':-1}).status_code,422)
            self.assertEqual(client.get(f'/api/transcripts/{self.identity}/export?format=exe').status_code,400)

    def test_restart_marks_pending_interrupted_without_storing_keys_or_audio(self):
        self.store.cue(self.identity,1,0,1000,'source')
        self.store.recover()
        record=self.store.get(self.identity)
        self.assertTrue(record['completed'])
        self.assertEqual(record['pending'],0)
        self.assertEqual(record['cues'][0]['status'],'interrupted')
        self.assertNotIn('api_key',record)
