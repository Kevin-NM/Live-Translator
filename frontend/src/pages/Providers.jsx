import { useEffect, useState } from 'react'
import { getProviders, createProvider, updateProvider, deleteProvider, testProvider, translationTest } from '../api'
import ProviderForm from '../components/ProviderForm'

const EMPTY_PROVIDER = {
  provider_name: '', base_url: '', api_key: '', model: '',
  enabled: true, priority: 0, timeout_ms: 5000, max_retries: 2,
  temperature: 0.1, max_tokens: 256,
}

export default function Providers() {
  const [providers, setProviders] = useState([])
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [testResults, setTestResults] = useState({})
  const [selfTestResults, setSelfTestResults] = useState({})
  const [testing, setTesting] = useState({})
  const [selfTesting, setSelfTesting] = useState({})
  const [errors, setErrors] = useState({})

  const load = () => getProviders().then(r => setProviders(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const handleSave = async (data) => {
    setErrors({})
    try {
      if (editing?.id) {
        await updateProvider(editing.id, data)
      } else {
        await createProvider(data)
      }
      setShowForm(false)
      setEditing(null)
      load()
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrors({ form: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this provider?')) return
    await deleteProvider(id)
    load()
  }

  const handleTest = async (id) => {
    setTesting(t => ({ ...t, [id]: true }))
    setTestResults(r => ({ ...r, [id]: null }))
    setErrors(e => ({ ...e, [id]: null }))
    try {
      const res = await testProvider(id)
      setTestResults(r => ({ ...r, [id]: res.data }))
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrors(e2 => ({ ...e2, [id]: typeof detail === 'string' ? detail : JSON.stringify(detail) }))
    } finally {
      setTesting(t => ({ ...t, [id]: false }))
    }
  }

  const handleSelfTest = async (id) => {
    setSelfTesting(t => ({ ...t, [id]: true }))
    setSelfTestResults(r => ({ ...r, [id]: null }))
    setErrors(e => ({ ...e, [`${id}_self`]: null }))
    try {
      const res = await translationTest({ provider_id: id, source_language: 'ja' })
      setSelfTestResults(r => ({ ...r, [id]: res.data }))
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrors(e2 => ({ ...e2, [`${id}_self`]: typeof detail === 'string' ? detail : JSON.stringify(detail) }))
    } finally {
      setSelfTesting(t => ({ ...t, [id]: false }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Providers</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); setErrors({}) }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Add Provider
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h2 className="text-lg font-semibold mb-4">{editing?.id ? 'Edit Provider' : 'New Provider'}</h2>
          {errors.form && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg mb-4 text-sm">{errors.form}</div>}
          <ProviderForm initial={editing || EMPTY_PROVIDER} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null) }} />
        </div>
      )}

      <div className="space-y-4">
        {providers.map(p => (
          <div key={p.id} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg">{p.provider_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-600 text-gray-400'}`}>
                    {p.enabled ? 'enabled' : 'disabled'}
                  </span>
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">priority: {p.priority}</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {p.base_url} · {p.model}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  timeout: {p.timeout_ms}ms · retries: {p.max_retries} · temp: {p.temperature} · tokens: {p.max_tokens}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(p); setShowForm(true); setErrors({}) }}
                  className="text-sm text-blue-400 hover:text-blue-300 px-3 py-1 rounded border border-gray-600 hover:border-blue-500">
                  Edit
                </button>
                <button onClick={() => handleTest(p.id)} disabled={testing[p.id]}
                  className="text-sm text-green-400 hover:text-green-300 px-3 py-1 rounded border border-gray-600 hover:border-green-500 disabled:opacity-50">
                  {testing[p.id] ? 'Testing...' : 'Test'}
                </button>
                <button onClick={() => handleSelfTest(p.id)} disabled={selfTesting[p.id]}
                  className="text-sm text-yellow-400 hover:text-yellow-300 px-3 py-1 rounded border border-gray-600 hover:border-yellow-500 disabled:opacity-50">
                  {selfTesting[p.id] ? 'Self-Testing...' : 'Self-Test'}
                </button>
                <button onClick={() => handleDelete(p.id)}
                  className="text-sm text-red-400 hover:text-red-300 px-3 py-1 rounded border border-gray-600 hover:border-red-500">
                  Delete
                </button>
              </div>
            </div>

            {errors[p.id] && (
              <div className="mt-3 bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{errors[p.id]}</div>
            )}
            {errors[`${p.id}_self`] && (
              <div className="mt-3 bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{errors[`${p.id}_self`]}</div>
            )}

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
                    <span className="font-medium">
                      {r.status === 'completed' ? 'PASS' : 'FAIL'} · {r.provider_name} · {r.model}
                    </span>
                    <span className="text-gray-400">{r.latency_ms}ms</span>
                  </div>
                  <div className="mb-1">
                    <span className="text-xs text-gray-500">Source ({r.source_text === '...' ? 'ja' : 'ja'}): </span>
                    <span className="text-gray-400">{r.source_text}</span>
                  </div>
                  {r.translated_text && (
                    <div className="mb-1">
                      <span className="text-xs text-gray-500">Output: </span>
                      <span className="text-white font-medium">{r.translated_text}</span>
                    </div>
                  )}
                  {r.http_status && (
                    <div className="text-xs text-gray-500">HTTP: {r.http_status}</div>
                  )}
                  {r.error_message && (
                    <div className="text-red-300 mt-1">{r.error_message}</div>
                  )}
                  {r.raw_response_preview && r.status !== 'completed' && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Raw response preview</summary>
                      <pre className="text-xs text-gray-400 mt-1 bg-gray-900 p-2 rounded overflow-x-auto max-h-32">{r.raw_response_preview}</pre>
                    </details>
                  )}
                </div>
              )
            })()}
          </div>
        ))}

        {providers.length === 0 && (
          <div className="text-center text-gray-500 py-12">No providers configured. Click "Add Provider" to get started.</div>
        )}
      </div>
    </div>
  )
}
