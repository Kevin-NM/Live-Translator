from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


PRESETS = {
    "nvidia": ("https://integrate.api.nvidia.com/v1/chat/completions", "qwen/qwen3-next-80b-a3b-instruct", "NVIDIA_API_KEY"),
    "openai": ("https://api.openai.com/v1/chat/completions", "gpt-4.1-mini", "OPENAI_API_KEY"),
}


@dataclass(frozen=True)
class TranslationConfig:
    provider: str = "none"
    endpoint: str = ""
    model: str = ""
    api_key: str = ""

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
        parsed = urlparse(endpoint)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
            raise ValueError("API 網址必須是 HTTPS，或本機 HTTP")
        if not parsed.netloc or not model:
            raise ValueError("請填入 API 網址與模型名稱")
        if require_key and not key and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("請填入 API Key")
        return cls(provider, endpoint, model, key)


async def translate(text: str, direction: str, config: TranslationConfig, style: str = "") -> str:
    if config.provider == "none":
        raise ValueError("請先選擇翻譯服務")
    if direction == "ja-zh":
        instruction = "將日文翻譯成自然、準確的繁體中文（台灣）。保留人名、遊戲名和語氣。只輸出譯文。"
    elif direction == "zh-ja":
        instruction = "將繁體中文改寫成自然的日文直播聊天室留言。準確保留原意，不憑空加入笑聲或 emoji。只輸出日文。"
        if style.strip():
            instruction += f"\n使用者的留言習慣：{style.strip()[:1000]}"
    else:
        raise ValueError("不支援的翻譯方向")
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    payload = {
        "model": config.model,
        "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": text[:4000]}],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(config.endpoint, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise ValueError("翻譯 API 沒有回傳文字")
    return content.strip()
