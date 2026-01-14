import { useState } from 'react'
import ConfigUploader from '../components/ConfigUploader'
import PlexCredentialsForm from '../components/PlexCredentialsForm'
import OverlayEditor from '../components/OverlayEditor'
import { ConfigAnalysis, runSystemAction, SystemAction, SystemActionResult } from '../api/client'
import './Config.css'

type EntryMode = 'choice' | 'import' | 'scratch'

interface ConfigPageProps {
  currentConfig: string
  onConfigUpdate: (
    profileId: string,
    configYaml: string,
    libraryNames?: string[],
    overlayFiles?: string[]
  ) => void
}

function ConfigPage({ currentConfig, onConfigUpdate }: ConfigPageProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>(currentConfig ? 'import' : 'choice')
  const [analysis, setAnalysis] = useState<ConfigAnalysis | null>(null)
  const [configYaml, setConfigYaml] = useState(currentConfig)
  const [systemAction, setSystemAction] = useState<SystemAction | null>(null)
  const [systemResult, setSystemResult] = useState<SystemActionResult | null>(null)
  const [systemError, setSystemError] = useState<string | null>(null)

  const handleConfigUploaded = (newAnalysis: ConfigAnalysis, yaml: string) => {
    setAnalysis(newAnalysis)
    setConfigYaml(yaml)
    setEntryMode('import')
    onConfigUpdate(
      newAnalysis.profileId,
      yaml,
      newAnalysis.libraryNames,
      newAnalysis.overlayFiles
    )
  }

  const handleScratchSuccess = (newAnalysis: ConfigAnalysis, yaml: string) => {
    setAnalysis(newAnalysis)
    setConfigYaml(yaml)
    setEntryMode('scratch')
    onConfigUpdate(
      newAnalysis.profileId,
      yaml,
      newAnalysis.libraryNames,
      newAnalysis.overlayFiles
    )
  }

  const handleConfigEdit = (yaml: string) => {
    setConfigYaml(yaml)
    if (analysis) {
      onConfigUpdate(
        analysis.profileId,
        yaml,
        analysis.libraryNames,
        analysis.overlayFiles
      )
    }
  }

  const handleReset = () => {
    setEntryMode('choice')
    setAnalysis(null)
    setConfigYaml('')
  }

  const triggerSystemAction = async (action: SystemAction) => {
    setSystemAction(action)
    setSystemResult(null)
    setSystemError(null)
    try {
      const result = await runSystemAction(action)
      setSystemResult(result)
    } catch (err) {
      setSystemError(err instanceof Error ? err.message : 'Failed to run system action')
    } finally {
      setSystemAction(null)
    }
  }

  // Show entry mode choice if no config loaded yet
  if (entryMode === 'choice') {
    return (
      <div className="page">
        <div>
          <h1 className="page-title">Get Started</h1>
          <p className="page-description">
            Choose how you want to start working with overlay configurations
          </p>
        </div>

        <div className="entry-choice-grid">
          <button
            type="button"
            className="entry-choice-card"
            onClick={() => setEntryMode('import')}
          >
            <span className="choice-icon">📁</span>
            <h3 className="choice-title">Import Existing Config</h3>
            <p className="choice-description">
              Upload or paste an existing Kometa config.yml file to edit and preview overlays
            </p>
          </button>

          <button
            type="button"
            className="entry-choice-card"
            onClick={() => setEntryMode('scratch')}
          >
            <span className="choice-icon">✨</span>
            <h3 className="choice-title">Start from Scratch</h3>
            <p className="choice-description">
              Enter your Plex credentials and create new overlays using the visual editor
            </p>
          </button>
        </div>
      </div>
    )
  }

  // Show scratch form (Plex credentials entry)
  if (entryMode === 'scratch' && !analysis) {
    return (
      <div className="page">
        <div>
          <h1 className="page-title">Start from Scratch</h1>
          <p className="page-description">
            Connect to your Plex server to get started
          </p>
        </div>

        <div className="config-layout">
          <div className="config-main">
            <PlexCredentialsForm
              onSuccess={handleScratchSuccess}
              onCancel={() => setEntryMode('choice')}
            />
          </div>
          <div className="config-sidebar">
            <div className="card">
              <h2 className="card-title">What you'll need</h2>
              <ul className="requirements-list">
                <li>Your Plex server URL</li>
                <li>Your Plex authentication token</li>
              </ul>
              <p className="text-muted text-sm mt-2">
                Don't worry, your credentials are only used to connect to your server
                and are not stored externally.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Configuration</h1>
          <p className="page-description">
            {analysis
              ? 'Edit your overlay configuration and preview changes'
              : 'Upload or paste your Kometa config.yml to get started'}
          </p>
        </div>
        {analysis && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
            Start Over
          </button>
        )}
      </div>

      <div className="config-layout">
        <div className="config-main">
          {!analysis && entryMode === 'import' && (
            <>
              <ConfigUploader
                onConfigUploaded={handleConfigUploaded}
                initialConfig={configYaml}
              />
              <button
                type="button"
                className="btn btn-secondary mt-2"
                onClick={() => setEntryMode('choice')}
              >
                Back to Options
              </button>
            </>
          )}

          {analysis && (
            <div className="card">
              <h2 className="card-title">Config Analysis</h2>

              <div className="flex flex-col gap-2">
                <div className="config-item">
                  <span className="config-label">Plex URL:</span>
                  <span className="config-value">
                    {analysis.plexUrl || <span className="text-warning">Not found</span>}
                  </span>
                </div>

                <div className="config-item">
                  <span className="config-label">Token:</span>
                  <span className="config-value">
                    {analysis.tokenPresent ? (
                      <span className="text-success">Present</span>
                    ) : (
                      <span className="text-error">Missing</span>
                    )}
                  </span>
                </div>

                <div className="config-item">
                  <span className="config-label">Libraries:</span>
                  <span className="config-value">
                    {analysis.libraryNames.length > 0
                      ? analysis.libraryNames.join(', ')
                      : <span className="text-muted">None found</span>
                    }
                  </span>
                </div>

                <div className="config-item">
                  <span className="config-label">Asset Directories:</span>
                  <span className="config-value">
                    {analysis.assetDirectories.length > 0
                      ? analysis.assetDirectories.length
                      : <span className="text-muted">None</span>
                    }
                  </span>
                </div>

                <div className="config-item">
                  <span className="config-label">Overlay Files:</span>
                  <span className="config-value">
                    {analysis.overlayFiles.length > 0
                      ? analysis.overlayFiles.length
                      : <span className="text-muted">None found</span>
                    }
                  </span>
                </div>

                {analysis.warnings.length > 0 && (
                  <div className="mt-2">
                    <h3 className="text-sm mb-1">Warnings</h3>
                    <div className="warnings-list">
                      {analysis.warnings.map((warning, index) => (
                        <div key={index} className="alert alert-warning">
                          {warning}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {analysis && (
            <OverlayEditor
              overlayYaml={analysis.overlayYaml}
              onEdit={handleConfigEdit}
              fullConfig={configYaml}
            />
          )}
        </div>

        <div className="config-sidebar">
          <div className="card">
            <h2 className="card-title">System Controls</h2>
            <p className="text-muted text-sm">
              Control Docker services directly from the UI.
            </p>

            <div className="system-controls">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => triggerSystemAction('start')}
                disabled={systemAction !== null}
              >
                {systemAction === 'start' ? 'Starting…' : 'Start'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => triggerSystemAction('stop')}
                disabled={systemAction !== null}
              >
                {systemAction === 'stop' ? 'Stopping…' : 'Stop'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => triggerSystemAction('reset')}
                disabled={systemAction !== null}
              >
                {systemAction === 'reset' ? 'Resetting…' : 'Reset'}
              </button>
            </div>

            {systemError && (
              <div className="alert alert-error mt-2">
                {systemError}
              </div>
            )}

            {systemResult && (
              <div className="system-result">
                <div className="system-result-header">
                  <span className="system-result-title">
                    {systemResult.action.toUpperCase()} result
                  </span>
                  <span
                    className={`system-result-status ${
                      systemResult.status === 'success' ? 'text-success' : 'text-error'
                    }`}
                  >
                    {systemResult.status}
                  </span>
                </div>
                <div className="system-result-meta">
                  <span>Exit code: {systemResult.exitCode ?? 'unknown'}</span>
                  <span>Started: {new Date(systemResult.startedAt).toLocaleString()}</span>
                </div>
                {(systemResult.stdout || systemResult.stderr) && (
                  <pre className="system-log">
                    {systemResult.stdout}
                    {systemResult.stderr && `\n${systemResult.stderr}`}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConfigPage
