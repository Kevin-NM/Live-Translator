export default function SegmentList({ segments }) {
  if (!segments || segments.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">Translation History</h2>
        <div className="text-center text-gray-500 py-8">No translations yet.</div>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <h2 className="text-lg font-semibold mb-3">Translation History ({segments.length})</h2>
      <div className="space-y-3">
        {[...segments].reverse().map(seg => (
          <div key={seg.id} className={`rounded-lg p-4 border ${
            seg.status === 'completed' || seg.status === 'translated' ? 'bg-gray-750 border-gray-600' :
            seg.status === 'error' ? 'bg-red-900/20 border-red-800' :
            'bg-gray-800 border-gray-700'
          }`}>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">#{seg.segment_index}</span>
                <span className="text-xs text-gray-500">{seg.source_language?.toUpperCase()}</span>
                {seg.asr_provider && <span className="text-xs text-gray-600">ASR: {seg.asr_provider}</span>}
                {seg.model && <span className="text-xs text-gray-500">{seg.model}</span>}
                {seg.translation_provider && <span className="text-xs text-gray-500">via {seg.translation_provider}</span>}
              </div>
              <div className="flex items-center gap-2">
                {seg.latency_asr_ms != null && (
                  <span className="text-xs text-gray-500" title="ASR latency">ASR: {Math.round(seg.latency_asr_ms)}ms</span>
                )}
                {seg.latency_translate_ms != null && (
                  <span className="text-xs text-gray-500" title="Translation latency">API: {Math.round(seg.latency_translate_ms)}ms</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  seg.status === 'completed' || seg.status === 'translated' ? 'bg-green-900 text-green-300' :
                  seg.status === 'error' ? 'bg-red-900 text-red-300' :
                  'bg-yellow-900 text-yellow-300'
                }`}>
                  {seg.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Source</div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{seg.source_text}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Translation</div>
                <div className="text-sm text-white whitespace-pre-wrap font-medium">
                  {seg.translated_text || <span className="text-gray-500 italic">—</span>}
                </div>
              </div>
            </div>

            {seg.error_message && (
              <div className="mt-2 text-xs text-red-300 bg-red-900/30 px-3 py-1.5 rounded">{seg.error_message}</div>
            )}

            <div className="flex justify-between text-xs text-gray-600 mt-2">
              <span>{new Date(seg.created_at).toLocaleString('zh-TW')}</span>
              {seg.start_ms != null && seg.end_ms != null && (
                <span>{Math.floor(seg.start_ms / 1000)}s - {Math.floor(seg.end_ms / 1000)}s</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
