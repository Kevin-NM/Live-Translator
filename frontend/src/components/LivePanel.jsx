import { useEffect, useRef, useState } from 'react'
import { injectLiveText } from '../api'
import { useI18n } from '../i18n'

export default function LivePanel({ sessionId, sessionStatus }) {
  const { t } = useI18n()
  const [liveSegments, setLiveSegments] = useState([])
  const [wsStatus, setWsStatus] = useState('disconnected')
  const [backendStats, setBackendStats] = useState(null)
  const [injectText, setInjectText] = useState('')
  const [injectLang, setInjectLang] = useState('ja')
  const [injecting, setInjecting] = useState(false)

  const wsRef = useRef(null)
  const segmentsRef = useRef([])
  const statusIntervalRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const mountedRef = useRef(false)
  const reconnectAttemptRef = useRef(0)

  const clearSegments = () => {
    segmentsRef.current = []
    setLiveSegments([])
  }

  const handleWsMessage = (msg) => {
    if (!mountedRef.current) return
    if (msg.type === 'final') {
      const seg = {
        id: msg.segment_id,
        source_text: msg.source_text,
        translated_text: null,
        source_language: msg.source_language,
        start_ms: msg.start_ms,
        end_ms: msg.end_ms,
        latency_asr_ms: msg.latency_asr_ms,
        latency_translate_ms: null,
        status: 'translating',
        provider_name: null,
        model: null,
      }
      segmentsRef.current = [...segmentsRef.current, seg]
      setLiveSegments([...segmentsRef.current])
    } else if (msg.type === 'translation_update') {
      segmentsRef.current = segmentsRef.current.map(s => {
        if (s.id === msg.segment_id) {
          return {
            ...s,
            translated_text: msg.translated_text,
            latency_translate_ms: msg.latency_translate_ms,
            status: msg.status,
            provider_name: msg.provider_name,
            model: msg.model,
          }
        }
        return s
      })
      setLiveSegments([...segmentsRef.current])
    } else if (msg.type === 'error') {
      console.error('[LivePanel] backend error:', msg.error)
    }
  }

  const connectWs = () => {
    if (wsRef.current && wsRef.current.readyState <= 1) return

    const wsUrl = `ws://${window.location.hostname}:8787/ws/live/${sessionId}`
    console.log('[LivePanel] connecting WebSocket:', wsUrl)
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      console.log('[LivePanel] WebSocket connected')
      setWsStatus('connected')
      reconnectAttemptRef.current = 0
    }
    ws.onclose = (e) => {
      console.log('[LivePanel] WebSocket closed:', e.code)
      if (mountedRef.current) {
        setWsStatus('disconnected')
        wsRef.current = null
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000)
        reconnectAttemptRef.current++
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current && sessionStatus === 'active') connectWs()
        }, delay)
      }
    }
    ws.onerror = () => {
      console.error('[LivePanel] WebSocket error')
      if (mountedRef.current) setWsStatus('error')
    }
    ws.onmessage = (e) => {
      try { handleWsMessage(JSON.parse(e.data)) } catch {}
    }

    wsRef.current = ws
  }

  const startStatusPolling = () => {
    stopStatusPolling()
    const poll = async () => {
      if (!mountedRef.current) return
      try {
        const res = await fetch(`/api/sessions/${sessionId}/live/status`)
        if (res.ok && mountedRef.current) {
          const data = await res.json()
          setBackendStats(data)
        }
      } catch {}
    }
    poll()
    const intervalMs = document.hidden ? 10000 : 2000
    statusIntervalRef.current = setInterval(() => {
      const ms = document.hidden ? 10000 : 2000
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current)
      statusIntervalRef.current = setInterval(poll, ms)
    }, intervalMs)
  }

  const stopStatusPolling = () => {
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current)
      statusIntervalRef.current = null
    }
  }

  const cleanup = () => {
    mountedRef.current = false

    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onerror = null
      wsRef.current.onclose = null
      try { wsRef.current.close() } catch {}
      wsRef.current = null
    }

    stopStatusPolling()

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    reconnectAttemptRef.current = 0

    if (sessionStatus === 'active') {
      connectWs()
    }
    startStatusPolling()

    return cleanup
  }, [sessionId, sessionStatus])

  const handleInject = async () => {
    if (!injectText.trim()) return
    setInjecting(true)
    try {
      await injectLiveText(sessionId, { source_language: injectLang, source_text: injectText.trim() })
      setInjectText('')
    } catch (e) {
      console.error('[LivePanel] inject failed:', e)
    } finally {
      setInjecting(false)
    }
  }

  const extConnected = backendStats?.audio_ws_connected || false
  const chunksReceived = backendStats?.chunks_received || 0
  const lastChunkAt = backendStats?.last_audio_chunk_at
  const lastChunkBytes = backendStats?.last_audio_chunk_bytes || 0
  const decodeStatus = backendStats?.last_decode_status || 'pending'
  const lastError = backendStats?.last_error || ''

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{t('live.title')}</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${
              wsStatus === 'connected' ? 'bg-green-400' :
              wsStatus === 'error' ? 'bg-red-400' : 'bg-gray-500'
            }`} />
            <span className="text-gray-400">{t('live.ws')}: {wsStatus}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${extConnected ? 'bg-green-400' : 'bg-gray-500'}`} />
            <span className="text-gray-400">{t('live.ext')}: {extConnected ? t('live.connected') : t('live.disconnected')}</span>
          </div>
          {liveSegments.length > 0 && (
            <button onClick={clearSegments} className="text-xs text-gray-500 hover:text-gray-300">{t('live.clear')}</button>
          )}
        </div>
      </div>

      <div className="bg-gray-750 rounded-lg p-3 border border-gray-600 text-xs font-mono space-y-1">
        <div className="text-gray-500 font-semibold mb-1">{t('live.backend_status')}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-gray-500">{t('live.audio_ws')}</span>
          <span className={extConnected ? 'text-green-400' : 'text-gray-400'}>{extConnected ? t('live.connected') : t('live.disconnected')}</span>
          <span className="text-gray-500">{t('live.format')}</span>
          <span className="text-gray-300">{backendStats?.last_format || '-'}</span>
          <span className="text-gray-500">{t('live.sample_rate')}</span>
          <span className="text-gray-300">{backendStats?.last_sample_rate ? backendStats.last_sample_rate + ' Hz' : '-'}</span>
          <span className="text-gray-500">{t('live.channels')}</span>
          <span className="text-gray-300">{backendStats?.last_channels || '-'}</span>
          <span className="text-gray-500">{t('live.chunks_received')}</span>
          <span className="text-gray-300">{chunksReceived}</span>
          <span className="text-gray-500">{t('live.last_chunk_size')}</span>
          <span className="text-gray-300">{lastChunkBytes > 0 ? lastChunkBytes + ' bytes' : '-'}</span>
          <span className="text-gray-500">{t('live.pcm_buffered')}</span>
          <span className="text-gray-300">{backendStats?.pcm_duration_buffered ? backendStats.pcm_duration_buffered + 's' : '-'}</span>
          <span className="text-gray-500">{t('live.last_chunk_at')}</span>
          <span className="text-gray-300">{lastChunkAt ? new Date(lastChunkAt * 1000).toLocaleTimeString() : '-'}</span>
          <span className="text-gray-500">{t('live.decode_status')}</span>
          <span className={
            decodeStatus === 'ok' ? 'text-green-400' :
            decodeStatus === 'error' ? 'text-red-400' :
            decodeStatus === 'buffering' ? 'text-yellow-400' : 'text-gray-400'
          }>{decodeStatus}</span>
          {lastError && <>
            <span className="text-gray-500">{t('live.last_error')}</span>
            <span className="text-red-400 truncate">{lastError}</span>
          </>}
        </div>
      </div>

      <div className="bg-blue-900/30 border border-blue-800 rounded-lg p-3 text-sm text-blue-200">
        <strong>{t('live.instructions')}</strong> {t('live.instructions_text')}
      </div>

      <div className="bg-gray-750 rounded-lg p-3 border border-gray-600 space-y-2">
        <div className="text-xs text-gray-500 font-semibold">{t('live.inject_title')}</div>
        <div className="flex gap-2">
          <select value={injectLang} onChange={e => setInjectLang(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500">
            <option value="ja">JA</option>
            <option value="en">EN</option>
          </select>
          <input type="text" value={injectText} onChange={e => setInjectText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleInject() }}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            placeholder={t('live.inject_placeholder')} />
          <button onClick={handleInject} disabled={injecting || !injectText.trim()}
            className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50">
            {injecting ? '...' : t('live.inject_btn')}
          </button>
        </div>
      </div>

      {liveSegments.length > 0 && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {[...liveSegments].reverse().map((seg, i) => (
            <div key={seg.id || i} className={`rounded-lg p-3 border text-sm ${
              seg.status === 'translated' ? 'bg-gray-750 border-gray-600' :
              seg.status === 'translating' ? 'bg-yellow-900/20 border-yellow-800' :
              seg.status === 'error' ? 'bg-red-900/20 border-red-800' :
              'bg-gray-800 border-gray-700'
            }`}>
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{seg.source_language?.toUpperCase()}</span>
                  {seg.model && <span className="text-xs text-gray-600">{seg.model}</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {seg.latency_asr_ms != null && <span>ASR: {Math.round(seg.latency_asr_ms)}ms</span>}
                  {seg.latency_translate_ms != null && <span>API: {Math.round(seg.latency_translate_ms)}ms</span>}
                  <span className={`px-1.5 py-0.5 rounded ${
                    seg.status === 'translated' ? 'bg-green-900 text-green-300' :
                    seg.status === 'translating' ? 'bg-yellow-900 text-yellow-300' :
                    seg.status === 'error' ? 'bg-red-900 text-red-300' :
                    'bg-gray-700 text-gray-400'
                  }`}>{seg.status}</span>
                </div>
              </div>
              <div className="text-gray-300">{seg.source_text}</div>
              <div className="text-white font-medium mt-1">
                {seg.translated_text || <span className="text-gray-500 italic">{t('live.translating')}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {liveSegments.length === 0 && (
        <div className="text-center text-gray-500 py-6 text-sm">
          {extConnected ? t('live.waiting_asr') : t('live.waiting_ext')}
        </div>
      )}
    </div>
  )
}
