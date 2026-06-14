import { useState, useEffect, createContext, useContext } from 'react'

const translations = {
  'zh-TW': {
    // Nav
    'nav.dashboard': '儀表板',
    'nav.providers': '翻譯供應商',
    'nav.sessions': '翻譯工作階段',
    'nav.settings': '設定',

    // Dashboard
    'dashboard.title': '儀表板',
    'dashboard.api_health': 'API 狀態',
    'dashboard.healthy': '正常',
    'dashboard.error': '錯誤',
    'dashboard.providers': '供應商',
    'dashboard.sessions': '工作階段',
    'dashboard.manage': '管理 →',
    'dashboard.view_all': '查看全部 →',
    'dashboard.recent_sessions': '最近的工作階段',
    'dashboard.no_sessions': '還沒有工作階段。',
    'dashboard.create_one': '建立一個 →',

    // Providers
    'providers.title': '翻譯供應商',
    'providers.add': '+ 新增供應商',
    'providers.new': '新增供應商',
    'providers.edit': '編輯供應商',
    'providers.enabled': '啟用',
    'providers.disabled': '停用',
    'providers.priority': '優先順序',
    'providers.timeout': '逾時',
    'providers.retries': '重試次數',
    'providers.temp': '溫度',
    'providers.tokens': 'Token 上限',
    'providers.edit_btn': '編輯',
    'providers.test': '測試',
    'providers.self_test': 'Self-Test',
    'providers.delete': '刪除',
    'providers.testing': '測試中...',
    'providers.self_testing': '測試中...',
    'providers.no_providers': '尚未設定供應商。點擊「新增供應商」開始。',
    'providers.delete_confirm': '確定要刪除此供應商？',
    'providers.source': '來源',
    'providers.output': '輸出',
    'providers.http': 'HTTP',
    'providers.raw_response': '原始回應預覽',

    // Provider Form
    'form.provider_name': '供應商名稱 *',
    'form.base_url': 'Base URL *',
    'form.api_key': 'API Key *',
    'form.model': '模型 *',
    'form.enabled': '啟用',
    'form.priority': '優先順序',
    'form.timeout_ms': '逾時 (ms)',
    'form.max_retries': '最大重試次數',
    'form.temperature': '溫度',
    'form.max_tokens': '最大 Token',
    'form.save': '儲存',
    'form.cancel': '取消',
    'form.show': '顯示',
    'form.hide': '隱藏',
    'form.custom_model': '自訂模型...',

    // Sessions
    'sessions.title': '翻譯工作階段',
    'sessions.new': '+ 新工作階段',
    'sessions.create': '建立工作階段',
    'sessions.title_label': '標題 *',
    'sessions.title_placeholder': '工作階段標題',
    'sessions.source_lang': '來源語言',
    'sessions.auto_detect': '自動偵測',
    'sessions.provider': '供應商',
    'sessions.auto_priority': '自動（最高優先）',
    'sessions.create_btn': '建立',
    'sessions.cancel': '取消',
    'sessions.no_sessions': '還沒有工作階段。',
    'sessions.manual': '手動翻譯',
    'sessions.chrome_live': 'Chrome 即時',

    // Session Detail
    'session.back': '← 返回工作階段',
    'session.stop': '停止工作階段',
    'session.export_json': '匯出 JSON',
    'session.export_csv': '匯出 CSV',
    'session.active': '進行中',
    'session.stopped': '已停止',

    // Translate Panel
    'translate.title': '翻譯',
    'translate.source_lang': '來源語言',
    'translate.mode': '模式',
    'translate.realtime': '即時',
    'translate.quality': '品質',
    'translate.btn': '翻譯 (Ctrl+Enter)',
    'translate.translating': '翻譯中...',
    'translate.source_text': '原文',
    'translate.placeholder': '輸入英文或日文進行翻譯...',
    'translate.enter_text': '請輸入要翻譯的文字',

    // Live Panel
    'live.title': 'Chrome 即時模式',
    'live.ws': 'WS',
    'live.ext': '擴充',
    'live.connected': '已連線',
    'live.disconnected': '未連線',
    'live.clear': '清除',
    'live.backend_status': '後端音訊狀態',
    'live.audio_ws': '音訊 WS',
    'live.format': '格式',
    'live.sample_rate': '取樣率',
    'live.channels': '聲道',
    'live.chunks_received': '已接收區塊',
    'live.last_chunk_size': '最後區塊大小',
    'live.pcm_buffered': 'PCM 緩衝',
    'live.last_chunk_at': '最後區塊時間',
    'live.decode_status': '解碼狀態',
    'live.last_error': '最後錯誤',
    'live.instructions': '使用說明：',
    'live.instructions_text': '開啟 Chrome 擴充功能彈窗，選擇此工作階段，選擇 Chrome 分頁，然後點擊「開始擷取」。即時字幕將顯示在下方。或使用下方注入框測試管線。',
    'live.inject_title': '注入文字（管線測試）',
    'live.inject_placeholder': '輸入文字注入即時管線...',
    'live.inject_btn': '注入',
    'live.waiting_ext': '等待 Chrome 擴充功能連線...',
    'live.waiting_asr': '擴充功能已連線。等待 ASR 結果...',
    'live.translating': '翻譯中……',

    // Segment List
    'segments.title': '翻譯歷史',
    'segments.count': '翻譯歷史 ({count})',
    'segments.no_segments': '還沒有翻譯紀錄。',
    'segments.source': '原文',
    'segments.translation': '翻譯',
    'segments.translated': '已完成',
    'segments.error': '錯誤',
    'segments.asr': 'ASR',
    'segments.api': 'API',

    // Settings
    'settings.title': '設定',
    'settings.asr_config': 'ASR 設定',
    'settings.asr_desc': '設定 Chrome 即時模式使用的語音辨識引擎。',
    'settings.asr_model': 'ASR 模型',
    'settings.device': '裝置',
    'settings.compute_type': '運算類型',
    'settings.chunk_seconds': '區塊秒數',
    'settings.default_lang': '預設來源語言',
    'settings.save': '儲存設定',
    'settings.saving': '儲存中...',
    'settings.saved': '設定已儲存',
    'settings.save_failed': '儲存失敗',
    'settings.auto_gpu': '自動（有 GPU 則使用）',
    'settings.cuda': 'CUDA（強制 GPU）',
    'settings.cpu_only': '僅 CPU',
    'settings.recommended': '建議用於 RTX 4060',
    'settings.cpu_fallback': 'CPU 回退',
    'settings.low_latency': '低延遲',
    'settings.balanced': '平衡',
    'settings.better_accuracy': '較佳準確度',
    'settings.requirements': '系統需求',
    'settings.req_ffmpeg': '• ffmpeg 必須安裝並在 PATH 中（音訊解碼用）',
    'settings.req_model': '• faster-whisper 模型首次使用時會自動下載',
    'settings.req_cuda': '• CUDA 11.8+ 才能使用 GPU 加速',
    'settings.req_rtx': '• RTX 4060 Laptop 建議：int8_float16 + small 或 medium 模型',

    // Errors
    'error.provider_not_found': '找不到供應商',
    'error.provider_disabled': '供應商已停用',
    'error.session_not_found': '找不到工作階段',
    'error.session_stopped': '工作階段已停止',
    'error.no_providers': '尚未設定供應商',
    'error.no_enabled': '沒有啟用的供應商',
    'error.source_empty': '來源文字不能為空',
    'error.translation_failed': '翻譯失敗',
    'error.export_failed': '匯出失敗',
    'error.create_failed': '建立失敗',
  },

  'en-US': {
    // Nav
    'nav.dashboard': 'Dashboard',
    'nav.providers': 'Providers',
    'nav.sessions': 'Sessions',
    'nav.settings': 'Settings',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.api_health': 'API Health',
    'dashboard.healthy': 'Healthy',
    'dashboard.error': 'Error',
    'dashboard.providers': 'Providers',
    'dashboard.sessions': 'Sessions',
    'dashboard.manage': 'Manage →',
    'dashboard.view_all': 'View all →',
    'dashboard.recent_sessions': 'Recent Sessions',
    'dashboard.no_sessions': 'No sessions yet.',
    'dashboard.create_one': 'Create one →',

    // Providers
    'providers.title': 'Translation Providers',
    'providers.add': '+ Add Provider',
    'providers.new': 'New Provider',
    'providers.edit': 'Edit Provider',
    'providers.enabled': 'enabled',
    'providers.disabled': 'disabled',
    'providers.priority': 'priority',
    'providers.timeout': 'timeout',
    'providers.retries': 'retries',
    'providers.temp': 'temp',
    'providers.tokens': 'tokens',
    'providers.edit_btn': 'Edit',
    'providers.test': 'Test',
    'providers.self_test': 'Self-Test',
    'providers.delete': 'Delete',
    'providers.testing': 'Testing...',
    'providers.self_testing': 'Self-Testing...',
    'providers.no_providers': 'No providers configured. Click "Add Provider" to get started.',
    'providers.delete_confirm': 'Delete this provider?',
    'providers.source': 'Source',
    'providers.output': 'Output',
    'providers.http': 'HTTP',
    'providers.raw_response': 'Raw response preview',

    // Provider Form
    'form.provider_name': 'Provider Name *',
    'form.base_url': 'Base URL *',
    'form.api_key': 'API Key *',
    'form.model': 'Model *',
    'form.enabled': 'Enabled',
    'form.priority': 'Priority',
    'form.timeout_ms': 'Timeout (ms)',
    'form.max_retries': 'Max Retries',
    'form.temperature': 'Temperature',
    'form.max_tokens': 'Max Tokens',
    'form.save': 'Save',
    'form.cancel': 'Cancel',
    'form.show': 'Show',
    'form.hide': 'Hide',
    'form.custom_model': 'Custom model...',

    // Sessions
    'sessions.title': 'Translation Sessions',
    'sessions.new': '+ New Session',
    'sessions.create': 'Create Session',
    'sessions.title_label': 'Title *',
    'sessions.title_placeholder': 'Session title',
    'sessions.source_lang': 'Source Language',
    'sessions.auto_detect': 'Auto Detect',
    'sessions.provider': 'Provider',
    'sessions.auto_priority': 'Auto (highest priority)',
    'sessions.create_btn': 'Create',
    'sessions.cancel': 'Cancel',
    'sessions.no_sessions': 'No sessions yet.',
    'sessions.manual': 'Manual Translate',
    'sessions.chrome_live': 'Chrome Live',

    // Session Detail
    'session.back': '← Back to Sessions',
    'session.stop': 'Stop Session',
    'session.export_json': 'Export JSON',
    'session.export_csv': 'Export CSV',
    'session.active': 'active',
    'session.stopped': 'stopped',

    // Translate Panel
    'translate.title': 'Translate',
    'translate.source_lang': 'Source Language',
    'translate.mode': 'Mode',
    'translate.realtime': 'Realtime',
    'translate.quality': 'Quality',
    'translate.btn': 'Translate (Ctrl+Enter)',
    'translate.translating': 'Translating...',
    'translate.source_text': 'Source Text',
    'translate.placeholder': 'Enter English or Japanese text to translate...',
    'translate.enter_text': 'Please enter text to translate',

    // Live Panel
    'live.title': 'Chrome Live Mode',
    'live.ws': 'WS',
    'live.ext': 'Ext',
    'live.connected': 'connected',
    'live.disconnected': 'disconnected',
    'live.clear': 'Clear',
    'live.backend_status': 'Backend Audio Status',
    'live.audio_ws': 'Audio WS',
    'live.format': 'Format',
    'live.sample_rate': 'Sample Rate',
    'live.channels': 'Channels',
    'live.chunks_received': 'Chunks Received',
    'live.last_chunk_size': 'Last Chunk Size',
    'live.pcm_buffered': 'PCM Buffered',
    'live.last_chunk_at': 'Last Chunk At',
    'live.decode_status': 'Decode Status',
    'live.last_error': 'Last Error',
    'live.instructions': 'Instructions:',
    'live.instructions_text': 'Open the Chrome Extension popup, select this session, choose the Chrome tab, and click "Start Capture". Live subtitles will appear below. Or use the inject box to test the pipeline.',
    'live.inject_title': 'Inject Text (Pipeline Test)',
    'live.inject_placeholder': 'Type text to inject into live pipeline...',
    'live.inject_btn': 'Inject',
    'live.waiting_ext': 'Waiting for Chrome Extension to connect...',
    'live.waiting_asr': 'Extension connected. Waiting for ASR results...',
    'live.translating': 'Translating...',

    // Segment List
    'segments.title': 'Translation History',
    'segments.count': 'Translation History ({count})',
    'segments.no_segments': 'No translations yet.',
    'segments.source': 'Source',
    'segments.translation': 'Translation',
    'segments.translated': 'translated',
    'segments.error': 'error',
    'segments.asr': 'ASR',
    'segments.api': 'API',

    // Settings
    'settings.title': 'Settings',
    'settings.asr_config': 'ASR Configuration',
    'settings.asr_desc': 'Configure the speech recognition engine used for Chrome Live Mode.',
    'settings.asr_model': 'ASR Model',
    'settings.device': 'Device',
    'settings.compute_type': 'Compute Type',
    'settings.chunk_seconds': 'Chunk Seconds',
    'settings.default_lang': 'Default Source Language',
    'settings.save': 'Save Settings',
    'settings.saving': 'Saving...',
    'settings.saved': 'Settings saved',
    'settings.save_failed': 'Failed to save',
    'settings.auto_gpu': 'Auto (GPU if available)',
    'settings.cuda': 'CUDA (force GPU)',
    'settings.cpu_only': 'CPU only',
    'settings.recommended': 'recommended for RTX 4060',
    'settings.cpu_fallback': 'CPU fallback',
    'settings.low_latency': 'low latency',
    'settings.balanced': 'balanced',
    'settings.better_accuracy': 'better accuracy',
    'settings.requirements': 'System Requirements',
    'settings.req_ffmpeg': '• ffmpeg must be installed and in PATH (for audio decoding)',
    'settings.req_model': '• faster-whisper model will be downloaded on first use',
    'settings.req_cuda': '• CUDA 11.8+ required for GPU acceleration',
    'settings.req_rtx': '• RTX 4060 Laptop recommended: int8_float16 + small or medium model',

    // Errors
    'error.provider_not_found': 'Provider not found',
    'error.provider_disabled': 'Provider is disabled',
    'error.session_not_found': 'Session not found',
    'error.session_stopped': 'Session is stopped',
    'error.no_providers': 'No providers configured',
    'error.no_enabled': 'No enabled providers',
    'error.source_empty': 'Source text cannot be empty',
    'error.translation_failed': 'Translation failed',
    'error.export_failed': 'Export failed',
    'error.create_failed': 'Failed to create',
  },
}

const I18nContext = createContext()

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('live-translator-lang') || 'zh-TW'
    } catch { return 'zh-TW' }
  })

  useEffect(() => {
    try { localStorage.setItem('live-translator-lang', lang) } catch {}
  }, [lang])

  const t = (key, params) => {
    let text = translations[lang]?.[key] || translations['zh-TW']?.[key] || key
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v)
      })
    }
    return text
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
