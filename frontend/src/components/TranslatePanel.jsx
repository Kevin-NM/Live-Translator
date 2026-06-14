import { useState } from 'react'
import { useI18n } from '../i18n'

const LANGUAGES = [
  { value: 'auto', labelKey: 'translate.source_lang' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]

export default function TranslatePanel({ onTranslate }) {
  const { t } = useI18n()
  const [sourceText, setSourceText] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [mode, setMode] = useState('realtime')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleTranslate = async () => {
    if (!sourceText.trim()) { setError(t('translate.enter_text')); return }
    setError('')
    setLoading(true)
    try {
      await onTranslate(sourceText.trim(), sourceLanguage, mode)
      setSourceText('')
    } catch (e) {
      const detail = e.response?.data?.detail
      if (typeof detail === 'string') setError(detail)
      else setError(t('error.translation_failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleTranslate() }
  }

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
      <h2 className="text-lg font-semibold">{t('translate.title')}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('translate.source_lang')}</label>
          <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.labelKey ? t(l.labelKey) : l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('translate.mode')}</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('realtime')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${mode === 'realtime' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'}`}>
              {t('translate.realtime')}
            </button>
            <button type="button" onClick={() => setMode('quality')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${mode === 'quality' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'}`}>
              {t('translate.quality')}
            </button>
          </div>
        </div>
        <div className="flex items-end">
          <button onClick={handleTranslate} disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? t('translate.translating') : t('translate.btn')}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">{t('translate.source_text')}</label>
        <textarea value={sourceText} onChange={e => setSourceText(e.target.value)} onKeyDown={handleKeyDown}
          rows={4}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          placeholder={t('translate.placeholder')} />
      </div>
      {error && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{error}</div>}
    </div>
  )
}
