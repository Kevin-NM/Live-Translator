# 2026-09-27 WebUI 混版快取造成錯誤舊服務警告

## 問題與診斷

使用者數次重啟仍看到「本機服務仍是舊版」。已讀0.9.0接續報告，repo無.codegraph。唯讀檢查實際8788 listener PID46868，父程序8716由本專案`.venv/Scripts/python.exe run.py`啟動；API回報version0.9.0、protocol10，服務本身已正確。截圖頁面0.9.0，但caption-ui說明仍是0.8、版本警告也為舊panel.js文案，判斷為瀏覽器混用快取前端。未停止/重啟使用者服務、未修改設定或data；8765沒有listener。

## 修改與設計

- `build_ui.py`：共用Web資源與獨立platform/viewer/video-delay先正規化LF，產生每個CSS/JS內容SHA256前16碼query。index引用7個直接資源的`?v=...`，舊URL快取不會用於新內容。跨Windows/Linux輸出byte一致，check也檢查獨立Web腳本LF。既有audio-worklet由static no-store覆蓋，沒有加入未引用的HTML資源。
- `app/main.py`：HTML根路由、所有static、status回應加Cache-Control:no-store，含304和404。此middleware需要服務下一次啟動才載入；目前執行中的舊process已能以FileResponse讀到新index和queryURLs，所以立即解決前端混版不需強制停止現有服務。
- `chrome-extension/panel.js/background.js`：status fetch明確no-store；不符顯示expected10與actual protocol/version，Web先提示Ctrl+Shift+R，不再一概說「服務舊版」。extension提示其reload與來源資料夾。
- 重建`web/index.html/panel.js`。其餘Web產生檔與獨立腳本僅LF正規化，Git無語意diff。
- 不增加protocol/版本：本次修正0.9.0交付方式，不改通訊格式、不需額外依賴。

## 委派與驗證

AI Router auto/coding聚焦檢查快取策略與回歸測試，未送任何程序命令列、Key、設定或使用者字幕。採內容hash、實際bytes測試、deterministic build、版本診斷；未採靜態URLimmutable建議，因查詢URL並非獨立永久檔，本機小型app优先防混版。

Python50／client13／extension13，共76項通過；build_ui.py --check、git diff --check通過。新增實際HTTP回應7個資源SHA與內容一致、no-store在200/304/404/status；兩次build完全相同，改caption-ui內容後hash改變，舊產物check拒絕；前端不符提示包含實際version/protocol。初次測試把直接資源誤算8項，實際為6JS+1CSS，修成明確expected路徑集合而非放寬對未知資源的驗證。

實際執行中8788 GET `/?ui=cache-fix`確認有新版panel與caption-ui帶hash網址，status仍0.9/protocol10。沒有透過工具清除使用者browser資料；建議直接開 http://127.0.0.1:8788/?ui=cache-fix 或Ctrl+Shift+R。未做新的瀏覽器UI操作，沒有聲稱本次真實GPU/音訊/付費API驗收。

## 狀態、限制與後續

修正完成并建立Git commit，沿用本次會話已授權的GitHub更新工作推送origin/master。應維持`build_ui.py`於Web源變更後執行；不要手改生成index。使用者已開著的舊分頁仍須重新整理才換JS，下一次正常restart會啟用no-store。原0.9報告中的真實音畫漂移、YouTube字幕讀取、API品質限制仍未改。若硬刷新後真實protocol不符，現在文案會显示actual值，依實際服務啟動目錄診斷，不應再盲目重啟。
