# 0.7.0 多語言、Web 字幕預覽與影片時間轉錄

## 需求與目前狀態

使用者要求不限日文（仍主要使用日文）、Web 補上第 04 區字幕設定、整場可匯出 SRT／ASS／TXT，明確要求匯出對齊影片時間並推送公開 GitHub。已完成程式與本地驗證；發布目的地為 Kevin-NM/Live-Translator，master，MIT。先閱讀既有 work_report；沒有 .codegraph。

## 變更與受影響元件

- `app/languages.py`、`translation.py`、`stt.py`：來源／目標／回覆共 11 種選項，日文為舊設定預設，辨識另支援 auto。Whisper 的 zh 對應中文，自動辨識定稿取得實際語言給 Live API；留言 Riva auto 要求明確來源。Riva 英文中轉保留，各模型實際語言能力未全面實測。
- `app/transcripts.py`：SQLite 完整會話與 cues／anchors；只保存文字、語言與時間，無原始音訊、Key 或 API 設定。逐句原文先寫入，API 回來獨立更新，超過 50 句仍保留。重啟將 pending 標記 interrupted，保留原文。匯出原文／譯文／雙語；未完成或失敗譯文不寫錯誤訊息；UTF-8 BOM、ASS escape 防止字幕文字成為格式指令，二分搜尋時間錨點。
- `app/main.py`：本機轉錄 list/get/manual timeline/export API；WS ready 回傳 transcript_id，接收 media timeline，定稿與翻譯保存。成功譯文的 browser delivery 失敗不得改寫為翻譯錯誤。取消的模型釋放／DB 收尾用 AnyIO shield，native 工作仍 off-loop。版本 0.7.0、protocol 8。
- `offscreen.js`／`background.js`／`content.js`：每秒 PCM 時間錨點對照來源 YouTube currentTime；補償訊息傳遞 age、暫停 rate=0、倍速 rate。訊息依 capture id 限定，沒有將觀看延遲再加到影片時間。ready 儲存最後轉錄 ID。
- 共用 `panel.html/css/js`：直播來源、留言来源與回覆語言、整場紀錄選擇、SRT／ASS／TXT、三種內容、影片起點／速度修正、下載。Web 第 04 區可見，靜音 captured-video preview 套用字幕大小與模式；Web 观看延遲仍 disabled 並說明擴充功能專用。
- `web/platform.js`：捕捉預覽 stream、傳遞手動 origin/rate、ready 保存 ID。Web 來源播放器時間無法從 getDisplayMedia 取得，需使用者在開始前填起點；暫停／跳轉／變速後重新開始。Web 與 offscreen 停止收尾最多 90 秒，原本 30 秒可能截斷慢速 API。
- `transcribe_file.py`：多語言 CLI；`build_ui.py` 重建 web 產生檔。`.gitignore` 排除 data；README／CHANGELOG／CONTRIBUTING 更新操作、時間與保存隱私說明。

## 設計與委派

AI Router aggressive：提供聚焦、無敏感資料的匯出／語言方案審查，採納獨立全場儲存與原始來源時鐘；測試清理競態委派診斷，採納 AnyIO level cancellation 下 finally 使用 shield。官方說明 https://anyio.readthedocs.io/en/stable/cancellation.html 。Lead 修改、執行、整合及驗證，未外送 Key、cookies 或真實字幕。

轉錄是切句時間，非逐字人工標註。YouTube 來源時鐘作匯出基準，畫面與音訊延遲只影響觀看。手動時間明確覆寫自動模式，操作建議停止後進行。紀錄選單最近 100 場，但較早資料不刪除；暫无內建刪除／保留期限 UI，README 說明本機資料位置及備份清除。

## 驗證

- 乾淨 `.tmp/release-venv`：Python unittest **32 項**、extension Node **11 項**、client Node **5 項**，共 **48 項**通過；Web build --check、git diff --check 通過。
- 覆蓋：60 cues 超過 UI limit、重開 DB、晚到翻譯、原文 fallback、三格式／三內容、BOM／附件、ASS tags／Unicode、毫秒與小時 rollover、影片 origin／pause／speed anchors、API timeline 驗證、會話隔離、auto 偵測英文 API prompt、瀏覽器無法接收時譯文仍保存、取消時租約釋放。fixture 用 TemporaryDirectory，不能寫進使用者資料庫。
- 獨立 `pysubs2 1.8.0`（僅測試環境，不加 production 依賴）解析生成 SRT／ASS，確認 750500–752500ms 與中文完整。未放寬既有失敗斷言；AnyIO 清理競態修在 production。
- Chrome 正常 Web 頁 http://127.0.0.1:8790：0.7.0 連線、語言選擇共 12 項含 auto，英文保存後 reload 保留；第 04 區可見；mock 轉錄選取、手動時間 00:01:23.450 保存且下載可用。沒有呼叫付費 API、沒有操作 extensions 管理頁或繞過先前工具禁止。
- 本輪沒有真實音訊／GPU 端到端測試，也未重新載入使用者擴充功能；不能把 mock 或 parser 測試宣稱實際辨識品質／長場同步已全面驗證。
- 已關閉自己啟動的 8790 服務（PIDs 25280／47944）與測試 Chrome 分頁；未改使用者 8788／8765 服務。只刪除本輪指定 UUID 的 Hello world／你好世界 UI fixture；其餘資料不動。獨立 data/ui-test.sqlite3 parser fixture 排除 Git。

## 已知問題、未完成項目與下一步

現有逐次 final inference 路徑未重作，慢 GPU 仍可能排隊；RMS/VAD 與硬切可能影響多人／音樂／上下文。觀看緩衝仍 24fps／最高約 640px，高延遲降低畫格解析度。直播滑動時窗、廣告換源、seek、背景節流仍可能影響校準；換源／跳轉須停止重新擷取。auto 11 種辨識與各 API 全語言對尚無真實品質矩陣。Web origin 需手動且固定速度，無跨分頁時鐘權限。

更新需 restart start.bat、reload 0.7.0 擴充功能並刷新 YouTube。建議以固定影片從非零起點測試匯出／播放器回放（暫停、倍速各一次），再驗證長場記憶體與 SQLite 保存，勿先修改同步常數掩蓋 GPU 吞吐問題。其他產品缺口：自動聊天室接入／個人風格學習、轉錄管理／刪除 UI、模型背景下載。

GitHub 推送、CI 與 release 實際結果於發布後追加。
