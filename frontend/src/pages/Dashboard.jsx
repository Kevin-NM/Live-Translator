import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getHealth, getProviders, getSessions } from '../api'

export default function Dashboard() {
  const [health, setHealth] = useState(null)
  const [providerCount, setProviderCount] = useState(0)
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    getHealth().then(r => setHealth(r.data)).catch(() => setHealth({ status: 'error' }))
    getProviders().then(r => setProviderCount(r.data.length)).catch(() => {})
    getSessions().then(r => setSessions(r.data)).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-sm text-gray-400 mb-1">API Health</div>
          <div className={`text-2xl font-bold ${health?.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {health?.status === 'ok' ? 'Healthy' : 'Error'}
          </div>
          <div className="text-xs text-gray-500 mt-1">v{health?.version} · {health?.database}</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-sm text-gray-400 mb-1">Providers</div>
          <div className="text-2xl font-bold text-blue-400">{providerCount}</div>
          <Link to="/providers" className="text-xs text-blue-500 hover:underline">Manage →</Link>
        </div>
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-sm text-gray-400 mb-1">Sessions</div>
          <div className="text-2xl font-bold text-purple-400">{sessions.length}</div>
          <Link to="/sessions" className="text-xs text-purple-500 hover:underline">View all →</Link>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">Recent Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-gray-500 text-sm">No sessions yet. <Link to="/sessions" className="text-blue-500 hover:underline">Create one →</Link></p>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 5).map(s => (
              <Link key={s.id} to={`/sessions/${s.id}`} className="block bg-gray-750 hover:bg-gray-700 rounded-lg p-3 border border-gray-600 transition-colors">
                <div className="flex justify-between items-center">
                  <span className="font-medium">{s.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-600 text-gray-300'}`}>
                    {s.status}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                  <span>{s.source_language} → {s.target_language}</span>
                  {s.source_type && s.source_type !== 'manual' && (
                    <span className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">{s.source_type}</span>
                  )}
                  <span>· {new Date(s.created_at).toLocaleString('zh-TW')}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
