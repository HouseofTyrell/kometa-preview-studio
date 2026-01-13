import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import ConfigPage from './pages/Config'
import PreviewPage from './pages/Preview'

interface AppState {
  profileId: string | null
  configYaml: string
}

function NavHeader() {
  const location = useLocation()

  return (
    <header className="app-header">
      <div className="header-content">
        <h1 className="app-title">Kometa Preview Studio</h1>
        <nav className="nav-links">
          <Link
            to="/config"
            className={`nav-link ${location.pathname === '/config' ? 'active' : ''}`}
          >
            Config
          </Link>
          <Link
            to="/preview"
            className={`nav-link ${location.pathname === '/preview' ? 'active' : ''}`}
          >
            Preview
          </Link>
        </nav>
      </div>
    </header>
  )
}

function App() {
  const [appState, setAppState] = useState<AppState>({
    profileId: null,
    configYaml: '',
  })

  const updateConfig = (profileId: string, configYaml: string) => {
    setAppState({ profileId, configYaml })
  }

  return (
    <BrowserRouter>
      <div className="app">
        <NavHeader />
        <main className="app-main">
          <Routes>
            <Route
              path="/config"
              element={
                <ConfigPage
                  currentConfig={appState.configYaml}
                  onConfigUpdate={updateConfig}
                />
              }
            />
            <Route
              path="/preview"
              element={
                <PreviewPage
                  profileId={appState.profileId}
                  configYaml={appState.configYaml}
                />
              }
            />
            <Route path="/" element={<Navigate to="/config" replace />} />
          </Routes>
        </main>
        <footer className="app-footer">
          <p>
            Preview is offline-only. No changes are made to your Plex server.
          </p>
        </footer>
      </div>
    </BrowserRouter>
  )
}

export default App
