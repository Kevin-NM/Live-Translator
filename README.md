# Live Translator

本機日文直播字幕實驗版。Chrome 分享分頁音訊後，專案內的 Whisper large-v3-turbo 模型在 NVIDIA GPU 上辨識日文；繁中字幕與留言翻譯可接 NVIDIA Build、OpenAI Chat Completions 或自訂的相容 API。

## 開始使用（Windows）

1. 安裝 Python 3.10 以上與 NVIDIA 顯示卡驅動，並讓 CUDA 12 的 `cublas64_12.dll` 和 cuDNN 9 的 `cudnn64_9.dll` 可由系統 PATH 找到。
2. 在 PowerShell 執行 `./setup.ps1`。這會建立 `.venv`，並將語音模型下載至 `models/faster-whisper-large-v3-turbo/`，不會把大檔提交進 Git。
3. 執行 `start.bat`，瀏覽器會開啟 `http://127.0.0.1:8788`。
4. 選翻譯服務，填入該服務的 API Key；只想試日文辨識可選「只顯示日文」。按「開始擷取分頁音訊」，在 Chrome 選要看的分頁並勾選「分享分頁音訊」。

可先用音檔驗證 GPU 模型：

```powershell
.\.venv\Scripts\python.exe transcribe_file.py "D:\path\to\japanese.wav"
```

API Key 只留在網頁記憶體，重新整理後必須重填。服務名稱、模型、端點與留言習慣儲存在本機瀏覽器。自訂服務需提供完整的 `/v1/chat/completions` 網址，使用 HTTPS 或本機 HTTP。若是沒有 Key 的本機服務，可以留空。

## 目前範圍

- 日文字幕約每 0.8 秒更新一次暫定結果；靜音約 0.7 秒或累積 6 秒後送出定稿。繁中只翻譯定稿，避免對每個暫定字句呼叫 API。
- 可以貼上日文留言翻譯，也能將中文留言轉成日文，並提供自己的文字風格習慣。送出聊天室由使用者自行複製貼上。
- Chrome 分頁音訊需要使用者主動選取與授權。此版未自動讀取 YouTube 聊天室，也未訓練個人模型。Whisper 的暫定字幕可能修改，背景音樂可能影響分段。

## 依據

- [faster-whisper GPU 使用說明](https://github.com/SYSTRAN/faster-whisper#gpu)
- [large-v3-turbo CTranslate2 模型](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo)
- [NVIDIA LLM API](https://docs.api.nvidia.com/nim/re/reference/llm-apis)
- [OpenAI Chat Completions API](https://developers.openai.com/api/reference/cli/resources/chat)
