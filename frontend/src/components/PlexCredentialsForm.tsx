import { useState } from 'react'
import { createFromCredentials, ConfigAnalysis } from '../api/client'
import './PlexCredentialsForm.css'

interface PlexCredentialsFormProps {
  onSuccess: (analysis: ConfigAnalysis, configYaml: string) => void
  onCancel: () => void
}

function PlexCredentialsForm({ onSuccess, onCancel }: PlexCredentialsFormProps) {
  const [plexUrl, setPlexUrl] = useState('')
  const [plexToken, setPlexToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!plexUrl.trim()) {
      setError('Plex URL is required')
      return
    }
    if (!plexToken.trim()) {
      setError('Plex token is required')
      return
    }

    // Validate URL format
    try {
      new URL(plexUrl)
    } catch {
      setError('Invalid URL format. Example: http://192.168.1.100:32400')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await createFromCredentials(plexUrl.trim(), plexToken.trim())
      onSuccess(result.analysis, result.configYaml)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create config')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="card plex-credentials-form">
      <h2 className="card-title">Start from Scratch</h2>
      <p className="form-description">
        Enter your Plex server details to start creating overlays from scratch.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="plex-url">
            Plex URL
          </label>
          <input
            id="plex-url"
            type="text"
            className="form-input"
            value={plexUrl}
            onChange={(e) => setPlexUrl(e.target.value)}
            placeholder="http://192.168.1.100:32400"
            disabled={isLoading}
          />
          <span className="form-hint">
            Your Plex server address (e.g., http://localhost:32400 or https://plex.example.com)
          </span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="plex-token">
            Plex Token
          </label>
          <input
            id="plex-token"
            type="password"
            className="form-input"
            value={plexToken}
            onChange={(e) => setPlexToken(e.target.value)}
            placeholder="Enter your Plex token"
            disabled={isLoading}
          />
          <span className="form-hint">
            <a
              href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
              target="_blank"
              rel="noopener noreferrer"
              className="hint-link"
            >
              How to find your Plex token
            </a>
          </span>
        </div>

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isLoading}
          >
            Back
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !plexUrl.trim() || !plexToken.trim()}
          >
            {isLoading ? 'Creating...' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default PlexCredentialsForm
