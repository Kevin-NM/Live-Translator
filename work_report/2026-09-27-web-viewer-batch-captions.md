# 0.9.0 WebUI 觀看、彈性字幕與整份字幕分批翻譯

## 需求與目前狀態

使用者反映 WebUI 不能取代擴充功能、字幕太小、现有字幕逐句翻譯慢，希望可獨立選模型。已閱讀 0.7/0.8 work_report；無 .codegraph，未建立索引。實作完成，本機版本0.9.0、protocol10。此輪沒有要求發布，因此只建立本機 Git commit，未推送／建立release；README公开下載仍指0.8.0並明確区分工作目录新版。

## 修改與影響檔案

- `web/platform.js`：分頁擷取仍由使用者點擊觸發 getDisplayMedia，不需extension。Web觀看延遲0–12秒；有延遲時要求suppressLocalAudioPlayback並檢查audio track的actual setting，成功後才在ready接上WebAudio DelayNode，避免來源雙重聲音。零延遲沿用來源分頁音訊。ready前不送PCM，停止斷開nodes/context，EOS收尾。新增启动等待後的session检查与ready幂等。
- 新 `web/video-delay.js`：15fps captured-video Canvas畫格池，640x360像素上限，6秒以上降低尺寸，回收不再使用的frame，不重用queue中的frame；清理interval与池。畫面、字幕epoch皆用performance.now避免系統時間跳動。最高約90MB画格预算；背後節流與實際長場時鐘漂移尚未验证。
- 新 `web/viewer.js`：既有字幕用YouTube IFrame API播放器，getCurrentTime選原始cue，暫停／seek／倍速同步，无GPU/STT。API載入失败、嵌入禁止有明确提示。来源變更銷毁播放器，完整cue map不受50条紀錄限制。觀看區全螢幕保留字幕，native拒絕時CSS填满视窗；出口按钮与Escape，+/-调大小，ResizeObserver按畫面寬度缩放。
- `chrome-extension/panel.html/css/js`＋`caption-ui.js`（由build_ui.py重建web共享副本）：字号12–96px（新設定32，舊size保留）、底部0–45%、宽40–100%、底色0–100%；Web快速A−/A＋。独立captionApiMode/captionTranslation/captionTranslationMode設定：字幕API可独立provider/endpoint/model/key，target使用全局字幕语言；直播與留言不受影响，切回沿用不覆盖独立设置。API由開始按钮才调用。Web即时不延迟模式保留最近成功译文，后续pending不会立即清掉旧字幕。
- `chrome-extension/content.js/background.js`：字幕setting size不再限16/20/24，接上位置/底色/宽度及全画面缩放；既有字幕WS传选定独立配置、batch/single模式。Riva仅适用于explicit single，不自动降级。
- `app/translation.py/captions.py/transcripts.py`：整份待翻译字幕以max40cue/12000source chars组成批次（短字幕一次）。一般chat API接受完整JSON cue数据，不套旧translate的4000char截断；回传解析严格检查完整整数ID、无重复/陌生ID、非空文本，按ID映射不依response order。一次批次SQLite transaction写入，任意missing cue rollback全部；native写入cancel时drain再释放job lock。批次失败立即停止，不循环大量错误请求；resume略过完成cue。保留legacy single后端默认兼容，UI明确传batch默认。暂未做动态seek优先更新，只使用启动位置。
- `app/main.py`、extension manifest/version與测试：0.9.0/protocol10，旧服务需restart；`build_ui.py`仅在Web引入viewer/video-delay。
- `README.md/CHANGELOG.md`：Web主要路径、分批和独立模型、字体/观看操作、browser限制与版本状态。没有持久保存API Key到服务器或repo，Web和extension仍各存设置；用户只用Web不需重复填extension。

## 设计与外部委派

AI Router当前aggressive，用auto/coding委派批次取消/ID/atomicity风险和Web delay focused review，未发送Keys/真实用户字幕/环境变量。採纳整批原子保存、无silent逐句fallback、monotonic clock、ready幂等、bound memory；未採纳worker关于canvas引用复用推论：实际仅将已出queue画格送pool，queue引用不重用。lead修改和验证全部本机文件。

官方参考：YouTube https://developers.google.com/youtube/iframe_api_reference ，浏览器音訊抑制 https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/suppressLocalAudioPlayback 。此实验browser feature可能不支援，actual setting未true會拒绝delay而提示选0；不假装所有browser都支持。

## 验证

- Python unittest **48**、client Node **12**、extension Node **13**，共 **73** pass；build_ui.py --check、git diff --check pass。
- 新case：85句3批（已保存1句跳过）、重排ID与原时间、resume0重复request、failed batch无single fallback、atomic rollback、12k边界、缺失/额外/重复/string IDs/空输出、cancel native batch drain、Riva batch fail-fast、8000字符payload无截断；独立配置切换保留且global target、appearance、Web WS传独立API/batch、player clock jump至80号cue、fullscreen font缩放、source-change destroy、delay拒絕未抑制來源、12s ready仅接一次audio、100秒frame pool有界与清理。
- 真实Chrome隔离Web 8791：0.9.0 service、字幕48px设置保存、独立字幕fields、6句fixture载入/源文字工作完成、嵌入真实公开YouTube影片jNQXAC9IVRw、播放时fixture字幕变化、CSS全视窗及+/-调整48->32、退出恢复观看。截图 `.tmp/webui-viewer-proof.png`（不进Git）。真实native fullscreen在自动化浏览器被拒绝，CSS fallback已实测。
- 原实际字幕fetch在sandbox收到ProxyError，未宣称本轮真实网络字幕读取成功。UI验证服务器只在`.tmp/ui9-server.py`中mock tracks/fetch，返回明确标注「UI测试字幕」的synthetic文字；production未修改reader为mock。DB `.tmp/ui9.sqlite3`，与用户data隔离。未调用付费翻译API，未加载GPU，未操作用户extension或重启用户8788/8765。

## 已知限制、未完与下一步

- 真實分享分頁音訊的抑制、GPU/STT/API与音画click/flash同步、30–90分钟漂移、背景节流还未端到端验证。Mock通过只证明控制流与清理，不能证明真实音质/实际字幕正确率。默认新UI延迟2秒可能不足（用户截图API6.4秒），可先选10–12秒并依耗时调。
- Web擷取不能控制原分頁播放器，跳转/变速後应重启采集并手动填导出时间起点；显示缓冲不是改善API速度。先ready后建共同epoch，worklet消息存在小量通道延迟。
- YouTube字幕reader仍可能被IP/代理/需登入/接口改变挡住；嵌入禁止影片须改分頁擷取或导出。不是OCR。
- 一般chat模型必须能遵循JSON要求；context/output budget差異可能导致截断而整批拒绝，不自动猜测或漏句。长片分批不会把整片一次送超大context；跨批上下文暂未重叠。
- 更換模型后同record resume会保留旧成功译文，重翻整场需重新载入；DB未记模型身份。多进程job互斥仍未做，保持run.py单进程。
- Web與extension的設定儲存仍各自独立，未把credentials寫server。不自动搬运用户密钥。现在只用Web可完成观看，不必设置extension。
- 更新须关闭旧服务重新start.bat并刷新Web；仍用extension才需reload0.9.0與刷新YouTube。protocol10不兼容旧服务。

验证完成后已关闭本轮测试Chrome分頁與8791服務session24283/PID54964；第一次session70106/PID47568亦已结束。保留.tmp验证资产供后续使用，不影响用户data。推荐下一轮先做真实Chrome tab共享/抑制/10s delay同步验收，再以用户选定的独立聊天模型真实翻译一段日文人工字幕，检查质量、费率、批次output限制；不应先调整时间常数掩盖API吞吐。

## GitHub 更新完成（使用者後續要求）

使用者後續明確要求「pls update to github」。已將功能提交 `07f9930cad28d4118e2cc423de4292c762a4045a` 推送至 `origin/master`（https://github.com/Kevin-NM/Live-Translator）。GitHub CI run `36320362013` success：https://github.com/Kevin-NM/Live-Translator/actions/runs/36320362013 ，乾淨 Linux 安裝、Web 產生檔檢查、Python48／extension13／client12測試全部通過。

本次是更新 GitHub 原始碼；未建立0.9.0 tag／Release或ZIP下載資產，公開下載仍為0.8.0。此報告補充亦提交並推送，後續接續以repository與此報告為準。前述真實音訊長場同步、付費API品質和網路字幕讀取限制仍存在，不因CI通過而宣稱已驗證。
