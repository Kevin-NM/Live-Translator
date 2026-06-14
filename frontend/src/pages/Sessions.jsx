import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSessions, createSession, getProviders } from '../api'
import { useI18n } from '../i18n'

const LANGUAGES = [
  { value: 'auto', labelKey: 'sessions.auto_detect' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]

export default function Sessions() {
  const { t } = useI18n()
  const [sessions, setSessions] = useState([])
  const [providers, setProviders] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', source_language: 'auto', target_language: 'zh-TW', translation_provider: '' })
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const load = () => {
    getSessions().then(r => setSessions(r.data)).catch(() => {})
    getProviders().then(r => setProviders(r.data)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    setError('')
    if (!form.title.trim()) { setError(t('error.source_empty')); return }
    try {
      const payload = { ...form }
      if (!payload.translation_provider) delete payload.translation_provider
      const res = await createSession(payload)
      navigate(`/sessions/${res.data.id}`)
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('error.create_failed'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{t('sessions.title')}</h1>
        <button onClick={() => setShowCreate(!showCreate)}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          {t('sessions.new')}
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
          <h2 className="text-lg font-semibold">{t('sessions.create')}</h2>
          {error && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('sessions.title_label')}</label>
              <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                placeholder={t('sessions.title_placeholder')} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('sessions.source_lang')}</label>
              <select value={form.source_language} onChange={e => setForm({ ...form, source_language: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.labelKey ? t(l.labelKey) : l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('sessions.provider')}</label>
              <select value={form.translation_provider} onChange={e => setForm({ ...form, translation_provider: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                <option value="">{t('sessions.auto_priority')}</option>
                {providers.filter(p => p.enabled).map(p => (
                  <option key={p.id} value={p.provider_name}>{p.provider_name} ({p.model})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
              {t('sessions.create_btn')}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 py-2 rounded-lg text-sm">
              {t('sessions.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sessions.map(s => (
          <Link key={s.id} to={`/sessions/${s.id}`}
            className="block bg-gray-800 hover:bg-gray-750 rounded-xl p-4 border border-gray-700 transition-colors">
            <div className="flex justify-between items-center">
              <span className="font-semibold">{s.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-600 text-gray-300'}`}>
                {s.status}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
              <span>{s.source_language} → {s.target_language}</span>
              {s.source_type && s.source_type !== 'manual' && <span className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">{s.source_type}</span>}
              {s.translation_provider && <span>· {s.translation_provider}</span>}
              <span>· {new Date(s.created_at).toLocaleString('zh-TW')}</span>
            </div>
          </Link>
        ))}
        {sessions.length === 0 && <div className="text-center text-gray-500 py-12">{t('sessions.no_sessions')}</div>}
      </div>
    </div>
  )
}
