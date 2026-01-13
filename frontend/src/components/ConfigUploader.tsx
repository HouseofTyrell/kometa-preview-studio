import { useState, useRef, useEffect } from 'react'
import { uploadConfig, ConfigAnalysis } from '../api/client'

interface ConfigUploaderProps {
  onConfigUploaded: (analysis: ConfigAnalysis, configYaml: string) => void
  initialConfig?: string
}

function ConfigUploader({ onConfigUploaded, initialConfig = '' }: ConfigUploaderProps) {
  const [configYaml, setConfigYaml] = useState(initialConfig)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (initialConfig) {
      setConfigYaml(initialConfig)
    }
  }, [initialConfig])

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      setConfigYaml(text)
      await submitConfig(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    }
  }

  const handlePaste = async () => {
    if (!configYaml.trim()) {
      setError('Please enter or paste a config')
      return
    }
    await submitConfig(configYaml)
  }

  const submitConfig = async (yaml: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const analysis = await uploadConfig(yaml)
      onConfigUploaded(analysis, yaml)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse config')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return

    try {
      const text = await file.text()
      setConfigYaml(text)
      await submitConfig(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    }
  }

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
  }

  return (
    <div className="card config-uploader">
      <h2 className="card-title">Upload Config</h2>

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".yml,.yaml"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <div className="drop-zone-content">
          <span className="drop-icon">📁</span>
          <span>Drop config.yml here or click to browse</span>
        </div>
      </div>

      <div className="divider">
        <span>or paste below</span>
      </div>

      <div className="form-group">
        <textarea
          className="form-textarea"
          value={configYaml}
          onChange={(e) => setConfigYaml(e.target.value)}
          placeholder="Paste your Kometa config.yml here..."
          rows={15}
        />
      </div>

      {error && (
        <div className="alert alert-error mt-2">
          {error}
        </div>
      )}

      <div className="mt-2">
        <button
          className="btn btn-primary"
          onClick={handlePaste}
          disabled={isLoading || !configYaml.trim()}
        >
          {isLoading ? 'Parsing...' : 'Parse Config'}
        </button>
      </div>

      <style>{`
        .config-uploader {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .drop-zone {
          border: 2px dashed var(--border-color);
          border-radius: var(--radius-md);
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .drop-zone:hover {
          border-color: var(--accent-primary);
          background-color: rgba(229, 160, 13, 0.05);
        }

        .drop-zone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-secondary);
        }

        .drop-icon {
          font-size: 2rem;
        }

        .divider {
          display: flex;
          align-items: center;
          gap: 1rem;
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background-color: var(--border-color);
        }
      `}</style>
    </div>
  )
}

export default ConfigUploader
