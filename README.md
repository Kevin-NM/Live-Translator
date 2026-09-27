# Live Translator

[![Tests](https://github.com/Kevin-NM/Live-Translator/actions/workflows/test.yml/badge.svg)](https://github.com/Kevin-NM/Live-Translator/actions/workflows/test.yml)

**本機辨識多語直播，自選 API 翻譯字幕與留言。**

Live Translator 提供 WebUI 與 Chrome 側邊欄，兩者都能控制原 YouTube 分頁的字幕。本機 faster-whisper 處理音訊，翻譯服務只收到辨識文字；直播、現有字幕與留言可以使用不同的 API、模型和金鑰。擴充功能負責背景橋接與影片字幕層，日常操作可全程使用 WebUI。

**目前工作目錄：0.9.1；公開下載仍為 0.8.0。新版 WebUI 橋接請使用此 repo 的 chrome-extension 資料夾。**

**[下載完整專案 0.8.0](https://github.com/Kevin-NM/Live-Translator/releases/download/v0.8.0/Live-Translator-v0.8.0.zip)** · [下載 Chrome 擴充功能](https://github.com/Kevin-NM/Live-Translator/releases/download/v0.8.0/Live-Translator-Chrome-v0.8.0.zip) · [發行說明](https://github.com/Kevin-NM/Live-Translator/releases/tag/v0.8.0)

## 功能

- **影片字幕**：Chrome 擴充功能直接在 YouTube 影片上顯示譯文，支援 11 種語言與雙語模式，日文只是預設來源語言。
- **觀看延遲**：畫面與聲音一起延後 0–12 秒，讓辨識與翻譯有時間完成；顯示最近一句的耗時與缓衝需求估計。
- **WebUI 操作**：選擇原 YouTube 分頁，控制擷取、整份字幕翻譯、停止及字幕大小／位置／底色；影片留在 YouTube，不使用內嵌播放器。WebUI 與側邊欄共用設定與工作狀態。
- **留言助手**：留言翻譯、自選回覆語言、回覆風格提示與一鍵複製。可沿用直播 API 或使用獨立設定。
- **模型選擇**：本機 Large v3 Turbo、Large v3、Medium、Small；API 模型 ID 可直接編輯。
- **現有字幕翻譯**：明確選擇影片字幕來源、人工／自動字幕軌道，預先翻譯並依影片時間顯示；不需 Whisper 或音訊擷取。
- **整場轉錄**：本機保存原文與完成譯文，匯出 SRT、ASS、TXT，支援影片時間對齊。
- **API 服務**：NVIDIA Build、OpenAI `/v1/chat/completions`、自訂相容端點。

## 快速開始（Windows）

### 1. 環境與安裝

需要 **Python 3.10+、桌面版 Chrome**。語音辨識需要 NVIDIA GPU、對應驅動與 CUDA 12 cuBLAS / cuDNN 9，且 DLL 可從 `PATH` 找到。只有留言翻譯時不需要載入 GPU 模型。

```powershell
git clone https://github.com/Kevin-NM/Live-Translator.git
cd Live-Translator
.\setup.ps1
```

安裝腳本建立 `.venv`、安裝依賴、建置 Web GUI，並把預設語音模型下載到專案的 `models/faster-whisper-large-v3-turbo/`。模型檔案不放入 GitHub。若 PowerShell 阻擋腳本，可針對這次程序執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

GPU 環境詳見 [faster-whisper 官方安裝說明](https://github.com/SYSTRAN/faster-whisper#gpu)。

### 2. 啟動 Web GUI

```powershell
.\start.bat
```

會開啟 [本機 Web GUI](http://127.0.0.1:8788)。保持服務視窗開啟；結束時在該視窗按 `Ctrl+C`。服務只監聽本機，沒有部署成公開網站。

先依下一節載入擴充功能，然後在 Chrome 開啟此 WebUI。「要控制的 YouTube 分頁」選擇正在播放的影片；開啟新影片後按「更新分頁」。在「模型與設定」填直播翻譯 API，儲存並測試；「04 / 影片上的字幕」可調整字級（12–96px）、位置、寬度與底色。

按「分享選定分頁並開始」，在 Chrome 分享視窗選擇**同一個 YouTube 分頁**，勾選 **分享分頁音訊**。WebUI 保留字幕紀錄，字幕顯示在原 YouTube 影片上；全螢幕仍使用 YouTube 自己的按鈕。來源不一致會拒絕啟動。分頁確認兩分鐘內有效，過期請按「更新分頁」。現有字幕模式不需要分享音訊。

一般網頁無法直接控制其他分頁或注入字幕，所以仍需擴充功能做背景橋接；不必開啟它的側邊欄。WebUI 音訊分享使用 Chrome 的 [Capture Handle](https://developer.chrome.com/docs/web-platform/capture-handle) 確認來源；無來源確認支援、未分享音訊、或延遲時無法抑制原聲，會明確報錯。

### 3. Chrome 影片字幕

1. 開啟 `chrome://extensions`，啟用「開發人員模式」。
2. 按「載入未封裝項目」，選取本專案的 `chrome-extension` 資料夾。
3. 開啟並播放 YouTube 影片，點 Live Translator 圖示開啟側邊欄。
4. 在「模型與設定」填 API，選擇語言、字幕大小、觀看延遲，儲存並測試。
5. 按「開始擷取目前分頁」；字幕會出現在影片上。停止時按「停止」。

WebUI 與擴充功能共用 Chrome 本機設定與同一字幕工作；可從任一介面停止，API／辨識變更在下次開始生效。一次只允許一個工作。WebUI 啟動的音訊擷取在關閉／刷新 WebUI 時停止；擴充功能啟動的音訊工作及現有字幕工作不依賴 WebUI 保持開啟。橋接只允許 `http://127.0.0.1:8788/`，請使用 Chrome 與相同使用者設定檔，不支援 localhost 別名或其他埠。舊 WebUI localStorage 設定仍保留，但不會自動覆寫擴充功能設定。

## 一般影片：翻譯現有字幕

影片已經有字幕、卻没有你想看的語言時，可跳過語音辨識：

1. 在「即時字幕 → **字幕來源**」選 **影片現有字幕（不擷取聲音）**。
2. 擴充功能可留空網址讀取目前分頁；WebUI 可留空讀取上方選定的 YouTube 分頁。更換影片後請重新讀取列表。
3. 按「**讀取字幕列表**」，選人工或自動字幕軌道，再按「**載入選定字幕**」。
4. 確認句數與輸出語言；「直播翻譯 API」選目標語言，「影片現有字幕翻譯」可設定獨立 API／模型與整份分批模式。
5. 按「**開始／繼續翻譯影片字幕**」。兩個介面都會將譯文顯示在原影片，跟隨原播放器的暫停／跳轉／倍速；影片禁止嵌入不影響此操作。

載入字幕不會呼叫翻譯 API。開始後自動處理整份字幕，預設最多每批40句／12,000字，讓模型參考相鄰上下文；長片分批避免超過上下文限制，可能產生 API 費用。請使用能回傳 JSON 的一般聊天模型；Riva 專用模型請選逐句模式。字幕獨立 API 的服務、網址、模型、金鑰可與直播不同，目標語言一致。每批驗證完整 ID 後才保存；批次失敗立即停止，不會偷偷改成大量逐句請求。可停止、繼續並略過成功譯文；更換目標語言須重新載入。更換模型若要重翻已完成字幕，也須重新載入。

此模式**不擷取音訊、不載入 GPU、不延遲影片**。字幕顯示直接跟隨播放器 currentTime，暫停、跳轉與倍速照原播放器操作。完整字幕／譯文保存在本機，SRT／ASS／TXT 匯出保留原有影片時間，Web 也不必手動填起點。完成翻譯後擴充功能維持字幕顯示，按「停止」關閉圖層。切換影片時重新讀取字幕。

可讀取的是 YouTube 人工或自動**字幕軌道**；直接燒在畫面內的文字需 OCR，這一版不支援。無字幕、需登入、受限影片或 YouTube 阻擋讀取時會明確報錯，不會偷偷切回 STT。兩個介面先從原播放器讀取，失敗時嘗試本機 [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)（非 YouTube 官方 API）。YouTube 介面可能改變，讀取非所有影片都保證成功。

更新既有環境時先安裝新增依賴，再重啟服務與 reload 擴充功能：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 更換模型

### 本機 STT 模型

「模型與設定 → 本機語音辨識」可選模型並查看下載狀態。未下載時，複製介面提供的指令，在專案資料夾執行：

```powershell
.\.venv\Scripts\python.exe download_model.py --model large-v3
# 其他選項：large-v3-turbo、medium、small
```

下載完成後按「重新檢查」，選模型、儲存、開始擷取。切換前先停止所有擷取；同一服務可以共享同一模型，不能同時使用兩個不同模型。模型只從登記的來源下載，無法填任意檔案路徑。

| 模型 | 選擇方向 |
| --- | --- |
| Large v3 Turbo | 預設；兼顧辨識與處理速度 |
| Large v3 | 完整模型；處理較慢、較多 GPU 記憶體需求 |
| Medium / Small | 較小模型；品質需用你的音訊比較 |

實際速度與準確度依 GPU、說話、背景音樂而變。可填來源語言的人名或節目詞彙提示；準確模式定稿使用 beam5 與 VAD，速度模式使用 beam1。

音檔測試：

```powershell
.\.venv\Scripts\python.exe transcribe_file.py "D:\audio\sample.wav" --model large-v3-turbo --language ja
# --language auto 自動偵測；也可使用 en、ko、zh-TW 等介面語言碼
```

### 直播與留言 API

直播與留言都支援 NVIDIA、OpenAI、自訂服務；**API 模型名稱**欄直接填服務提供的模型 ID。

| 服务 | 預設端點 | 預設模型 |
| --- | --- | --- |
| NVIDIA Build | `https://integrate.api.nvidia.com/v1/chat/completions` | `google/gemma-4-31b-it` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4.1-mini` |
| 自訂 | 完整 HTTPS `/chat/completions` 網址，或本機 HTTP | 自行填寫 |

服務提供的模型清單會變動；介面中的建議不是即時可用性保證。請以自己的金鑰按「測試翻譯」確認。

在「留言助手 API」選 **使用獨立 API**，就可以用不同服務、模型、網址、金鑰與輸出語言。讀取留言及回覆翻譯都使用這組設定，直播字幕不受影響；切回「沿用直播 API」不會刪除獨立設定。回覆習慣提示只適用一般聊天模型。

`nvidia/riva-translate-*` 專用翻譯模型使用其語言碼格式。非英文語言對經英文中轉，例如日文 → 英文 → 繁中，每句兩次請求，會增加延遲與費用；不套用回覆風格。參見 [NVIDIA 模型卡](https://build.nvidia.com/nvidia/riva-translate-4b-instruct-v2/modelcard)。

## 字幕與延遲

新設定預設32px，既有大小設定保留；可輸入12–96px、選雙語模式，並調整距底部、寬度與底色濃度。全螢幕字體隨畫面寬度放大。Web 觀看區有 A−／A＋，全螢幕可按 +／−。長句分成每頁兩行，完整文字保留於字幕紀錄。只顯示譯文時跳過暫定辨識，減少 GPU 用量。

Web 即時語音觀看：選擇 Chrome **分頁**並勾分享音訊，可使用0–12秒音畫延遲。延遲需要瀏覽器支援 `suppressLocalAudioPlayback`，且擷取回傳確認已抑制來源聲音；否則會提示選「不延遲」，不播放雙重聲音。畫格最高15fps／640px，超過6秒降低解析度並限制記憶體。影片原分頁仍是控制來源，暫停／跳轉／變速後請重新擷取；瀏覽器分享視窗每次都需授權。延遲字幕依擷取時間選句，API 太慢仍可能晚到，依耗時提示增加延遲。此功能使用 [瀏覽器的分頁音訊抑制設定](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/suppressLocalAudioPlayback)，現有字幕同步使用 [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)。

切句可選3／4／6秒，靜音約0.7秒後定稿。短片段較早開始翻譯，但可能切開詞句。觀看延遲不是處理速度保證：整句等待、STT 和 API 的時間總和超過所選延遲時，譯文仍會晚到。Riva 兩段翻譯可從10秒試起，依介面最近一句的耗時調整。

延遲模式使用最高約24fps、640px寬的 Canvas 畫格緩衝；超過6秒會降低解析度以限制記憶體。可能影響畫質，受保護影片、高負載、背景節流、廣告與換源仍可能失步。暫停／繼續由原播放器控制；跳轉後重新開始擷取。畫面保留最近50筆，重新整理後清空；整場轉錄仍保存在本機，可重新選取匯出。

## 語言與轉錄匯出

在「模型與設定」選擇**來源語言、字幕目標語言、回覆語言**。目前介面提供日文、英文、繁中、簡中、韓文、法文、德文、西班牙文、葡萄牙文、俄文、越南文；辨識來源也可選「自動偵測」。短句自動偵測可能不準確，主要看日文時建議明確選日文。獨立留言 API 可另選來源與回覆語言；Riva 留言翻譯需要明確來源語言，各模型支援的語言仍以服務提供者為準。

### 看完後匯出

1. 按「停止」，等待最後幾句翻譯收尾。
2. 在「即時字幕 → 轉錄與匯出」選擇這場轉錄；必要時按「重新整理紀錄」。
3. 選 **SRT／ASS／TXT** 與 **原文＋譯文／只有原文／只有譯文**，按「下載轉錄」。

整場文字與時間儲存在 `data/transcripts.sqlite3`，不受畫面50句限制。清除畫面、刷新介面或重啟服務不會刪除已保存資料；選單列出最近100場，較早資料仍保留在資料庫。資料從此版本啟動擷取後開始保存，無法補回舊版本已消失的字幕。翻譯失敗／中斷時，雙語檔保留原文，只有譯文模式略過該句；不把「翻譯中」或錯誤訊息寫進字幕。停止擷取最多等待90秒收尾，超時可保留原文。

### 對齊影片時間

- **YouTube 擴充功能**：擷取時自動讀取來源播放器的時間，定期校準暫停／播放速度差異。中途從12:30開始擷取，字幕匯出會從影片12:30附近開始，不會從00:00重新計時。觀看延遲不會額外加到匯出的字幕時間。
- **WebUI**：透過橋接讀取同一來源播放器的時間，自動校準匯出；不需手動輸入起點。觀看延遲期間跳轉、廣告或換影片後仍需重新擷取。
- **手動修正**：選好轉錄後填起點與速度，按「套用手動時間」；這會改用固定起點／速度，取代該場自動校準。最好在停止擷取後操作。

SRT 毫秒、ASS 百分之一秒；TXT 也保留每句起訖時間。時間是音訊切句與播放器校準的估計，並非逐字人工字幕。跳轉、廣告、換影片後請重新開始擷取；直播的時間基準可能隨播放器的滑動視窗變動，長場與廣告換源仍需實測。

## 儲存與隱私

- API Key 共用 Chrome 擴充功能的本機 storage；沒有加密，不是金鑰保管庫。僅本機 WebUI 能透過固定橋接讀取所需設定，橋接不是任意擴充功能指令代理。
- 音訊送到本機辨識服務；辨識文字與 API Key 由本機服務送到你指定的 API。第三方服務依自身政策處理文字。
- 設定、金鑰、模型、音訊與轉錄資料不會寫入 Git。後端只保存文字、語言與字幕時間，不保存原始音訊或 API Key；`data/` 已排除於 Git。轉錄資料不自動刪除，需要清除時先備份匯出並停止服務，再移除本機 `data/` 資料夾。
- 目前留言須手動貼入，回覆須自行複製到聊天室。沒有自動發送或個人風格訓練。

## 更新與排錯

更新程式後，在 `chrome://extensions` 按本專案擴充功能的「重新載入」，再重新整理 **WebUI 與 YouTube**；橋接新增後這一步必要。0.9.1 沿用 protocol10，不需因本次 UI 修改重啟已使用 protocol10 的服務。若介面／服务通訊版本不符，先按 Ctrl+Shift+R，依錯誤顯示的實際版本確認啟動資料夾，再重啟服務。

| 問題 | 處理 |
| --- | --- |
| 本機服務未啟動／版本舊 | 關閉原服務視窗，再執行 `start.bat`；按「重新檢查」 |
| 尚未連接字幕橋接 | 載入 repo 新版擴充功能並重新整理兩個分頁；使用同一 Chrome 設定檔及 127.0.0.1:8788 |
| 來源分頁不一致／確認過期 | 按「更新分頁」，重新選影片；分享視窗選同一分頁 |
| 未取得分頁音訊 | 選 Chrome 分頁並勾選分享音訊，先播放影片 |
| GPU 模型載入失敗 | 檢查 CUDA/cuDNN DLL、GPU 記憶體與本機服務視窗；先嘗試較小模型 |
| API 404 / 410 | 檢查完整網址、模型 ID 是否存在／已停用 |
| 字幕慢／譯文晚 | 看辨識與 API 耗時；試較短片段、較快模型或增加觀看延遲 |
| 模型尚未下載 | 執行介面提供的指令，完成後重新檢查 |

## 開發與授權

測試與建置參見 [CONTRIBUTING.md](CONTRIBUTING.md)，版本變更參見 [CHANGELOG.md](CHANGELOG.md)。CI 驗證 API 路由、模型租約、音訊協定、Web 擷取資源釋放與擴充功能圖層；mock 測試不代表實際辨識準確度或 YouTube 效能。

專案程式碼採 [MIT](LICENSE)。第三方依賴與下載的模型分別適用其原始授權，模型權重不包含在發行檔內。
