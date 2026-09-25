# Live Translator

Chrome 擴充功能擷取 YouTube 分頁音訊，本機 Whisper `large-v3-turbo` 辨識日文，將日文與繁體中文字幕直接疊在影片上。側邊欄有「字幕」、「留言」、「設定」三個頁籤；留言頁可手動貼入日文翻譯，也能把繁中留言翻成日文。翻譯支援 NVIDIA Build、OpenAI v1 Chat Completions，以及自訂相容 API。

## 安裝與啟動（Windows）

1. 安裝 Python 3.10 以上、NVIDIA 顯示卡驅動，並確保 CUDA 12 的 `cublas64_12.dll`、cuDNN 9 的 `cudnn64_9.dll` 可由 PATH 找到。
2. 在 PowerShell 執行 `./setup.ps1`。它會安裝依賴並下載語音模型到專案內的 `models/faster-whisper-large-v3-turbo/`。
3. 在 Chrome 輸入 `chrome://extensions`，開啟「開發人員模式」，按「載入未封裝項目」，選取本專案的 `chrome-extension` 資料夾。
4. 執行 `start.bat`，讓本機服務維持執行。它只監聽 `127.0.0.1:8788`。
5. 開啟 YouTube 影片，點 Chrome 工具列的 Live Translator 圖示。側邊欄「設定」選 NVIDIA、OpenAI 或自訂服務，填 API Key，按「儲存設定」再按「測試翻譯」。
6. 在「字幕」按「開始擷取目前分頁」。日文暫定文字及定稿的日文／繁中字幕會出現在 YouTube 影片上。使用 Chrome 工具列圖示也可開啟側邊欄並啟動。停止時按「停止」；結束使用時關閉 `start.bat` 的命令視窗。

API Key 與留言習慣保存在這台電腦的 Chrome 擴充功能儲存空間，重新開啟仍可使用。Chrome 本機儲存空間不是加密保管庫；使用共用電腦時請自行移除金鑰。金鑰只送到本機服務，供它向所選翻譯 API 發出請求；不會寫進專案檔案或 Git。設定變更後，正在執行的字幕需停止並重新開始才會使用新設定。

NVIDIA 預設模型為 `google/gemma-4-31b-it`。先前的 `qwen/qwen3-next-80b-a3b-instruct` 已於 2026-07-27 停用，會造成翻譯請求失敗。可在設定頁輸入 NVIDIA Build 目前提供的其他模型 ID。OpenAI 預設使用 `https://api.openai.com/v1/chat/completions` 與 `gpt-4.1-mini`。自訂端點需提供完整的 `/chat/completions` 網址；支援 HTTPS 或本機 HTTP。

本機語音模型可用音檔先測試：

```powershell
.\.venv\Scripts\python.exe transcribe_file.py "D:\path\to\japanese.wav"
```

## 目前範圍

- 日文暫定字幕約每 0.8 秒更新；靜音約 0.7 秒或累積 6 秒後定稿，繁中只翻譯定稿。翻譯要等到一句定稿及 API 回應後才會出現，因此仍有延遲。
- YouTube 影片上顯示字幕；聊天室留言目前須手動貼到側邊欄，翻好的日文須自行複製貼上。尚未自動讀取或填入 YouTube 聊天室，也尚未訓練個人回覆模型。
- 擷取需要使用者在 YouTube 分頁主動啟動擴充功能。本機服務關閉後翻譯與語音辨識都無法運作。

## 參考資料

- [Chrome tabCapture 與 offscreen 文件](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [NVIDIA Gemma 4 31B API](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer)
- [faster-whisper GPU 使用說明](https://github.com/SYSTRAN/faster-whisper#gpu)
