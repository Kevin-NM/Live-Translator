import { useEffect, useState } from 'react'
import { getProviders, createProvider, updateProvider, deleteProvider, testProvider, translationTest, translationCompare } from '../api'
import ProviderForm from '../components/ProviderForm'
import { useI18n } from '../i18n'

const EMPTY_PROVIDER = {
  provider_name: '', base_url: '', api_key: '', model: '',
  enabled: true, priority: 0, timeout_ms: 5000, max_retries: 2,
  temperature: 0.1, max_tokens: 256,
}

export default function Providers() {
  const { t } = useI18n()
  const [providers, setProviders] = useState([])
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [testResults, setTestResults] = useState({})
  const [selfTestResults, setSelfTestResults] = useState({})
  const [testing, setTesting] = useState({})
  const [selfTesting, setSelfTesting] = useState({})
  const [errors, setErrors] = useState({})
  const [compareProvider, setCompareProvider] = useState('')
  const [compareText, setCompareText] = useState('ありがとうございます')
  const [compareResults, setCompareResults] = useState([])
  const [comparing, setComparing] = useState(false)

  const load = () => getProviders().then(r => setProviders(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const handleSave = async (data) => {
    setErrors({})
    try {
      if (editing?.id) { await updateProvider(editing.id, data) }
      else { await createProvider(data) }
      setShowForm(false)
      setEditing(null)
      load()
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrors({ form: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(t('providers.delete_confirm'))) return
    await deleteProvider(id)
    load()
  }

  const handleTest = async (id) => {
    setTesting(t2 => ({ ...t2, [id]: true }))
    setTestResults(r => ({ ...r, [id]: null }))
    setErrors(e => ({ ...e, [id]: null }))
    try {
      const res = await testProvider(id)
      setTestResults(r => ({ ...r, [id]: res.data }))
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrors(e2 => ({ ...e2, [id]: typeof detail === 'string' ? detail : JSON.stringify(detail) }))
    } finally {
      setTesting(t2 => ({ ...t2, [id]: false }))
    }
  }

  const handleSelfTest = async (id) => {
    setSelfTesting(t2 => ({ ...t2, [id]: true }))
    setSelfTestResults(r => ({ ...r, [id]: null }))
    setErrors(e => ({ ...e, [`${id}_self`]: null }))
    try {
      const res = await translationTest({ provider_id: id, source_language: 'ja' })
      setSelfTestResults(r => ({ ...r, [id]: res.data }))
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrors(e2 => ({ ...e2, [`${id}_self`]: typeof detail === 'string' ? detail : JSON.stringify(detail) }))
    } finally {
      setSelfTesting(t2 => ({ ...t2, [id]: false }))
    }
  }

  const handleCompare = async () => {
    if (!compareProvider || !compareText.trim()) return
    setComparing(true); setCompareResults([])
    try {
      const res = await translationCompare({ provider_id: Number(compareProvider), source_language: 'ja', target_language: 'zh-TW', source_text: compareText.trim() })
      setCompareResults(res.data)
    } catch (e) {
      setErrors(v => ({ ...v, compare: e.response?.data?.detail || e.message }))
    } finally { setComparing(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{t('providers.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); setErrors({}) }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          {t('providers.add')}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h2 className="text-lg font-semibold mb-4">{editing?.id ? t('providers.edit') : t('providers.new')}</h2>
          {errors.form && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg mb-4 text-sm">{errors.form}</div>}
          <ProviderForm initial={editing || EMPTY_PROVIDER} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null) }} />
        </div>
      )}

      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Translation Compare</h2>
          <p className="text-xs text-gray-500">比較 provider_test / manual / inject / live 與三種 prompt adapter。測試會同時送出 7 筆請求。</p>
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <select value={compareProvider} onChange={e => setCompareProvider(e.target.value)} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
            <option value="">Select provider</option>
            {providers.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.provider_name} · {p.model}</option>)}
          </select>
          <input value={compareText} onChange={e => setCompareText(e.target.value)} className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm" />
          <button onClick={handleCompare} disabled={comparing || !compareProvider} className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-sm disabled:opacity-50">{comparing ? 'Comparing...' : 'Compare'}</button>
        </div>
        {errors.compare && <div className="text-red-400 text-sm">{String(errors.compare)}</div>}
        {compareResults.length > 0 && <div className="space-y-2">
          {compareResults.map((r, i) => <details key={i} className={`rounded border p-3 ${r.wrong_target_language?.is_wrong ? 'border-orange-700 bg-orange-900/20' : r.final_status === 'completed' ? 'border-green-700 bg-green-900/20' : 'border-red-700 bg-red-900/20'}`}>
            <summary className="cursor-pointer text-sm"><b>{r.route}</b> · {r.variant} · {r.final_status}{r.wrong_target_language?.reason ? ` · ${r.wrong_target_language.reason}` : ''} · {r.latency_ms || 0}ms</summary>
            <div className="mt-2 text-sm text-white">{r.normalized_output || r.error_message || '(empty)'}</div>
            <div className="mt-2 grid md:grid-cols-2 gap-2 text-xs">
              <pre className="bg-gray-950 p-2 rounded whitespace-pre-wrap overflow-auto">SYSTEM\n{r.system_prompt || '(none)'}</pre>
              <pre className="bg-gray-950 p-2 rounded whitespace-pre-wrap overflow-auto">USER\n{r.user_prompt}</pre>
            </div>
          </details>)}
        </div>}
      </div>

      <div className="space-y-4">
        {providers.map(p => (
          <div key={p.id} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg">{p.provider_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-600 text-gray-400'}`}>
                    {p.enabled ? t('providers.enabled') : t('providers.disabled')}
                  </span>
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{t('providers.priority')}: {p.priority}</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">{p.base_url} · {p.model}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {t('providers.timeout')}: {p.timeout_ms}ms · {t('providers.retries')}: {p.max_retries} · {t('providers.temp')}: {p.temperature} · {t('providers.tokens')}: {p.max_tokens}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(p); setShowForm(true); setErrors({}) }}
                  className="text-sm text-blue-400 hover:text-blue-300 px-3 py-1 rounded border border-gray-600 hover:border-blue-500">
                  {t('providers.edit_btn')}
                </button>
                <button onClick={() => handleTest(p.id)} disabled={testing[p.id]}
                  className="text-sm text-green-400 hover:text-green-300 px-3 py-1 rounded border border-gray-600 hover:border-green-500 disabled:opacity-50">
                  {testing[p.id] ? t('providers.testing') : t('providers.test')}
                </button>
                <button onClick={() => handleSelfTest(p.id)} disabled={selfTesting[p.id]}
                  className="text-sm text-yellow-400 hover:text-yellow-300 px-3 py-1 rounded border border-gray-600 hover:border-yellow-500 disabled:opacity-50">
                  {selfTesting[p.id] ? t('providers.self_testing') : t('providers.self_test')}
                </button>
                <button onClick={() => handleDelete(p.id)}
                  className="text-sm text-red-400 hover:text-red-300 px-3 py-1 rounded border border-gray-600 hover:border-red-500">
                  {t('providers.delete')}
                </button>
              </div>
            </div>

            {errors[p.id] && <div className="mt-3 bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{errors[p.id]}</div>}
            {errors[`${p.id}_self`] && <div className="mt-3 bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{errors[`${p.id}_self`]}</div>}

            {testResults[p.id] && (
              <div className="mt-3 space-y-2">
                {testResults[p.id].map((r, i) => (
                  <div key={i} className={`rounded-lg p-3 text-sm border ${r.status === 'completed' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium">{r.status === 'completed' ? 'PASS' : 'FAIL'} · {r.model}</span>
                      <span className="text-gray-400">{r.latency_ms}ms</span>
                    </div>
                    {r.output && <div className="text-gray-200">{r.output}</div>}
                    {r.error_message && <div className="text-red-300">{r.error_message}</div>}
                  </div>
                ))}
              </div>
            )}

            {selfTestResults[p.id] && (() => {
              const r = selfTestResults[p.id]
              return (
                <div className={`mt-3 rounded-lg p-4 text-sm border ${r.status === 'completed' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium">{r.status === 'completed' ? 'PASS' : 'FAIL'} · {r.provider_name} · {r.model}</span>
                    <span className="text-gray-400">{r.latency_ms}ms</span>
                  </div>
                  <div className="mb-1"><span className="text-xs text-gray-500">{t('providers.source')}: </span><span className="text-gray-400">{r.source_text}</span></div>
                  {r.translated_text && <div className="mb-1"><span className="text-xs text-gray-500">{t('providers.output')}: </span><span className="text-white font-medium">{r.translated_text}</span></div>}
                  {r.http_status && <div className="text-xs text-gray-500">{t('providers.http')}: {r.http_status}</div>}
                  {r.error_message && <div className="text-red-300 mt-1">{r.error_message}</div>}
                  {r.raw_response_preview && r.status !== 'completed' && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">{t('providers.raw_response')}</summary>
                      <pre className="text-xs text-gray-400 mt-1 bg-gray-900 p-2 rounded overflow-x-auto max-h-32">{r.raw_response_preview}</pre>
                    </details>
                  )}
                </div>
              )
            })()}
          </div>
        ))}

        {providers.length === 0 && (
          <div className="text-center text-gray-500 py-12">{t('providers.no_providers')}</div>
        )}
      </div>
    </div>
  )
}
