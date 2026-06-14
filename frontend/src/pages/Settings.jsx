import { useEffect, useState } from 'react'
import { getSettings, updateSettings, preloadAsr } from '../api'
import { useI18n } from '../i18n'

export default function Settings() {
  const { t } = useI18n()
  const [settings, setSettings] = useState({
    asr_model: 'small', device: 'auto', compute_type: 'int8_float16',
    chunk_seconds: 3, source_language: 'ja',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [preloadResult, setPreloadResult] = useState(null)
  const [preloading, setPreloading] = useState(false)

  useEffect(() => {
    getSettings().then(r => setSettings(r.data)).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true); setMsg('')
    try {
      const res = await updateSettings(settings)
      setSettings(res.data)
      setMsg(t('settings.saved'))
    } catch { setMsg(t('settings.save_failed')) }
    finally { setSaving(false) }
  }

  const handlePreload = async () => {
    setPreloading(true); setPreloadResult(null)
    try {
      const res = await preloadAsr()
      setPreloadResult(res.data)
    } catch (e) {
      setPreloadResult({ status: 'error', error_message: e.response?.data?.detail || e.message })
    } finally { setPreloading(false) }
  }

  const Field = ({ label, children }) => (
    <div><label className="block text-sm text-gray-400 mb-1">{label}</label>{children}</div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
        <h2 className="text-lg font-semibold">{t('settings.asr_config')}</h2>
        <p className="text-sm text-gray-500">{t('settings.asr_desc')}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('settings.asr_model')}>
            <select value={settings.asr_model} onChange={e => setSettings({ ...settings, asr_model: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="small">small (fast, ~1GB VRAM)</option>
              <option value="medium">medium (balanced, ~2.5GB VRAM)</option>
              <option value="large-v3-turbo">large-v3-turbo (best, ~4GB VRAM)</option>
            </select>
          </Field>
          <Field label={t('settings.device')}>
            <select value={settings.device} onChange={e => setSettings({ ...settings, device: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="auto">{t('settings.auto_gpu')}</option>
              <option value="cuda">{t('settings.cuda')}</option>
              <option value="cpu">{t('settings.cpu_only')}</option>
            </select>
          </Field>
          <Field label={t('settings.compute_type')}>
            <select value={settings.compute_type} onChange={e => setSettings({ ...settings, compute_type: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="int8_float16">int8_float16 ({t('settings.recommended')})</option>
              <option value="float16">float16</option>
              <option value="int8">int8 ({t('settings.cpu_fallback')})</option>
            </select>
          </Field>
          <Field label={t('settings.chunk_seconds')}>
            <select value={settings.chunk_seconds} onChange={e => setSettings({ ...settings, chunk_seconds: parseInt(e.target.value) })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="2">2s ({t('settings.low_latency')})</option>
              <option value="3">3s ({t('settings.balanced')})</option>
              <option value="4">4s ({t('settings.better_accuracy')})</option>
            </select>
          </Field>
          <Field label={t('settings.default_lang')}>
            <select value={settings.source_language} onChange={e => setSettings({ ...settings, source_language: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="auto">Auto</option>
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-4 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
          {msg && <span className={`text-sm ${msg === t('settings.saved') ? 'text-green-400' : 'text-red-400'}`}>{msg}</span>}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-3">
        <h2 className="text-lg font-semibold">ASR Model Preload</h2>
        <p className="text-sm text-gray-500">
          第一次使用 faster-whisper 會從 Hugging Face 下載 ASR 模型到本機快取。下載完成後可離線重用。這是語音辨識模型，不是翻譯 API。
        </p>
        <div className="flex items-center gap-4">
          <button onClick={handlePreload} disabled={preloading}
            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {preloading ? 'Loading...' : 'Preload ASR Model'}
          </button>
          {preloadResult && (
            <span className={`text-sm ${preloadResult.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {preloadResult.status === 'ok'
                ? `Loaded ${preloadResult.model} on ${preloadResult.device} (${preloadResult.load_latency_ms}ms) ${preloadResult.cached ? '[cached]' : '[downloaded]'}`
                : preloadResult.error_message}
            </span>
          )}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-lg font-semibold mb-2">{t('settings.requirements')}</h2>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>{t('settings.req_ffmpeg')}</li>
          <li>{t('settings.req_model')}</li>
          <li>{t('settings.req_cuda')}</li>
          <li>{t('settings.req_rtx')}</li>
        </ul>
      </div>
    </div>
  )
}
