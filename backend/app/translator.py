import time
import httpx
from typing import Optional
from app import models


SYSTEM_PROMPT = """你是即時直播字幕翻譯器。
任務：將輸入的英文或日文直播字幕翻成台灣繁體中文。

要求：
- 只輸出繁體中文譯文。
- 不要加「翻譯：」。
- 不要解釋。
- 不要補充原文沒有的資訊。
- 保持直播語氣自然、口語、短句。
- 專有名詞、人名、作品名、遊戲術語盡量使用台灣常見譯名。
- 日文語助詞、口頭禪要自然轉成中文，不要逐字硬翻。
- 英文直播語氣要翻得像台灣人會講的話。
- 如果原文不完整，請給自然短譯。
- 如果內容破碎，請用「……」，不要亂猜。

輸出格式：
只輸出譯文，不要輸出 JSON，不要輸出 Markdown。"""


REALTIME_OVERRIDES = {
    "temperature": 0.1,
    "max_tokens": 256,
    "timeout_ms": 3000,
    "max_retries": 1,
}

QUALITY_OVERRIDES = {
    "temperature": 0.2,
    "max_tokens": 512,
    "timeout_ms": 8000,
    "max_retries": 2,
}


def build_user_prompt(source_text: str, source_language: str) -> str:
    lang_label = source_language if source_language != "auto" else "auto"
    return f"請翻譯以下直播字幕成台灣繁體中文：\n\n[語言: {lang_label}]\n{source_text}"


class TranslationResult:
    def __init__(self, translated_text: str, model: str, provider_name: str,
                 latency_ms: float, status: str, error_message: Optional[str] = None):
        self.translated_text = translated_text
        self.model = model
        self.provider_name = provider_name
        self.latency_ms = latency_ms
        self.status = status
        self.error_message = error_message


async def translate_text(
    provider: models.ProviderConfig,
    source_text: str,
    source_language: str,
    mode: str = "realtime",
) -> TranslationResult:
    overrides = REALTIME_OVERRIDES if mode == "realtime" else QUALITY_OVERRIDES
    temperature = overrides["temperature"]
    max_tokens = overrides["max_tokens"]
    timeout_s = overrides["timeout_ms"] / 1000.0
    max_retries = overrides["max_retries"]

    user_prompt = build_user_prompt(source_text, source_language)

    base_url = provider.base_url.rstrip("/")
    url = f"{base_url}/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {provider.api_key}",
    }

    payload = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    last_error = None
    for attempt in range(max_retries + 1):
        start_time = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(url, json=payload, headers=headers)
                latency_ms = (time.monotonic() - start_time) * 1000

                if resp.status_code == 401:
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message="Authentication failed (401). Check your API key."
                    )

                if resp.status_code == 429:
                    last_error = "Rate limited (429). Please wait and try again."
                    if attempt < max_retries:
                        continue
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message=last_error
                    )

                if resp.status_code != 200:
                    last_error = f"API returned status {resp.status_code}: {resp.text[:200]}"
                    if attempt < max_retries:
                        continue
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message=last_error
                    )

                data = resp.json()
                try:
                    translated = data["choices"][0]["message"]["content"].strip()
                except (KeyError, IndexError) as e:
                    return TranslationResult(
                        translated_text="", model=provider.model,
                        provider_name=provider.provider_name,
                        latency_ms=latency_ms, status="error",
                        error_message=f"Unexpected response format: {e}"
                    )

                return TranslationResult(
                    translated_text=translated, model=provider.model,
                    provider_name=provider.provider_name,
                    latency_ms=latency_ms, status="completed"
                )

        except httpx.TimeoutException:
            latency_ms = (time.monotonic() - start_time) * 1000
            last_error = f"Request timed out after {timeout_s}s"
            if attempt < max_retries:
                continue
            return TranslationResult(
                translated_text="", model=provider.model,
                provider_name=provider.provider_name,
                latency_ms=latency_ms, status="error",
                error_message=last_error
            )
        except httpx.ConnectError as e:
            latency_ms = (time.monotonic() - start_time) * 1000
            last_error = f"Connection error: {e}"
            if attempt < max_retries:
                continue
            return TranslationResult(
                translated_text="", model=provider.model,
                provider_name=provider.provider_name,
                latency_ms=latency_ms, status="error",
                error_message=last_error
            )
        except Exception as e:
            latency_ms = (time.monotonic() - start_time) * 1000
            return TranslationResult(
                translated_text="", model=provider.model,
                provider_name=provider.provider_name,
                latency_ms=latency_ms, status="error",
                error_message=str(e)
            )

    return TranslationResult(
        translated_text="", model=provider.model,
        provider_name=provider.provider_name,
        latency_ms=0, status="error",
        error_message=last_error or "Unknown error"
    )


TEST_SENTENCES = [
    {
        "lang": "ja",
        "text": "いや、これはさすがに無理でしょ。今のタイミングで突っ込むのは危なすぎるって。"
    },
    {
        "lang": "en",
        "text": "Wait, there is no way he just survived that. That timing was actually insane."
    },
]


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
