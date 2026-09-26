"""Local full-session transcripts. Never store keys, API settings or raw audio."""
from bisect import bisect_right
import math
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "transcripts.sqlite3"

class TranscriptStore:
    def __init__(self, path=DEFAULT_PATH): self.path = Path(path)

    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.executescript('''
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, created TEXT NOT NULL, source_language TEXT,
                target_language TEXT, offset_ms INTEGER DEFAULT 0, rate REAL DEFAULT 1,
                alignment TEXT DEFAULT 'manual', completed INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS cues (
                session_id TEXT NOT NULL, id INTEGER NOT NULL, start_ms INTEGER,
                end_ms INTEGER, source TEXT, translation TEXT DEFAULT '', status TEXT,
                PRIMARY KEY (session_id, id));
            CREATE TABLE IF NOT EXISTS anchors (
                session_id TEXT, sample_ms INTEGER, media_ms INTEGER, rate REAL,
                PRIMARY KEY(session_id,sample_ms));
        ''')
        return db

    def create(self, source, target, offset_ms=0, rate=1):
        offset_ms, rate = validate_timeline(offset_ms, rate)
        identity = str(uuid.uuid4())
        db = self.connection()
        try:
            with db: db.execute('INSERT INTO sessions(id,created,source_language,target_language,offset_ms,rate) VALUES(?,?,?,?,?,?)', (identity, datetime.now(timezone.utc).isoformat(), source, target, offset_ms, rate))
        finally: db.close()
        return identity

    def cue(self, identity, sequence, start, end, text, translate=True):
        db = self.connection()
        try:
            with db: db.execute('INSERT INTO cues(session_id,id,start_ms,end_ms,source,status) VALUES(?,?,?,?,?,?)', (identity, sequence, start, max(start + 1, end), text, 'pending' if translate else 'source'))
        finally: db.close()

    def translated(self, identity, sequence, text='', status='translated'):
        db = self.connection()
        try:
            with db: db.execute('UPDATE cues SET translation=?,status=? WHERE session_id=? AND id=?', (text, status, identity, sequence))
        finally: db.close()

    def finish(self, identity):
        db = self.connection()
        try:
            with db:
                db.execute('UPDATE sessions SET completed=1 WHERE id=?', (identity,))
                db.execute("UPDATE cues SET status='interrupted' WHERE session_id=? AND status='pending'", (identity,))
        finally: db.close()

    def timeline(self, identity, offset_ms, rate=1, alignment='manual'):
        offset_ms, rate = validate_timeline(offset_ms, rate)
        db = self.connection()
        try:
            with db: db.execute('UPDATE sessions SET offset_ms=?,rate=?,alignment=? WHERE id=?', (offset_ms, rate, alignment, identity))
        finally: db.close()

    def get(self, identity):
        db = self.connection()
        try:
            db.execute('BEGIN')
            session = db.execute('SELECT * FROM sessions WHERE id=?', (identity,)).fetchone()
            if session is None: raise KeyError("找不到轉錄資料")
            result = dict(session)
            result['cues'] = [dict(row) for row in db.execute('SELECT id,start_ms,end_ms,source,translation,status FROM cues WHERE session_id=? ORDER BY start_ms,id', (identity,))]
            result['anchors'] = [dict(row) for row in db.execute('SELECT sample_ms,media_ms,rate FROM anchors WHERE session_id=? ORDER BY sample_ms', (identity,))]
            result['count'] = len(result['cues'])
            result['pending'] = sum(row['status'] == 'pending' for row in result['cues'])
            return result
        finally: db.close()

    def anchor(self, identity, sample_ms, media_ms, rate):
        sample_ms, media_ms, rate = int(sample_ms), int(media_ms), float(rate)
        if not 0 <= sample_ms <= 604800000 or not 0 <= media_ms <= 604800000 or not math.isfinite(rate) or not 0 <= rate <= 4:
            raise ValueError("無效的影片時間標記")
        db = self.connection()
        try:
            with db:
                db.execute('INSERT OR REPLACE INTO anchors VALUES(?,?,?,?)', (identity,sample_ms,media_ms,rate))
                db.execute("UPDATE sessions SET alignment='video',offset_ms=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM anchors WHERE session_id=? AND sample_ms<?)", (media_ms,identity,identity,sample_ms))
        finally: db.close()

    def recover(self):
        db = self.connection()
        try:
            with db:
                db.execute("UPDATE cues SET status='interrupted' WHERE status='pending'")
                db.execute('UPDATE sessions SET completed=1 WHERE completed=0')
        finally: db.close()

    def list(self):
        db = self.connection()
        try:
            return [dict(row) for row in db.execute('SELECT s.*, COUNT(c.id) AS count FROM sessions s LEFT JOIN cues c ON c.session_id=s.id GROUP BY s.id ORDER BY s.created DESC LIMIT 100')]
        finally: db.close()

def validate_timeline(offset_ms, rate):
    offset_ms, rate = int(offset_ms), float(rate)
    if not 0 <= offset_ms <= 604800000 or not math.isfinite(rate) or not .25 <= rate <= 4:
        raise ValueError("影片起點須為0至7天，播放速度須為0.25至4倍")
    return offset_ms, rate

def timestamp(ms, ass=False):
    units = max(0, int(ms)) // (10 if ass else 1)
    seconds, fraction = divmod(units, 100 if ass else 1000)
    minutes, second = divmod(seconds, 60)
    hour, minute = divmod(minutes, 60)
    return f"{hour}:{minute:02}:{second:02}.{fraction:02}" if ass else f"{hour:02}:{minute:02}:{second:02},{fraction:03}"

def export_transcript(session, format='srt', content='bilingual'):
    if format not in ('srt', 'ass', 'txt') or content not in ('source', 'translation', 'bilingual'):
        raise ValueError("不支援的匯出格式或內容")
    rows = []
    for cue in session['cues']:
        source = clean_text(cue['source'])
        translation = clean_text(cue['translation']) if cue['status'] == 'translated' else ''
        text = source if content == 'source' else translation if content == 'translation' else '\n'.join(part for part in (source, translation) if part)
        if not text: continue
        start = media_time(session, cue['start_ms'])
        end = max(start + 10, media_time(session, cue['end_ms']))
        rows.append((start, end, text))
    if not rows: raise ValueError("沒有可匯出的內容；譯文可能尚未完成或翻譯失敗，可改選原文／雙語")
    rows.sort(key=lambda row:(row[0],row[1]))
    if format == 'srt':
        return '\n\n'.join(f"{i}\n{timestamp(start)} --> {timestamp(end)}\n{text}" for i, (start,end,text) in enumerate(rows,1)) + '\n'
    if format == 'txt':
        return '\n\n'.join(f"[{timestamp(start).replace(',', '.')} – {timestamp(end).replace(',', '.')}]\n{text}" for start,end,text in rows) + '\n'
    header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,50,50,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    return header + '\n'.join(f"Dialogue: 0,{timestamp(start,True)},{timestamp(end,True)},Default,,0,0,0,,{ass_text(text)}" for start,end,text in rows) + '\n'

def clean_text(text):
    # Avoid blank lines splitting SRT blocks, and reject control characters.
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]','',str(text))
    return '\n'.join(line.strip() for line in text.replace('\r\n','\n').replace('\r','\n').split('\n') if line.strip())

def media_time(session, sample_ms):
    if session['alignment'] == 'video':
        anchors = session.get('anchors', [])
        index = bisect_right(anchors, sample_ms, key=lambda anchor: anchor['sample_ms']) - 1
        if index >= 0:
            anchor = anchors[index]
            return max(0, round(anchor['media_ms'] + (sample_ms - anchor['sample_ms']) * anchor['rate']))
    return max(0, round(session['offset_ms'] + sample_ms * session['rate']))

def ass_text(text):
    # Full-width counterparts keep user text out of ASS override/escape syntax.
    return text.replace('\\','＼').replace('{','｛').replace('}','｝').replace('\n',r'\N')
