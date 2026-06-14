import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSession, stopSession, getSegments, translateInSession, exportSession, startLive, stopLive } from '../api'
import TranslatePanel from '../components/TranslatePanel'
import LivePanel from '../components/LivePanel'
import SegmentList from '../components/SegmentList'
import { useI18n } from '../i18n'

export default function SessionDetail() {
  const { t } = useI18n()
  const { id } = useParams()
  const [session, setSession] = useState(null)
  const [segments, setSegments] = useState([])
  const [error, setError] = useState('')
  const [mode, setMode] = useState('manual')

  const loadSession = () => getSession(id).then(r => setSession(r.data)).catch(() => {})
  const loadSegments = () => getSegments(id).then(r => setSegments(r.data)).catch(() => {})

  useEffect(() => { loadSession(); loadSegments() }, [id])
  useEffect(() => { if (session?.source_type === 'chrome_tab') setMode('live') }, [session])

  const handleTranslate = async (sourceText, sourceLanguage, m) => {
    setError('')
    try {
      const res = await translateInSession(id, { source_text: sourceText, source_language: sourceLanguage, mode: m })
      const data = res.data
      if (data.status === 'error') setError(data.error_message || t('error.translation_failed'))
      loadSegments()
      return data
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('error.translation_failed'))
      loadSegments()
      throw e
    }
  }

  const handleStop = async () => {
    try { if (mode === 'live') await stopLive(id); await stopSession(id) } catch {}
    loadSession()
  }

  const handleExport = async (format) => {
    try {
      const res = await exportSession(id, format)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = `session_${id}.${format}`; a.click()
      URL.revokeObjectURL(url)
    } catch { setError(t('error.export_failed')) }
  }

  if (!session) return <div className="text-gray-500 py-12 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/sessions" className="text-sm text-blue-400 hover:underline">{t('session.back')}</Link>
          <h1 className="text-2xl font-bold mt-1">{session.title}</h1>
          <div className="text-sm text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
            <span>{session.source_language} → {session.target_language}</span>
            {session.translation_provider && <span>· {session.translation_provider}</span>}
            {session.source_type && <span className="bg-gray-700 px-2 py-0.5 rounded-full text-xs">{session.source_type}</span>}
            <span className={`px-2 py-0.5 rounded-full text-xs ${session.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-600 text-gray-300'}`}>
              {session.status}
            </span>
          </div>
          {session.source_url && <div className="text-xs text-gray-500 mt-1 max-w-xl truncate">{session.source_url}</div>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport('json')} className="text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg">{t('session.export_json')}</button>
          <button onClick={() => handleExport('csv')} className="text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg">{t('session.export_csv')}</button>
          {session.status === 'active' && <button onClick={handleStop} className="text-sm bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg">{t('session.stop')}</button>}
        </div>
      </div>

      {error && <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">{error}</div>}

      {session.status === 'active' && (
        <>
          <div className="flex gap-2 bg-gray-800 rounded-xl p-1 border border-gray-700 w-fit">
            <button onClick={() => setMode('manual')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t('sessions.manual')}
            </button>
            <button onClick={() => setMode('live')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'live' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t('sessions.chrome_live')}
            </button>
          </div>
          {mode === 'manual' && <TranslatePanel onTranslate={handleTranslate} />}
          {mode === 'live' && <LivePanel sessionId={parseInt(id)} sessionStatus={session.status} />}
        </>
      )}

      <SegmentList segments={segments} />
    </div>
  )
}
