import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import ConfigPage from './pages/Config'
import PreviewPage from './pages/Preview'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './context/ThemeContext'
import ThemeToggle from './components/ThemeToggle'

interface AppState {
  profileId: string | null
  configYaml: string
  libraryNames: string[]
  overlayFiles: string[]
}

function NavHeader() {
  const location = useLocation()

  return (
    <header className="app-header">
      <div className="header-content">
        <h1 className="app-title">Kometa Preview Studio</h1>
        <div className="header-actions">
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
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

function App() {
  const [appState, setAppState] = useState<AppState>({
    profileId: null,
    configYaml: '',
    libraryNames: [],
    overlayFiles: [],
  })

  const updateConfig = (
    profileId: string,
    configYaml: string,
    libraryNames: string[] = [],
    overlayFiles: string[] = []
  ) => {
    setAppState({ profileId, configYaml, libraryNames, overlayFiles })
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        <div className="app">
          <NavHeader />
          <main className="app-main">
            <ErrorBoundary>
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
                      libraryNames={appState.libraryNames}
                      overlayFiles={appState.overlayFiles}
                    />
                  }
                />
                <Route path="/" element={<Navigate to="/config" replace />} />
              </Routes>
            </ErrorBoundary>
          </main>
          <footer className="app-footer">
            <p>
              Preview is offline-only. No changes are made to your Plex server.
            </p>
          </footer>
        </div>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
