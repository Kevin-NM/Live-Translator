LANGUAGES = {
    "ja": ("Japanese", "日文"), "en": ("English", "英文"),
    "zh-TW": ("Traditional Chinese used in Taiwan", "繁體中文（台灣）"),
    "zh-CN": ("Simplified Chinese", "简体中文"), "ko": ("Korean", "韓文"),
    "fr": ("French", "法文"), "de": ("German", "德文"), "es": ("Spanish", "西班牙文"),
    "pt": ("Portuguese", "葡萄牙文"), "ru": ("Russian", "俄文"), "vi": ("Vietnamese", "越南文"),
}

def whisper_language(code):
    if code == "auto": return None
    if code not in LANGUAGES: raise ValueError("不支援的來源語言")
    return "zh" if code.startswith("zh-") else code
