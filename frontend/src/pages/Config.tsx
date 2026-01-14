import { useState } from 'react'
import ConfigUploader from '../components/ConfigUploader'
import OverlayEditor from '../components/OverlayEditor'
import { ConfigAnalysis, runSystemAction, SystemAction, SystemActionResult } from '../api/client'

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
  const [analysis, setAnalysis] = useState<ConfigAnalysis | null>(null)
  const [configYaml, setConfigYaml] = useState(currentConfig)
  const [systemAction, setSystemAction] = useState<SystemAction | null>(null)
  const [systemResult, setSystemResult] = useState<SystemActionResult | null>(null)
  const [systemError, setSystemError] = useState<string | null>(null)

  const handleConfigUploaded = (newAnalysis: ConfigAnalysis, yaml: string) => {
    setAnalysis(newAnalysis)
    setConfigYaml(yaml)
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

  return (
    <div className="page">
      <div>
        <h1 className="page-title">Configuration</h1>
        <p className="page-description">
          Upload or paste your Kometa config.yml to get started
        </p>
      </div>

      <div className="config-layout">
        <div className="config-main">
          <ConfigUploader
            onConfigUploaded={handleConfigUploaded}
            initialConfig={configYaml}
          />

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
                className="btn btn-primary"
                onClick={() => triggerSystemAction('start')}
                disabled={systemAction !== null}
              >
                {systemAction === 'start' ? 'Starting…' : 'Start'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => triggerSystemAction('stop')}
                disabled={systemAction !== null}
              >
                {systemAction === 'stop' ? 'Stopping…' : 'Stop'}
              </button>
              <button
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

      <style>{`
        .config-layout {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 1.5rem;
          align-items: start;
        }

        @media (max-width: 1024px) {
          .config-layout {
            grid-template-columns: 1fr;
          }

          .config-sidebar {
            order: -1;
          }
        }

        .config-main {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .config-sidebar {
          position: sticky;
          top: 1rem;
        }

        .config-item {
          display: flex;
          gap: 0.5rem;
          font-size: 0.875rem;
        }

        .config-label {
          color: var(--text-secondary);
          min-width: 120px;
        }

        .config-value {
          color: var(--text-primary);
        }

        .warnings-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .system-controls {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .system-controls .btn {
          width: 100%;
          justify-content: center;
        }

        .system-result {
          margin-top: 1rem;
          padding: 0.75rem;
          border-radius: var(--radius-sm);
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
        }

        .system-result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          font-size: 0.85rem;
          margin-bottom: 0.5rem;
        }

        .system-result-meta {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
        }

        .system-log {
          white-space: pre-wrap;
          background: var(--bg-primary);
          border-radius: var(--radius-sm);
          padding: 0.75rem;
          max-height: 180px;
          overflow-y: auto;
          font-size: 0.7rem;
          color: var(--text-secondary);
        }

        .text-sm {
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  )
}

export default ConfigPage
