from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from app.languages import LANGUAGES


PRESETS = {
    "nvidia": ("https://integrate.api.nvidia.com/v1/chat/completions", "google/gemma-4-31b-it", "NVIDIA_API_KEY"),
    "openai": ("https://api.openai.com/v1/chat/completions", "gpt-4.1-mini", "OPENAI_API_KEY"),
}

TARGET_LANGUAGES = LANGUAGES


@dataclass(frozen=True)
class TranslationConfig:
    provider: str = "none"
    endpoint: str = ""
    model: str = ""
    api_key: str = ""
    target_language: str = "zh-TW"
    source_language: str = "ja"
    reply_language: str = "ja"

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
        source_language = str(payload.get("source_language") or "ja")
        reply_language = str(payload.get("reply_language") or "ja")
        if source_language not in (*LANGUAGES, "auto") or reply_language not in LANGUAGES:
            raise ValueError("不支援的來源或回覆語言")
        if target_language not in TARGET_LANGUAGES:
            raise ValueError("不支援的字幕目標語言")
        parsed = urlparse(endpoint)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
            raise ValueError("API 網址必須是 HTTPS，或本機 HTTP")
        if not parsed.netloc or not model:
            raise ValueError("請填入 API 網址與模型名稱")
        if require_key and not key and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("請填入 API Key")
        return cls(provider, endpoint, model, key, target_language, source_language, reply_language)


async def translate(text: str, direction: str, config: TranslationConfig, style: str = "") -> str:
    if config.provider == "none":
        raise ValueError("請先選擇翻譯服務")
    if direction in ("ja-zh", "source-target"):
        source_code, target_code = config.source_language, config.target_language
        target_name, target_native = TARGET_LANGUAGES[config.target_language]
        source_name = "the automatically detected language" if source_code == "auto" else LANGUAGES[source_code][0]
        instruction = (
            f"Translate the source in {source_name} into {target_name} ({config.target_language}; {target_native}). "
            f"The entire answer must be in {target_name}. Preserve names, titles and tone. "
            "Output only the translation."
        )
        if config.target_language == "zh-TW":
            instruction += " Never answer in English. Examples: おめでとう！ → 恭喜！; 空気清浄機 → 空氣清淨機。"
    elif direction in ("zh-ja", "reply"):
        source_code, target_code = config.target_language, config.reply_language
        instruction = f"Translate the user's message from {LANGUAGES[source_code][0]} into natural {LANGUAGES[target_code][0]} for a live chat. Preserve meaning; do not invent laughter or emoji. Output only the translation."
        if style.strip():
            instruction += f"\n使用者的留言習慣：{style.strip()[:1000]}"
    else:
        raise ValueError("不支援的翻譯方向")
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    riva = config.model.startswith("nvidia/riva-translate-")
    if riva:
        if source_code == "auto": raise ValueError("Riva 留言翻譯請明確選擇來源語言；直播可由STT自動偵測")
        target_code, source_code = target_code.lower(), source_code.lower()
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
        if riva and source_code == target_code:
            return text.strip()
        if riva and source_code != "en" and target_code != "en":
            # Riva is trained/evaluated around English language pairs. Pivot rather
            # than interpreting an English response as the requested Chinese.
            payload["messages"] = [{"role": "system", "content": f"{source_code}-en"}, {"role": "user", "content": text[:4000]}]
            intermediate = await request(client, payload)
            payload["messages"] = [{"role": "system", "content": f"en-{target_code}"}, {"role": "user", "content": intermediate}]
        content = await request(client, payload)
        if target_code.lower() in ("zh-tw", "zh-cn") and len(content) >= 8 and re.search(r"[A-Za-z]", content) and not re.search(r"[\u4e00-\u9fff]", content):
            target_name, target_native = LANGUAGES[config.target_language if direction in ("ja-zh", "source-target") else config.reply_language]
            correction = (
                f"The previous answer was in English: {content[:500]}\n"
                f"Rewrite the source into {target_name}, using Chinese characters. "
                f"Output only Chinese. Source: {text[:4000]}"
            )
            if riva:
                raise ValueError(f"Riva 英文→{target_native}仍回傳非中文；請在設定確認模型版本與語言，或改用一般聊天模型")
            payload["messages"] = ([{"role": "user", "content": correction}] if config.provider == "nvidia" else
                                   [{"role": "system", "content": instruction}, {"role": "user", "content": correction}])
            content = await request(client, payload)
            if len(content) >= 8 and re.search(r"[A-Za-z]", content) and not re.search(r"[\u4e00-\u9fff]", content):
                raise ValueError(f"翻譯服務未輸出{target_native}，請更換模型或調整設定")
    return content
