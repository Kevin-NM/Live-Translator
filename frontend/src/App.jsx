import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Providers from './pages/Providers'
import Sessions from './pages/Sessions'
import SessionDetail from './pages/SessionDetail'
import Settings from './pages/Settings'

const navLinkClass = ({ isActive }) =>
  `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
  }`

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <nav className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center gap-4">
          <span className="text-xl font-bold text-blue-400 mr-6">Live Translator</span>
          <NavLink to="/" className={navLinkClass} end>Dashboard</NavLink>
          <NavLink to="/providers" className={navLinkClass}>Providers</NavLink>
          <NavLink to="/sessions" className={navLinkClass}>Sessions</NavLink>
          <NavLink to="/settings" className={navLinkClass}>Settings</NavLink>
        </nav>
        <main className="max-w-7xl mx-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
