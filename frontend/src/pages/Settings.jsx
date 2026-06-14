import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../api'

export default function Settings() {
  const [settings, setSettings] = useState({
    asr_model: 'small', device: 'auto', compute_type: 'int8_float16',
    chunk_seconds: 3, source_language: 'ja',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getSettings().then(r => setSettings(r.data)).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await updateSettings(settings)
      setSettings(res.data)
      setMsg('Settings saved')
    } catch (e) {
      setMsg('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const Field = ({ label, children }) => (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
        <h2 className="text-lg font-semibold">ASR Configuration</h2>
        <p className="text-sm text-gray-500">Configure the speech recognition engine used for Chrome Live Mode.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="ASR Model">
            <select value={settings.asr_model} onChange={e => setSettings({ ...settings, asr_model: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="small">small (fast, ~1GB VRAM)</option>
              <option value="medium">medium (balanced, ~2.5GB VRAM)</option>
              <option value="large-v3-turbo">large-v3-turbo (best, ~4GB VRAM)</option>
            </select>
          </Field>

          <Field label="Device">
            <select value={settings.device} onChange={e => setSettings({ ...settings, device: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="auto">Auto (GPU if available)</option>
              <option value="cuda">CUDA (force GPU)</option>
              <option value="cpu">CPU only</option>
            </select>
          </Field>

          <Field label="Compute Type">
            <select value={settings.compute_type} onChange={e => setSettings({ ...settings, compute_type: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="int8_float16">int8_float16 (recommended for RTX 4060)</option>
              <option value="float16">float16</option>
              <option value="int8">int8 (CPU fallback)</option>
            </select>
          </Field>

          <Field label="Chunk Seconds">
            <select value={settings.chunk_seconds} onChange={e => setSettings({ ...settings, chunk_seconds: parseInt(e.target.value) })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="2">2 seconds (low latency)</option>
              <option value="3">3 seconds (balanced)</option>
              <option value="4">4 seconds (better accuracy)</option>
            </select>
          </Field>

          <Field label="Default Source Language">
            <select value={settings.source_language} onChange={e => setSettings({ ...settings, source_language: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="auto">Auto Detect</option>
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {msg && <span className={`text-sm ${msg.includes('saved') ? 'text-green-400' : 'text-red-400'}`}>{msg}</span>}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-lg font-semibold mb-2">System Requirements</h2>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• ffmpeg must be installed and in PATH (for audio decoding)</li>
          <li>• faster-whisper model will be downloaded on first use</li>
          <li>• CUDA 11.8+ required for GPU acceleration</li>
          <li>• RTX 4060 Laptop recommended: int8_float16 + small or medium model</li>
        </ul>
      </div>
    </div>
  )
}
