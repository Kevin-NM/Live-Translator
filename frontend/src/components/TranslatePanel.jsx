import { useState } from 'react'

const LANGUAGES = [
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]

export default function TranslatePanel({ onTranslate }) {
  const [sourceText, setSourceText] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [mode, setMode] = useState('realtime')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const handleTranslate = async () => {
    if (!sourceText.trim()) { setError('Please enter text to translate'); return }
    setError('')
    setLoading(true)
    setResult(null)
    try {
      const res = await onTranslate(sourceText.trim(), sourceLanguage, mode)
      setResult(res)
      setSourceText('')
    } catch (e) {
      const detail = e.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else if (e.response?.status === 502) {
        setError('Translation API error: ' + (detail || 'Unknown'))
      } else {
        setError('Translation failed. Check provider settings.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleTranslate()
    }
  }

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
      <h2 className="text-lg font-semibold">Translate</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Source Language</label>
          <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Mode</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('realtime')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${mode === 'realtime' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'}`}>
              Realtime
            </button>
            <button type="button" onClick={() => setMode('quality')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${mode === 'quality' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'}`}>
              Quality
            </button>
          </div>
        </div>
        <div className="flex items-end">
          <button onClick={handleTranslate} disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Translating...' : 'Translate (Ctrl+Enter)'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Source Text</label>
        <textarea value={sourceText} onChange={e => setSourceText(e.target.value)} onKeyDown={handleKeyDown}
          rows={4}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          placeholder="Enter English or Japanese text to translate..." />
      </div>

      {error && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{error}</div>}
    </div>
  )
}
