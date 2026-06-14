import { useState } from 'react'
import { useI18n } from '../i18n'

const MODEL_OPTIONS = [
  'nvidia/riva-translate-4b-instruct-v1.1',
  'deepseek-ai/deepseek-v4-flash',
  'stepfun-ai/step-3.7-flash',
  'qwen/qwen3-next-80b-a3b-instruct',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'meta/llama-3.3-70b-instruct',
]

export default function ProviderForm({ initial, onSave, onCancel }) {
  const { t } = useI18n()
  const [form, setForm] = useState({ ...initial })
  const [showKey, setShowKey] = useState(false)
  const [modelCustom, setModelCustom] = useState(!MODEL_OPTIONS.includes(initial.model))
  const [errors, setErrors] = useState({})

  const validate = () => {
    const e = {}
    if (!form.provider_name.trim()) e.provider_name = 'Required'
    if (!form.base_url.trim()) e.base_url = 'Required'
    if (!form.api_key.trim()) e.api_key = 'Required'
    if (!form.model.trim()) e.model = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (e) => { e.preventDefault(); if (validate()) onSave(form) }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.provider_name')}</label>
          <input type="text" value={form.provider_name} onChange={e => setForm({ ...form, provider_name: e.target.value })}
            className={`w-full bg-gray-700 border ${errors.provider_name ? 'border-red-500' : 'border-gray-600'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500`} />
          {errors.provider_name && <p className="text-red-400 text-xs mt-1">{errors.provider_name}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.base_url')}</label>
          <input type="text" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })}
            className={`w-full bg-gray-700 border ${errors.base_url ? 'border-red-500' : 'border-gray-600'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500`}
            placeholder="https://openrouter.ai/api/v1" />
          {errors.base_url && <p className="text-red-400 text-xs mt-1">{errors.base_url}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.api_key')}</label>
          <div className="relative">
            <input type={showKey ? 'text' : 'password'} value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })}
              className={`w-full bg-gray-700 border ${errors.api_key ? 'border-red-500' : 'border-gray-600'} rounded-lg px-3 py-2 pr-16 text-sm focus:outline-none focus:border-blue-500`}
              placeholder="sk-..." />
            <button type="button" onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1">
              {showKey ? t('form.hide') : t('form.show')}
            </button>
          </div>
          {errors.api_key && <p className="text-red-400 text-xs mt-1">{errors.api_key}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.model')}</label>
          <div className="space-y-2">
            <select value={modelCustom ? '__custom__' : form.model}
              onChange={e => {
                if (e.target.value === '__custom__') setModelCustom(true)
                else { setModelCustom(false); setForm({ ...form, model: e.target.value }) }
              }}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="__custom__">{t('form.custom_model')}</option>
            </select>
            {modelCustom && (
              <input type="text" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                className={`w-full bg-gray-700 border ${errors.model ? 'border-red-500' : 'border-gray-600'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500`} />
            )}
          </div>
          {errors.model && <p className="text-red-400 text-xs mt-1">{errors.model}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.enabled')}</label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500" />
            <span className="text-sm text-gray-300">{form.enabled ? t('providers.enabled') : t('providers.disabled')}</span>
          </label>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.priority')}</label>
          <input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" min="0" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.timeout_ms')}</label>
          <input type="number" value={form.timeout_ms} onChange={e => setForm({ ...form, timeout_ms: parseInt(e.target.value) || 5000 })}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" min="1000" max="60000" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.max_retries')}</label>
          <input type="number" value={form.max_retries} onChange={e => setForm({ ...form, max_retries: parseInt(e.target.value) || 0 })}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" min="0" max="5" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.temperature')}</label>
          <input type="number" step="0.05" value={form.temperature} onChange={e => setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" min="0" max="2" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('form.max_tokens')}</label>
          <input type="number" value={form.max_tokens} onChange={e => setForm({ ...form, max_tokens: parseInt(e.target.value) || 256 })}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" min="1" max="4096" />
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium">{t('form.save')}</button>
        <button type="button" onClick={onCancel} className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-5 py-2 rounded-lg text-sm">{t('form.cancel')}</button>
      </div>
    </form>
  )
}
