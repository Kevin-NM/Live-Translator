# 2026-09-27 WebUI 改為控制原 YouTube 分頁（0.9.1）

## 需求與接續

使用者指出 0.9.0 內嵌 YouTube 是誤解：影片應仍在原 YouTube，WebUI／extension 任選操作同一字幕功能。本次先讀前次 batch-caption 與 cache-mismatch 報告；無 .codegraph，未新增索引。延續已授權 GitHub 更新。沒有修改使用者設定、字幕資料、停止現有服務，也沒有呼叫付費翻譯。

## 修改

- 移除 shared panel 的 Web 觀看區、iframe／preview 相關 UI、狀態與 CSS，刪除 web/viewer.js、web/video-delay.js。保留擴充功能原影片 canvas 延遲與字幕層。build_ui.py 仍使用 deterministic LF／SHA query，現在 HTML 直接引用5個資源。
- 新增 chrome-extension/web-bridge.js、web-control.js，manifest 新增本機頁 content script。只接 http://127.0.0.1:8788/ 頂層頁；content script 檢查 window source、origin、channel，worker 再驗 sender。固定 RPC allowlist 與設定 keys，不是任意 runtime proxy。args 不能覆蓋 routing type／target。使用 Chrome runtime Port，每20秒訊息維持 worker 活動；斷線清理 Web 所擁有的音訊工作。
- web/platform.js 改為 Web 控制器：列出 YouTube watch 分頁、選擇／更新、共用 chrome.storage.local、橋接現有字幕讀取／開始／停止／設定。Web 舊 localStorage 不覆寫擴充設定，資料保留但本版不自動遷移。
- Web 音訊保留 getDisplayMedia，需要使用者分享選定影片與分頁音訊；Chrome tabCapture 不能假設一般網頁的點擊具有 extension action 授權。worker 在原影片 MAIN world 設 Capture Handle，隨機一次性 token 綁 Web owner／目標 tab／URL、120秒有效，Web 比對捕捉 stream handle／origin，再啟動 worker session。無音訊、錯來源、過期、影片換頁均拒絕；不產生 preview／iframe。
- Web PCM 只在 backend ready 後送出，播放 clock／timeline 由原 YouTube 圖層取得；0延遲保留原聲，>0要求 suppressLocalAudioPlayback 實際為true，原影片canvas確認後才延遲回放音訊。原分頁 pause／play 控制 Web AudioContext，clock／timeline 沿用原 extension 協定。
- background.js 共享 events 給兩種 UI，Web-owned control 只送其 owner，任一 UI 可 stop。停止保留 stopping session 等 EOS／stopped。重複音訊 start 拒絕而非替換尚未收尾工作；final／translation／stopped 保持同一事件 queue。Web UI 斷線只結束其音訊 session；字幕與 extension-owned 音訊不隨 Web 關閉而停止。
- 獨立字幕 API 在 worker 合併共同語言設定，保留獨立 provider／model／endpoint／key。共同 UI 隨來源工作更新 source 與 busy 狀態。清除畫面仍不刪錄音轉錄。
- UI、manifest、backend version 0.9.1，protocol仍10。README／CHANGELOG／CONTRIBUTING 更新為原分頁操作；公開zip仍0.8.0，沒有發行release。

## 委派與設計判斷

AI Router auto/coding 複核最小相關 bridge／Web transport source；未送API key、設定、字幕或認證。採用來源 token、owner驗證、重複啟動保護、事件收尾queue、Port接管順序。查詢／字幕讀取／stop／abandon不阻塞在mutations queue後；字幕HTTP fetch有timeout。保留跨UI共用session狀態：worker建議分owner隱藏state不符合使用者任選介面控制需求；state不含APIkey。stop原本已等stopped，不採立即ACK作完成指標。Channel只防誤路由，同origin被XSS接管仍可操作本機UI，不能稱為隔離頁面內惡意script的秘密。

參考 Chrome tabCapture 與 Capture Handle 官方文件，沒有加入 desktopCapture 權限或繞過 user gesture。

## 驗證

Python50、extension13、client6、web-bridge10，共79項通過。移除7項已不存在的內嵌／Web preview舊測試，新增10項實際新架構測試：兩個controller共用設定與state；來源handle一次性／owner／expiry；wrongtab／無音訊／抑制失敗拒絕；PCM ready gating；original timeline；pause；任一UI stop／EOS；斷線；session隔離；重複start；final-before-stopped順序；content bridge origin/source/channel；Web caption獨立model與共享target_language且不擷取音訊。原 extension／backend字幕、batch、cache、canvas回歸保留。

build_ui.py --check、git diff --check通過。Chrome新建檢查分頁實際讀取8788最新版sharedUI：無播放器、原分頁選擇與bridge提示可見，服務protocol10正常連線。已安裝extension尚未reload，故實際顯示尚未連接橋接；未宣稱端到端音訊／GPU／原分頁delay／付費API驗收。沒有透過browser工具操作extension管理，也未清除使用者資料。

## 狀態、已知限制與後續

已完成程式、測試、文件及commit；GitHub推送結果見本次提交／最終訊息，若網路認證失敗需保留本地commit再push，不重做修改。repo為唯一交付來源，沒有v0.9.1公開zip。

使用者須在 chrome://extensions reload 本repo chrome-extension，刷新WebUI及YouTube，使用同一Chrome設定檔與127.0.0.1:8788。WebUI需要extension背景橋接，不能在無任何跨分頁權限的普通網頁直接注入字幕。Web-owned 音訊需要保持WebUI開啟；來源確認兩分鐘有效，失敗按更新分頁。既有localStorage設定需手動參考重填共享設定，本版不自動遷移。兩個介面同時編輯尚未儲存的API欄位不即時同步，儲存後從共用storage讀取；避免兩份未儲存表單互相覆蓋。

推薦下一步：使用者reload後驗證Chrome實際Capture Handle／抑制回音／音畫漂移／originalfullscreen／YouTube字幕讀取／長影片batch品質；再考慮明確的legacy設定遷移與開啟中表單變更通知。真實受限YouTube、廣告與seek仍可能需重新開始。本次未改0.9報告中字幕讀取可用性及API品質限制。
