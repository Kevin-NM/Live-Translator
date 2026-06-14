import { useI18n } from '../i18n'

export default function SegmentList({ segments }) {
  const { t } = useI18n()

  if (!segments || segments.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">{t('segments.title')}</h2>
        <div className="text-center text-gray-500 py-8">{t('segments.no_segments')}</div>
      </div>
    )
  }

  const statusColors = {
    completed: 'bg-green-900 text-green-300',
    translated: 'bg-green-900 text-green-300',
    rejected: 'bg-orange-900 text-orange-300',
    error: 'bg-red-900 text-red-300',
    translating: 'bg-yellow-900 text-yellow-300',
    queued: 'bg-blue-900 text-blue-300',
    pending: 'bg-gray-600 text-gray-300',
  }

  const borderColors = {
    completed: 'bg-gray-750 border-gray-600',
    translated: 'bg-gray-750 border-gray-600',
    rejected: 'bg-orange-900/10 border-orange-900',
    error: 'bg-red-900/10 border-red-900',
    translating: 'bg-yellow-900/10 border-yellow-900',
    queued: 'bg-blue-900/10 border-blue-900',
    pending: 'bg-gray-800 border-gray-700',
  }

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <h2 className="text-lg font-semibold mb-3">{t('segments.count', { count: segments.length })}</h2>
      <div className="space-y-3">
        {[...segments].reverse().map(seg => (
          <div key={seg.id} className={`rounded-lg p-4 border ${borderColors[seg.status] || borderColors.pending}`}>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">#{seg.segment_index}</span>
                <span className="text-xs text-gray-500">{seg.source_language?.toUpperCase()}</span>
                {seg.asr_provider && <span className="text-xs text-gray-600">{t('segments.asr')}: {seg.asr_provider}</span>}
                {seg.model && <span className="text-xs text-gray-500">{seg.model}</span>}
                {seg.translation_provider && <span className="text-xs text-gray-500">via {seg.translation_provider}</span>}
              </div>
              <div className="flex items-center gap-2">
                {seg.latency_asr_ms != null && <span className="text-xs text-gray-500">{t('segments.asr')}: {Math.round(seg.latency_asr_ms)}ms</span>}
                {seg.latency_translate_ms != null && <span className="text-xs text-gray-500">{t('segments.api')}: {Math.round(seg.latency_translate_ms)}ms</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[seg.status] || statusColors.pending}`}>
                  {seg.status}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">{t('segments.source')}</div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{seg.source_text}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{t('segments.translation')}</div>
                <div className="text-sm text-white whitespace-pre-wrap font-medium">
                  {seg.status === 'translated' && seg.translated_text
                    ? seg.translated_text
                    : seg.status === 'rejected'
                      ? <span className="text-orange-400 text-xs">Output rejected (wrong target language)</span>
                      : seg.status === 'error'
                        ? <span className="text-red-400 text-xs">{seg.error_message || 'Translation error'}</span>
                        : seg.status === 'translating'
                          ? <span className="text-gray-500 italic text-xs">Translating...</span>
                          : seg.status === 'queued'
                            ? <span className="text-blue-400 text-xs">Queued...</span>
                            : <span className="text-gray-600">—</span>
                  }
                </div>
              </div>
            </div>
            {seg.error_message && seg.status !== 'rejected' && (
              <div className="mt-2 text-xs text-red-300 bg-red-900/30 px-3 py-1.5 rounded">{seg.error_message}</div>
            )}
            <div className="flex justify-between text-xs text-gray-600 mt-2">
              <span>{new Date(seg.created_at).toLocaleString('zh-TW')}</span>
              {seg.start_ms != null && seg.end_ms != null && <span>{Math.floor(seg.start_ms / 1000)}s - {Math.floor(seg.end_ms / 1000)}s</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
