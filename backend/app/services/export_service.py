import csv
import io
import json
from typing import List
from app import models


def export_session_json(session: models.Session, segments: List[models.Segment]) -> str:
    data = {
        "session": {
            "id": session.id,
            "title": session.title,
            "source_type": session.source_type,
            "source_name": session.source_name,
            "source_url": session.source_url,
            "source_language": session.source_language,
            "target_language": session.target_language,
            "asr_provider": session.asr_provider,
            "translation_provider": session.translation_provider,
            "status": session.status,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "created_at": session.created_at.isoformat() if session.created_at else None,
        },
        "segments": [
            {
                "id": seg.id,
                "segment_index": seg.segment_index,
                "source_language": seg.source_language,
                "source_text": seg.source_text,
                "translated_text": seg.translated_text,
                "start_ms": seg.start_ms,
                "end_ms": seg.end_ms,
                "is_final": seg.is_final,
                "confidence": seg.confidence,
                "asr_provider": seg.asr_provider,
                "translation_provider": seg.translation_provider,
                "model": seg.model,
                "latency_asr_ms": seg.latency_asr_ms,
                "latency_translate_ms": seg.latency_translate_ms,
                "status": seg.status,
                "error_message": seg.error_message,
                "created_at": seg.created_at.isoformat() if seg.created_at else None,
            }
            for seg in segments
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def export_session_csv(session: models.Session, segments: List[models.Segment]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "segment_index", "source_language", "source_text", "translated_text",
        "start_ms", "end_ms", "is_final", "confidence",
        "asr_provider", "translation_provider", "model",
        "latency_asr_ms", "latency_translate_ms", "status",
        "error_message", "created_at"
    ])
    for seg in segments:
        writer.writerow([
            seg.segment_index, seg.source_language, seg.source_text,
            seg.translated_text, seg.start_ms, seg.end_ms,
            seg.is_final, seg.confidence,
            seg.asr_provider, seg.translation_provider, seg.model,
            seg.latency_asr_ms, seg.latency_translate_ms, seg.status,
            seg.error_message,
            seg.created_at.isoformat() if seg.created_at else None,
        ])
    return output.getvalue()
