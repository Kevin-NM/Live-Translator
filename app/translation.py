from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


PRESETS = {
    "nvidia": ("https://integrate.api.nvidia.com/v1/chat/completions", "google/gemma-4-31b-it", "NVIDIA_API_KEY"),
    "openai": ("https://api.openai.com/v1/chat/completions", "gpt-4.1-mini", "OPENAI_API_KEY"),
}

TARGET_LANGUAGES = {
    "zh-TW": ("Traditional Chinese used in Taiwan", "繁體中文（台灣）"),
    "zh-CN": ("Simplified Chinese", "简体中文"),
    "en": ("English", "English"),
    "ko": ("Korean", "한국어"),
}


@dataclass(frozen=True)
class TranslationConfig:
    provider: str = "none"
    endpoint: str = ""
    model: str = ""
    api_key: str = ""
    target_language: str = "zh-TW"

    @classmethod
    def from_payload(cls, payload: dict, require_key: bool = True) -> "TranslationConfig":
        provider = str(payload.get("provider", "none"))
        if provider == "none":
            return cls()
        if provider not in (*PRESETS, "custom"):
            raise ValueError("不支援的翻譯服務")
        default_endpoint, default_model, env_name = PRESETS.get(provider, ("", "", ""))
        endpoint = default_endpoint if provider in PRESETS else str(payload.get("endpoint") or "").strip()
        model = str(payload.get("model") or default_model).strip()
        key = str(payload.get("api_key") or (os.getenv(env_name) if env_name else "") or "").strip()
        target_language = str(payload.get("target_language") or "zh-TW")
        if target_language not in TARGET_LANGUAGES:
            raise ValueError("不支援的字幕目標語言")
        parsed = urlparse(endpoint)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
            raise ValueError("API 網址必須是 HTTPS，或本機 HTTP")
        if not parsed.netloc or not model:
            raise ValueError("請填入 API 網址與模型名稱")
        if require_key and not key and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("請填入 API Key")
        return cls(provider, endpoint, model, key, target_language)


async def translate(text: str, direction: str, config: TranslationConfig, style: str = "") -> str:
    if config.provider == "none":
        raise ValueError("請先選擇翻譯服務")
    if direction == "ja-zh":
        target_name, target_native = TARGET_LANGUAGES[config.target_language]
        instruction = (
            f"Translate the Japanese source into {target_name} ({config.target_language}; {target_native}). "
            f"The entire answer must be in {target_name}. Preserve names, titles and tone. "
            "Output only the translation."
        )
        if config.target_language == "zh-TW":
            instruction += " Never answer in English. Examples: おめでとう！ → 恭喜！; 空気清浄機 → 空氣清淨機。"
    elif direction == "zh-ja":
        instruction = "將繁體中文改寫成自然的日文直播聊天室留言。準確保留原意，不憑空加入笑聲或 emoji。只輸出日文。"
        if style.strip():
            instruction += f"\n使用者的留言習慣：{style.strip()[:1000]}"
    else:
        raise ValueError("不支援的翻譯方向")
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    riva = config.model.startswith("nvidia/riva-translate-")
    if riva:
        target_code = config.target_language.lower() if direction == "ja-zh" else "ja"
        source_code = "ja" if direction == "ja-zh" else "zh-tw"
        messages = [{"role": "system", "content": f"{source_code}-{target_code}"},
                    {"role": "user", "content": text[:4000]}]
    else:
        messages = ([{"role": "user", "content": f"{instruction}\n\n原文：\n{text[:4000]}"}]
                if config.provider == "nvidia" else
                [{"role": "system", "content": instruction}, {"role": "user", "content": text[:4000]}])
    payload = {
        "model": config.model,
        "messages": messages,
        "stream": False,
    }
    async def request(client: httpx.AsyncClient, body: dict) -> str:
        response = await client.post(config.endpoint, headers=headers, json=body)
        if response.is_error:
            try:
                body = response.json()
                detail = body.get("detail") or body.get("message") or body.get("error") or ""
                if isinstance(detail, dict):
                    detail = detail.get("message") or str(detail)
            except (ValueError, AttributeError):
                detail = ""
            detail = str(detail)[:300]
            if response.status_code in (404, 410):
                raise ValueError(f"模型或 API 網址無效（HTTP {response.status_code}）。請確認目前可用的模型名稱。{detail}")
            raise ValueError(f"翻譯服務回應 HTTP {response.status_code}：{detail or response.reason_phrase}")
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError("翻譯 API 沒有回傳文字")
        return content.strip()

    async with httpx.AsyncClient(timeout=30) as client:
        content = await request(client, payload)
        if direction == "ja-zh" and config.target_language in ("zh-TW", "zh-CN") and len(content) >= 8 and re.search(r"[A-Za-z]", content) and not re.search(r"[\u4e00-\u9fff]", content):
            correction = (
                f"The previous answer was in English: {content[:500]}\n"
                f"Rewrite the Japanese source into {target_name} ({config.target_language}), using Chinese characters. "
                f"Output only Chinese. Japanese source: {text[:4000]}"
            )
            payload["messages"] = messages if riva else ([{"role": "user", "content": correction}] if config.provider == "nvidia" else
                                   [{"role": "system", "content": instruction}, {"role": "user", "content": correction}])
            content = await request(client, payload)
            if len(content) >= 8 and re.search(r"[A-Za-z]", content) and not re.search(r"[\u4e00-\u9fff]", content):
                raise ValueError(f"翻譯服務未輸出{target_native}，請更換模型或調整設定")
    return content
