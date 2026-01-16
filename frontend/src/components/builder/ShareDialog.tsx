import { useState } from 'react'
import { createShare, exportToGist, type ShareConfig, type ShareMetadata } from '../../api/client'
import './ShareDialog.css'

interface ShareDialogProps {
  config: ShareConfig
  onClose: () => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

function ShareDialog({ config, onClose, onSuccess, onError }: ShareDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [gistUrl, setGistUrl] = useState<string | null>(null)
  const [isCreatingShare, setIsCreatingShare] = useState(false)
  const [isCreatingGist, setIsCreatingGist] = useState(false)

  const handleCreateShare = async () => {
    try {
      setIsCreatingShare(true)
      const metadata: ShareMetadata = {
        title: title || 'Overlay Configuration',
        description,
        author,
      }

      const result = await createShare(config, metadata)
      const fullUrl = `${window.location.origin}/share/${result.shareId}`
      setShareUrl(fullUrl)
      onSuccess('Shareable link created successfully!')
    } catch (error) {
      onError(`Failed to create share: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsCreatingShare(false)
    }
  }

  const handleCreateGist = async () => {
    try {
      setIsCreatingGist(true)
      const metadata: ShareMetadata = {
        title: title || 'Overlay Configuration',
        description,
        author,
      }

      const result = await exportToGist(config, metadata, githubToken || undefined)
      setGistUrl(result.gistUrl)
      onSuccess('GitHub Gist created successfully!')
    } catch (error) {
      onError(`Failed to create gist: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsCreatingGist(false)
    }
  }

  const handleCopyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onSuccess('Link copied to clipboard!')
    } catch (error) {
      onError('Failed to copy to clipboard')
    }
  }

  return (
    <div className="share-dialog-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-header">
          <h3>Share Configuration</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="share-dialog-content">
          <div className="form-section">
            <h4>Configuration Details</h4>
            <div className="form-group">
              <label htmlFor="title">Title (optional)</label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., My Awesome Overlay Setup"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="description">Description (optional)</label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your overlay configuration..."
                className="form-textarea"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="author">Author (optional)</label>
              <input
                id="author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name or username"
                className="form-input"
              />
            </div>
          </div>

          <div className="share-options">
            <div className="share-option">
              <div className="option-header">
                <h4>🔗 Shareable Link</h4>
                <p>Create a link that others can use to import your configuration</p>
              </div>
              <button
                className="share-button primary"
                onClick={handleCreateShare}
                disabled={isCreatingShare}
              >
                {isCreatingShare ? 'Creating...' : 'Generate Link'}
              </button>
              {shareUrl && (
                <div className="share-result">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="share-url-input"
                  />
                  <button
                    className="copy-button"
                    onClick={() => handleCopyToClipboard(shareUrl)}
                  >
                    📋 Copy
                  </button>
                </div>
              )}
            </div>

            <div className="share-option">
              <div className="option-header">
                <h4>💾 GitHub Gist</h4>
                <p>Export to a public GitHub Gist for easy version control</p>
              </div>

              <div className="form-group">
                <label htmlFor="githubToken">GitHub Token (optional)</label>
                <input
                  id="githubToken"
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_..."
                  className="form-input"
                />
                <small className="form-hint">
                  Without a token, gists are created anonymously
                </small>
              </div>

              <button
                className="share-button secondary"
                onClick={handleCreateGist}
                disabled={isCreatingGist}
              >
                {isCreatingGist ? 'Creating...' : 'Create Gist'}
              </button>
              {gistUrl && (
                <div className="share-result">
                  <a
                    href={gistUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gist-link"
                  >
                    View Gist on GitHub →
                  </a>
                  <button
                    className="copy-button"
                    onClick={() => handleCopyToClipboard(gistUrl)}
                  >
                    📋 Copy URL
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="share-dialog-footer">
          <button className="action-button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ShareDialog
