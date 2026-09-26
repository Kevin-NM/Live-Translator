# 0.8.0 一般影片的現有字幕翻譯

## 需求與狀態

使用者希望一般影片已有字幕但没有想看的語言時，能取得既有字幕再翻譯，且提供明確可選介面。沿用公開 GitHub／MIT 與推送要求。先閱讀 0.7.0 work_report；沒有 .codegraph。已完成程式與本地實測，版本 0.8.0、protocol 9；發布結果完成後追加。

## 修改元件

- `caption-ui.js`＋`panel.html/js`：即時字幕頁顯著的「字幕來源」選擇 audio／captions。現有字幕分成讀取列表、選人工／自動轨道、載入、確認句數／字數、按開始／繼續翻譯。載入不呼叫 API；目標語言與 API 延用直播設定，獨立留言不受影響。保留最近 caption ID，重新開啟可繼續，已翻譯句子略過。變更影片／目標語言須重新載入。描述與時間提示隨模式更新，避免現有字幕還要求分享聲音。
- `app/captions.py`：字幕專用 tracks／fetch／import API、`/ws/captions`，完全無 STT/model/audio 相依。URL 只接受 YouTube／youtu.be 與 11 字元 ID；來源語言正規化 en-US／zh-Hant 等；cue 數／時間／文字有界。公開字幕由 youtube-transcript-api 1.2.4 讀取，requests timeout15秒，不取 browser cookies。上游錯誤不暴露 signed URL。
- 同檔 WS：同一程序的相同紀錄工作互斥；先翻目前播放點後的句子，再補先前部分，逐句翻譯；重開略過 translated。連續三句 API 失敗中止，所有原文仍在。ping/pong、停止、斷線與取消收尾。提交 SQLite native write 以 shield 收集，取消時等待已提交 write 完成再讓工作鎖釋放，避免 resume 重複計費。provider none 明確報 source_only，未呼叫 API。
- `transcripts.py`：新增 caption_sources 表（不改舊表），整場原文＋video ID／track key 一次 transaction 載入；source 模式即可匯出。get 提供 caption_source，所有字幕仍用原始起訖时间，full store 与 50-row UI 分離。沒有記錄 Key、cookie、signed URL 或音訊。
- `background.js`：字幕模式不呼叫 tabCapture／offscreen/audio。直接 WS、20秒 heartbeat 維持 Chrome116+ worker，完成後 watching 狀態保留圖層，stop 關閉。檢查目前影片對應字幕、切片停止、恢復時傳入 currentTime。MAIN world 用目前 player response 列出轨道、精確 key 選取 json3 timedtext；只回文字／時間／metadata，校驗 timedtext host/path、有界、fetch15秒。失敗可同人工／自動及語言本機 fallback，若同種語言有多條而無法確認不冒然換軌。
- `content.js`：現有字幕讀全場 cue map，不限50句；直接 video.currentTime 選起訖內的字幕。暫停、倍速、跳轉不走 PCM wallclock 或延遲画格；完成翻譯後持續 watching。source none 顯示原文，其餘遵循譯文／雙語、尺寸、長句分頁設定。
- `caption-transport.js`：Chrome/Web 共用無音訊 socket。`web/platform.js` 加專用啟動／停止，Web 只翻譯與匯出，不注入來源影片。`build_ui.py` 新增兩個 generated JS，必須修改 source 再 build。
- 新 requirements：youtube-transcript-api==1.2.4（含 defusedxml），已安裝實際 .venv 及乾淨測試環境。README／CHANGELOG／CONTRIBUTING 說明使用、費用、更新依賴、原始時間與讀取限制。

## 設計與委派

AI Router aggressive，委派精簡字幕架構／驗收風險與 WS 聚焦審查，僅 source snippets，无 Key／cookies／私有轉錄。採納有界輸入、明確人工／自動選軌、media currentTime、resume 去重、native write draining。未採 worker 的「共享 connection」推論，實際 Store 每次開獨立 SQLite connection；identity／claimed 也已初始化。多程序 claim 未實作，應維持目前 run.py 單程序本機服務；同一 DB 不支援多程序同時作業／startup recover。

依官方原始專案確認 library.list／Transcript.fetch／is_generated API與 YouTube IP 限制： https://github.com/jdepoix/youtube-transcript-api 。PyPI 實際版本1.2.4已確認。Chrome worker heartbeat依官方 https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets 。這是非 YouTube 官方讀取路徑，可能隨網站變更；不可宣稱所有影片都成功。

## 驗證與清理

- 乾淨 Windows測試環境 Python **41項**、extension Node **13項**、client Node **7項**，共 **61項**通過；build --check、diff --check 通過。
- 新測試：URL／語言正規化與拒絕外站、manual／auto 同語言精確選軌、原始毫秒时间、60句整場、輸入時間驗證、播放點優先、resume 無重複翻譯、zero GPU、3錯誤停止、stop／duplicate work／ping、取消native write、source-only無API、跨origin拒絕。Node驗證來源明選、讀取／載入不翻譯、不啟動音訊、no offscreen／tabCapture、80句跳轉／暫停字幕仍可重看。
- 真實網路測試公開影片 jNQXAC9IVRw：成功列出 English／German 人工字幕；英文正文6句，首起點1200ms、末终點18881ms。未複製完整原文至報告、未呼叫付費翻譯API。
- 真實 Chrome Web：本機0.8.0、字幕來源caption、URL、2條字幕軌道、載入6句212字、開始／繼續按鈕enabled、可匯出、顯示「影片原有字幕時間」。使用 `.tmp/ui8-transcripts.sqlite3` 獨立測試DB，沒有讀寫使用者 data；程式不載 GPU，不使用 Chrome分享提示。測試腳本初次模組別名錯誤修正後reload成功，非 production 問題。
- 已關閉測試分頁與8790服務，最終PID21752／15608（初次腳本56752／18736亦已停止）；沒有停止或重啟使用者8788／8765。擴充功能需使用者手動reload，工具先前禁止extensions管理頁，不得繞過。

## 已知限制／後續

不支援燒入畫面的文字 OCR、其他影片平台、需要登入／受保護字幕；YouTube 可能限制IP／改接口，錯誤明確提示而不偷偷回STT。本機 fallback 不讀cookies。來源可翻譯語言仍是介面11種，其他轨道可列出但載入會明確拒絕。字幕先逐句API，未做批次翻譯，長片可能慢且費用高；UI顯示句数與說明，不自動開API。模型／目標相同的resume略過已完成譯文；更換模型而沿用同ID不會重翻已成功句，需重新載入才能整場重翻。

實際扩充功能新 MAIN 字幕取得、長片/自动字幕滾動語意、付費翻譯完整端到端尚未實測；backend公開字幕讀取與Web載入已實測，mock 不代表上述場景品質。影片中間跳到尚未翻到的位置仍可能沒有譯文，播放點優先目前只取啟動位置，工作中不重新排程。停止後先等舊工作清理再繼續，若收到「正在翻譯」稍後重試。多程序SQLite claim、批次API、動態seek優先是後續改善，非本次必備。

更新步驟：安裝requirements、restart start.bat、reload 0.8.0、刷新YouTube；已有settings／models／0.7 DB保留。下一輪以有日文人工字幕影片实測extension read/fallback與自動字幕，再評估batch而不丟原始字幕時間。
