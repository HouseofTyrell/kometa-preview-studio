import { useState } from 'react'
import ConfigUploader from '../components/ConfigUploader'
import OverlayEditor from '../components/OverlayEditor'
import { ConfigAnalysis } from '../api/client'

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

  return (
    <div className="page">
      <div>
        <h1 className="page-title">Configuration</h1>
        <p className="page-description">
          Upload or paste your Kometa config.yml to get started
        </p>
      </div>

      <div className="grid grid-2">
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
      </div>

      {analysis && (
        <OverlayEditor
          overlayYaml={analysis.overlayYaml}
          onEdit={handleConfigEdit}
          fullConfig={configYaml}
        />
      )}

      <style>{`
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
      `}</style>
    </div>
  )
}

export default ConfigPage
