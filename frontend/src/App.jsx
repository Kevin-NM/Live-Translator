import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { I18nProvider, useI18n } from './i18n'
import Dashboard from './pages/Dashboard'
import Providers from './pages/Providers'
import Sessions from './pages/Sessions'
import SessionDetail from './pages/SessionDetail'
import Settings from './pages/Settings'

function NavBar() {
  const { lang, setLang, t } = useI18n()

  const navLinkClass = ({ isActive }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
    }`

  return (
    <nav className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center gap-4">
      <span className="text-xl font-bold text-blue-400 mr-6">Live Translator</span>
      <NavLink to="/" className={navLinkClass} end>{t('nav.dashboard')}</NavLink>
      <NavLink to="/providers" className={navLinkClass}>{t('nav.providers')}</NavLink>
      <NavLink to="/sessions" className={navLinkClass}>{t('nav.sessions')}</NavLink>
      <NavLink to="/settings" className={navLinkClass}>{t('nav.settings')}</NavLink>
      <div className="ml-auto">
        <select value={lang} onChange={e => setLang(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500">
          <option value="zh-TW">繁體中文</option>
          <option value="en-US">English</option>
        </select>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-900 text-gray-100">
          <NavBar />
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
    </I18nProvider>
  )
}
