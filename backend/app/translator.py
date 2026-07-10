import hashlib
import logging
import re
import time
import traceback
from collections import deque
from typing import Optional

import httpx

from app import models

logger = logging.getLogger(__name__)

REALTIME_OVERRIDES = {"temperature": 0.1, "max_tokens": 128, "timeout_ms": 5000, "max_retries": 0}
QUALITY_OVERRIDES = {"temperature": 0.2, "max_tokens": 512, "timeout_ms": 8000, "max_retries": 2}
TEST_SENTENCES = [
    {"lang": "ja", "text": "いや、これはさすがに無理でしょ。今のタイミングで突っ込むのは危なすぎるって。"},
    {"lang": "en", "text": "Wait, there is no way he just survived that. That timing was actually insane."},
]

_contracts: deque[dict] = deque(maxlen=200)
_http_client: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    """Reuse connections so live subtitles do not pay a TLS handshake per segment."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))
    return _http_client


async def close_http_client():
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


def build_translation_messages(
    source_language: str,
    target_language: str,
    source_text: str,
    variant: str = "chat_prompt",
) -> tuple[str, str]:
    if variant == "minimal_prompt":
        return "", source_text
    if variant == "zh_direct_prompt":
        language_name = "日文" if source_language == "ja" else "英文" if source_language == "en" else source_language
        return "", f"{language_name}翻成台灣繁體中文，只輸出譯文：\n{source_text}"

    if target_language == "zh-TW":
        # Short prompts improve first-token latency and reduce instruction echo.
        return (
            "你是即時字幕翻譯器。只輸出台灣繁體中文譯文，不解釋、不重複原文。",
            f"將以下{source_language}字幕翻成台灣繁體中文，只輸出譯文：\n{source_text}",
        )
    return (
        f"You translate live subtitles into {target_language}. Output only the translation.",
        source_text,
    )


def _prompt_variant_for_model(model: str) -> str:
    name = (model or "").lower()
    return "zh_direct_prompt" if "riva-translate" in name or "translate" in name else "chat_prompt"


def mask_api_key(key: str) -> str:
    if not key or len(key) <= 10:
        return "***"
    return key[:6] + "..." + key[-4:]


def sanitize_output(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"^```[\w]*\n?", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n?```$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\s]*[-*]\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^(?:翻譯|譯文|Translation)[：:]\s*", "", text, flags=re.IGNORECASE).strip()
    json_match = re.search(r'\{[^{}]*"(?:translation|translated_text|text|output)"\s*:\s*"([^"]+)"[^{}]*\}', text)
    return json_match.group(1).strip() if json_match else text


def get_translation_contracts(session_id: Optional[int] = None, limit: int = 20) -> list[dict]:
    rows = list(_contracts)
    if session_id is not None:
        rows = [row for row in rows if row.get("session_id") == session_id]
    return list(reversed(rows[-max(1, min(limit, 100)):]))


class TranslationResult:
    def __init__(self, translated_text: str, model: str, provider_name: str,
                 latency_ms: float, status: str, error_message: Optional[str] = None,
                 http_status: Optional[int] = None, raw_response_preview: Optional[str] = None,
                 contract: Optional[dict] = None):
        self.translated_text = translated_text
        self.model = model
        self.provider_name = provider_name
        self.latency_ms = latency_ms
        self.status = status
        self.error_message = error_message
        self.http_status = http_status
        self.raw_response_preview = raw_response_preview
        self.contract = contract


async def translate_text(
    provider: models.ProviderConfig,
    source_text: str,
    source_language: str,
    mode: str = "realtime",
    target_language: str = "zh-TW",
    route: str = "manual",
    session_id: Optional[int] = None,
    prompt_variant: Optional[str] = None,
) -> TranslationResult:
    defaults = REALTIME_OVERRIDES if mode == "realtime" else QUALITY_OVERRIDES
    prompt_variant = prompt_variant or _prompt_variant_for_model(provider.model)
    temperature = min(float(provider.temperature), defaults["temperature"])
    max_tokens = min(int(provider.max_tokens), defaults["max_tokens"])
    timeout_ms = min(int(provider.timeout_ms), defaults["timeout_ms"]) if mode == "realtime" else int(provider.timeout_ms)
    max_retries = 0 if mode == "realtime" else min(int(provider.max_retries), defaults["max_retries"])
    system_prompt, user_prompt = build_translation_messages(source_language, target_language, source_text, prompt_variant)
    base_url = provider.base_url.rstrip("/")
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})
    payload = {"model": provider.model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    contract = {
        "timestamp": time.time(), "session_id": session_id, "route": route,
        "provider_id": provider.id, "provider_name": provider.provider_name,
        "model": provider.model, "base_url": base_url,
        "source_language": source_language, "target_language": target_language,
        "mode": mode, "prompt_builder": prompt_variant,
        "system_prompt": system_prompt, "user_prompt": user_prompt,
        "source_text": source_text, "timeout_ms": timeout_ms,
        "max_tokens": max_tokens, "temperature": temperature,
        "system_prompt_hash": hashlib.sha256(system_prompt.encode()).hexdigest()[:12],
        "user_prompt_hash": hashlib.sha256(user_prompt.encode()).hexdigest()[:12],
        "raw_output_preview": "", "normalized_output": "", "final_status": "pending",
    }
    _contracts.append(contract)
    logger.info(
        "Translation contract: route=%s provider_id=%s model=%s source_language=%s "
        "target_language=%s prompt_builder=%s system_prompt_hash=%s user_prompt_hash=%s source_text_preview=%r",
        route, provider.id, provider.model, source_language, target_language, prompt_variant,
        contract["system_prompt_hash"], contract["user_prompt_hash"], source_text[:80],
    )

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {provider.api_key}"}
    last_error = None
    for attempt in range(max_retries + 1):
        started = time.monotonic()
        try:
            resp = await _client().post(
                f"{base_url}/chat/completions", json=payload, headers=headers,
                timeout=httpx.Timeout(timeout_ms / 1000.0),
            )
            latency_ms = (time.monotonic() - started) * 1000
            raw_preview = resp.text[:1000]
            contract["http_status"] = resp.status_code
            contract["latency_ms"] = round(latency_ms, 2)
            contract["raw_output_preview"] = raw_preview
            if resp.status_code != 200:
                last_error = "Authentication failed (401). Check your API key." if resp.status_code == 401 else f"API returned status {resp.status_code}: {resp.text[:200]}"
                if attempt < max_retries and resp.status_code in (429, 500, 502, 503, 504):
                    continue
                contract["final_status"] = "error"
                contract["error_message"] = last_error
                return TranslationResult("", provider.model, provider.provider_name, latency_ms, "error", last_error, resp.status_code, raw_preview, contract)
            data = resp.json()
            raw_text = data["choices"][0]["message"]["content"]
            translated = sanitize_output(raw_text)
            contract["raw_output_preview"] = raw_text[:1000]
            contract["normalized_output"] = translated
            contract["final_status"] = "completed"
            return TranslationResult(translated, provider.model, provider.provider_name, latency_ms, "completed", http_status=200, raw_response_preview=raw_preview, contract=contract)
        except httpx.TimeoutException:
            latency_ms = (time.monotonic() - started) * 1000
            last_error = f"Request timed out after {timeout_ms / 1000:g}s"
            if attempt < max_retries:
                continue
        except Exception as exc:
            latency_ms = (time.monotonic() - started) * 1000
            last_error = str(exc)
            logger.error("translate_text exception: %s\n%s", exc, traceback.format_exc())
        contract["final_status"] = "error"
        contract["error_message"] = last_error
        contract["latency_ms"] = round(latency_ms, 2)
        return TranslationResult("", provider.model, provider.provider_name, latency_ms, "error", last_error, contract=contract)

    return TranslationResult("", provider.model, provider.provider_name, 0, "error", last_error or "Unknown error", contract=contract)


async def test_provider(provider: models.ProviderConfig) -> list[TranslationResult]:
    results = []
    for sentence in TEST_SENTENCES:
        results.append(await translate_text(provider, sentence["text"], sentence["lang"], route="provider_test"))
    return results
