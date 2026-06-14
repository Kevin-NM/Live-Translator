import logging
import re
import time
import traceback
import httpx
from typing import Optional
from app import models

logger = logging.getLogger(__name__)


def build_translation_messages(source_language: str, target_language: str, source_text: str) -> tuple[str, str]:
    if target_language == "zh-TW":
        system_prompt = (
            "你是即時直播字幕翻譯器。\n"
            "請將輸入的英文或日文即時字幕翻譯成台灣繁體中文。\n"
            "只輸出台灣繁體中文。\n"
            "不要輸出英文。\n"
            "不要輸出日文原文。\n"
            "不要加「翻譯：」。\n"
            "不要解釋。\n"
            "不要補充原文沒有的資訊。\n"
            "保持直播語氣自然、口語、短句。\n"
            "專有名詞、人名、作品名、遊戲術語盡量使用台灣常見譯名。\n"
            "日文語助詞、口頭禪要自然轉成中文，不要逐字硬翻。\n"
            "英文直播語氣要翻得像台灣人會講的話。\n"
            "如果原文不完整，請給自然短譯。\n"
            "如果內容破碎，請用「……」，不要亂猜。\n\n"
            "輸出格式：\n"
            "只輸出譯文，不要輸出 JSON，不要輸出 Markdown。"
        )
        user_prompt = (
            f"請將以下即時字幕翻譯成台灣繁體中文。\n"
            f"只能輸出台灣繁體中文，不要輸出英文，不要解釋。\n\n"
            f"[來源語言: {source_language}]\n"
            f"[目標語言: zh-TW]\n"
            f"[原文]\n"
            f"{source_text}"
        )
    else:
        system_prompt = (
            f"You are a live subtitle translator.\n"
            f"Translate the input subtitles into {target_language}.\n"
            f"Output only the translation.\n"
            f"Do not explain.\n"
            f"Keep the tone natural and conversational.\n\n"
            f"Output format:\n"
            f"Only output the translation, no JSON, no Markdown."
        )
        user_prompt = (
            f"Translate the following live subtitle into {target_language}.\n\n"
            f"[Source language: {source_language}]\n"
            f"[Target language: {target_language}]\n"
            f"[Original]\n"
            f"{source_text}"
        )

    return system_prompt, user_prompt


REALTIME_OVERRIDES = {
    "temperature": 0.1,
    "max_tokens": 256,
    "timeout_ms": 5000,
    "max_retries": 1,
}

QUALITY_OVERRIDES = {
    "temperature": 0.2,
    "max_tokens": 512,
    "timeout_ms": 8000,
    "max_retries": 2,
}

TEST_SENTENCES = [
    {"lang": "ja", "text": "いや、これはさすがに無理でしょ。今のタイミングで突っ込むのは危なすぎるって。"},
    {"lang": "en", "text": "Wait, there is no way he just survived that. That timing was actually insane."},
]


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
    text = re.sub(r"^翻譯[：:]\s*", "", text)
    text = re.sub(r"^譯文[：:]\s*", "", text)
    text = re.sub(r"^Translation[：:]\s*", "", text, flags=re.IGNORECASE)
    text = text.strip()
    if not text:
        return "empty_response"
    json_match = re.search(r'\{[^{}]*"(?:translation|translated_text|text|output)"\s*:\s*"([^"]+)"[^{}]*\}', text)
    if json_match:
        return json_match.group(1).strip()
    if text.startswith("{") or text.startswith("["):
        return text
    return text


class TranslationResult:
    def __init__(self, translated_text: str, model: str, provider_name: str,
                 latency_ms: float, status: str, error_message: Optional[str] = None,
                 http_status: Optional[int] = None, raw_response_preview: Optional[str] = None):
        self.translated_text = translated_text
        self.model = model
        self.provider_name = provider_name
        self.latency_ms = latency_ms
        self.status = status
        self.error_message = error_message
        self.http_status = http_status
        self.raw_response_preview = raw_response_preview


async def translate_text(
    provider: models.ProviderConfig,
    source_text: str,
    source_language: str,
    mode: str = "realtime",
    target_language: str = "zh-TW",
) -> TranslationResult:
    overrides = REALTIME_OVERRIDES if mode == "realtime" else QUALITY_OVERRIDES
    temperature = overrides["temperature"]
    max_tokens = overrides["max_tokens"]
    timeout_s = overrides["timeout_ms"] / 1000.0
    max_retries = overrides["max_retries"]

    system_prompt, user_prompt = build_translation_messages(source_language, target_language, source_text)

    base_url = provider.base_url.rstrip("/")
    url = f"{base_url}/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {provider.api_key}",
    }

    payload = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    logger.info(
        f"translate_text: provider_id={provider.id} provider_name={provider.provider_name} "
        f"base_url={base_url} model={provider.model} api_key={mask_api_key(provider.api_key)} "
        f"timeout_ms={overrides['timeout_ms']} max_tokens={max_tokens} temperature={temperature} "
        f"source_language={source_language} target_language={target_language} mode={mode} "
        f"prompt=build_translation_messages"
    )

    last_error = None
    for attempt in range(max_retries + 1):
        start_time = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(url, json=payload, headers=headers)
                latency_ms = (time.monotonic() - start_time) * 1000
                raw_preview = resp.text[:1000]

                logger.info(
                    f"translate_text: attempt={attempt} http_status={resp.status_code} "
                    f"latency_ms={latency_ms:.1f} raw_preview={raw_preview[:200]}"
                )

                if resp.status_code == 401:
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message="Authentication failed (401). Check your API key.",
                        http_status=401, raw_response_preview=raw_preview,
                    )

                if resp.status_code == 429:
                    last_error = "Rate limited (429). Please wait and try again."
                    if attempt < max_retries:
                        continue
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message=last_error,
                        http_status=429, raw_response_preview=raw_preview,
                    )

                if resp.status_code != 200:
                    last_error = f"API returned status {resp.status_code}: {resp.text[:200]}"
                    if attempt < max_retries:
                        continue
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message=last_error,
                        http_status=resp.status_code, raw_response_preview=raw_preview,
                    )

                data = resp.json()
                try:
                    raw_text = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as e:
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message=f"Unexpected response format: {e}",
                        http_status=resp.status_code, raw_response_preview=raw_preview,
                    )

                translated = sanitize_output(raw_text)
                logger.info(f"translate_text: result='{translated[:80]}' status=completed")

                return TranslationResult(
                    translated_text=translated, model=provider.model,
                    provider_name=provider.provider_name,
                    latency_ms=latency_ms, status="completed",
                    http_status=resp.status_code, raw_response_preview=raw_preview,
                )

        except httpx.TimeoutException:
            latency_ms = (time.monotonic() - start_time) * 1000
            last_error = f"Request timed out after {timeout_s}s"
            logger.warning(f"translate_text: timeout attempt={attempt} latency_ms={latency_ms:.1f}")
            if attempt < max_retries:
                continue
            return TranslationResult(
                translated_text="", model=provider.model,
                provider_name=provider.provider_name,
                latency_ms=latency_ms, status="error",
                error_message=last_error,
            )
        except httpx.ConnectError as e:
            latency_ms = (time.monotonic() - start_time) * 1000
            last_error = f"Connection error: {e}"
            logger.warning(f"translate_text: connect error attempt={attempt}: {e}")
            if attempt < max_retries:
                continue
            return TranslationResult(
                translated_text="", model=provider.model,
                provider_name=provider.provider_name,
                latency_ms=latency_ms, status="error",
                error_message=last_error,
            )
        except Exception as e:
            latency_ms = (time.monotonic() - start_time) * 1000
            tb = traceback.format_exc()
            logger.error(f"translate_text: exception: {e}\n{tb}")
            return TranslationResult(
                translated_text="", model=provider.model,
                provider_name=provider.provider_name,
                latency_ms=latency_ms, status="error",
                error_message=str(e),
            )

    return TranslationResult(
        translated_text="", model=provider.model,
        provider_name=provider.provider_name,
        latency_ms=0, status="error",
        error_message=last_error or "Unknown error",
    )


async def test_provider(provider: models.ProviderConfig) -> list[TranslationResult]:
    results = []
    for sentence in TEST_SENTENCES:
        result = await translate_text(
            provider=provider,
            source_text=sentence["text"],
            source_language=sentence["lang"],
            mode="realtime",
        )
        results.append(result)
    return results
