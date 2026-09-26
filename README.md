# Live Translator

Chrome 擴充功能擷取 YouTube 分頁音訊，本機 Whisper `large-v3-turbo` 辨識日文，將日文與繁體中文字幕直接疊在影片上。側邊欄有「字幕」、「留言」、「設定」三個頁籤；留言頁可手動貼入日文翻譯，也能把繁中留言翻成日文。翻譯支援 NVIDIA Build、OpenAI v1 Chat Completions，以及自訂相容 API。

## 安裝與啟動（Windows）

1. 安裝 Python 3.10 以上、NVIDIA 顯示卡驅動，並確保 CUDA 12 的 `cublas64_12.dll`、cuDNN 9 的 `cudnn64_9.dll` 可由 PATH 找到。
2. 在 PowerShell 執行 `./setup.ps1`。它會安裝依賴並下載語音模型到專案內的 `models/faster-whisper-large-v3-turbo/`。
3. 在 Chrome 輸入 `chrome://extensions`，開啟「開發人員模式」，按「載入未封裝項目」，選取本專案的 `chrome-extension` 資料夾。
4. 執行 `start.bat`，讓本機服務維持執行。它只監聽 `127.0.0.1:8788`。
5. 開啟並播放 YouTube 影片，點 Chrome 工具列的 Live Translator 圖示。側邊欄「設定」選 NVIDIA、OpenAI 或自訂服務，填 API Key，選字幕目標語言（預設繁體中文，可選简体中文、English、한국어）及觀看延遲，按「儲存設定」再按「測試翻譯」。預設延遲為 2 秒，也可選 0、4 或 6 秒。目標語言切換會自動儲存；按開始也會保存目前設定。
6. 在「字幕」按「開始擷取目前分頁」。日文暫定文字及定稿的日文／繁中字幕會出現在 YouTube 影片上。使用 Chrome 工具列圖示也可開啟側邊欄並啟動。停止時按「停止」；結束使用時關閉 `start.bat` 的命令視窗。

API Key 與留言習慣保存在這台電腦的 Chrome 擴充功能儲存空間，重新開啟仍可使用。Chrome 本機儲存空間不是加密保管庫；使用共用電腦時請自行移除金鑰。金鑰只送到本機服務，供它向所選翻譯 API 發出請求；不會寫進專案檔案或 Git。設定變更後，正在執行的字幕需停止並重新開始才會使用新設定。

觀看延遲讓辨識先處理當下的聲音，再把你聽到的聲音與看到的影片一起延後。2 秒適合短句；一句話本身超過 2 秒或 API 花更久回應時，完整譯文仍可能晚到。4／6 秒較有機會在說話開始時顯示完整譯文，但你也會離直播現場更遠。0.3.1 使用最高 640 像素寬、最高約 24fps 的可重用畫格緩衝，減少持續配置造成的卡頓，仍可能降低清晰度；受保護影片可能拒絕畫布取格。若延遲模式停止並顯示畫面錯誤，改選「不延遲」。暫停會凍結緩衝画面並暫停擴充功能的音訊處理，繼續時調整時間軸。跳轉會停止擷取，需按開始重建字幕時間軸；廣告切換仍可能影響同步。

修改擴充功能程式檔案後，需在 `chrome://extensions` 按該擴充功能的「重新載入」，再重新整理 YouTube 分頁。只重新整理 YouTube 不會更新擴充功能程式。

0.4.0 新增「日文辨識模式」與「辨識詞彙提示」。預設準確優先：定稿 beam size 5、固定解碼溫度與 Silero VAD；速度優先仍為 beam size 1。暫定辨識每約 1.6 秒更新，開始發話前保留最多 0.4 秒低音量音訊，減少漏掉開頭。人名／團名可填日文詞彙提示，避免用辨識錯的前一句自動強化錯誤。這些參數尚未用標註音訊量化準確度，多人重疊、音樂與生僻名字仍可能辨識錯誤。設定變更需重啟擷取，更新至本版也需重啟本機服務。

0.3.1 版設定頁會顯示擴充功能版本，並檢查本機服務協定版本。遇到「本機服務仍是舊版」時，關閉原本的服務視窗，再執行 `start.bat`。啟動擷取會先檢查並補載 YouTube 字幕腳本，確認影片緩衝圖層可顯示，才接通延遲音訊；失敗會停止擷取並顯示原因。延後畫面與字幕共用圖層，位於原影片上方、YouTube 原生控制列下方，指標事件穿透。

NVIDIA 預設模型為 `google/gemma-4-31b-it`。先前的 `qwen/qwen3-next-80b-a3b-instruct` 已於 2026-07-27 停用，會造成翻譯請求失敗。可在設定頁輸入 NVIDIA Build 目前提供的其他模型 ID。OpenAI 預設使用 `https://api.openai.com/v1/chat/completions` 與 `gpt-4.1-mini`。自訂端點需提供完整的 `/chat/completions` 網址；支援 HTTPS 或本機 HTTP。

選用 `nvidia/riva-translate-*` 時，後端依其[官方格式](https://build.nvidia.com/nvidia/riva-translate-4b-instruct-v2/modelcard)以 system 訊息傳遞語言代碼，user 訊息只放原文。非英文語言對改經英文中轉，例如日文→英文→繁中，每句兩次 API 請求，會增加時間與費用。專用翻譯模型不套用個人留言風格；實際品質仍須以你的 API 測試確認。

本機語音模型可用音檔先測試：

```powershell
.\.venv\Scripts\python.exe transcribe_file.py "D:\path\to\japanese.wav"
```

## 目前範圍

- 日文暫定字幕約每 1.6 秒更新；靜音約 0.7 秒或累積 6 秒後定稿，繁中只翻譯定稿。觀看延遲能讓部分譯文在你看到對應畫面前完成，但不保證所有長句或慢速 API 都能提前顯示。
- YouTube 影片上顯示字幕；聊天室留言目前須手動貼到側邊欄，翻好的日文須自行複製貼上。尚未自動讀取或填入 YouTube 聊天室，也尚未訓練個人回覆模型。
- 擷取需要使用者在 YouTube 分頁主動啟動擴充功能。本機服務關閉後翻譯與語音辨識都無法運作。

## 參考資料

- [Chrome tabCapture 與 offscreen 文件](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [NVIDIA Gemma 4 31B API](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer)
- [faster-whisper GPU 使用說明](https://github.com/SYSTRAN/faster-whisper#gpu)
