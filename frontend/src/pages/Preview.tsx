import { useState, useEffect, useCallback } from 'react'
import PreviewTile from '../components/PreviewTile'
import LogPanel from '../components/LogPanel'
import {
  startPreview,
  getJobStatus,
  getJobArtifacts,
  subscribeToJobEvents,
  JobStatus,
  JobArtifacts,
  JobEvent,
} from '../api/client'

interface PreviewPageProps {
  profileId: string | null
  configYaml: string
}

const PREVIEW_TARGETS = [
  { id: 'matrix', label: 'The Matrix (1999)', type: 'Movie' },
  { id: 'dune', label: 'Dune (2021)', type: 'Movie' },
  { id: 'breakingbad_series', label: 'Breaking Bad', type: 'Series' },
  { id: 'breakingbad_s01', label: 'Breaking Bad', type: 'Season 1' },
  { id: 'breakingbad_s01e01', label: 'Breaking Bad', type: 'S01E01' },
]

function PreviewPage({ profileId, configYaml }: PreviewPageProps) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [artifacts, setArtifacts] = useState<JobArtifacts | null>(null)
  const [logs, setLogs] = useState<JobEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const handleStartPreview = async () => {
    if (!configYaml) {
      setError('Please upload a config first')
      return
    }

    setError(null)
    setLogs([])
    setArtifacts(null)
    setIsRunning(true)

    try {
      const result = await startPreview({
        profileId: profileId || undefined,
        configYaml: profileId ? undefined : configYaml,
      })

      setJobId(result.jobId)
      setLogs([{ type: 'log', timestamp: new Date().toISOString(), message: `Job started: ${result.jobId}` }])

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start preview')
      setIsRunning(false)
    }
  }

  // Subscribe to job events
  useEffect(() => {
    if (!jobId) return

    const unsubscribe = subscribeToJobEvents(
      jobId,
      (event) => {
        setLogs((prev) => [...prev, event])

        if (event.type === 'progress' && event.progress !== undefined) {
          setStatus((prev) => prev ? { ...prev, progress: event.progress! } : null)
        }

        if (event.type === 'complete' || event.type === 'error') {
          setIsRunning(false)
          // Fetch final status and artifacts
          fetchStatusAndArtifacts(jobId)
        }
      },
      (err) => {
        setError(err.message)
        setIsRunning(false)
      }
    )

    return unsubscribe
  }, [jobId])

  const fetchStatusAndArtifacts = useCallback(async (id: string) => {
    try {
      const [statusResult, artifactsResult] = await Promise.all([
        getJobStatus(id),
        getJobArtifacts(id),
      ])
      setStatus(statusResult)
      setArtifacts(artifactsResult)
    } catch (err) {
      console.error('Failed to fetch status/artifacts:', err)
    }
  }, [])

  // Poll for status while running
  useEffect(() => {
    if (!jobId || !isRunning) return

    const interval = setInterval(async () => {
      try {
        const statusResult = await getJobStatus(jobId)
        setStatus(statusResult)
      } catch (err) {
        console.error('Status poll failed:', err)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [jobId, isRunning])

  const hasConfig = !!configYaml

  return (
    <div className="page preview-page">
      <div className="preview-header">
        <div>
          <h1 className="page-title">Preview</h1>
          <p className="page-description">
            Render Kometa overlays on the 5 static preview items
          </p>
        </div>

        <div className="preview-actions">
          <button
            className="btn btn-primary"
            onClick={handleStartPreview}
            disabled={!hasConfig || isRunning}
          >
            {isRunning ? 'Running...' : 'Run Preview'}
          </button>
        </div>
      </div>

      {!hasConfig && (
        <div className="alert alert-warning">
          Please upload a Kometa config.yml on the Config page before running a preview.
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {status && (
        <div className="status-bar">
          <div className="status-info">
            <span className={`badge badge-${getStatusBadgeType(status.status)}`}>
              {status.status}
            </span>
            <span className="text-sm text-muted">
              Job: {status.jobId}
            </span>
          </div>
          <div className="progress-bar" style={{ width: '200px' }}>
            <div
              className="progress-fill"
              style={{ width: `${status.progress}%` }}
            />
          </div>
          <span className="text-sm">{status.progress}%</span>
        </div>
      )}

      {status?.warnings && status.warnings.length > 0 && (
        <div className="warnings-section">
          <h3 className="text-sm mb-1">Warnings</h3>
          {status.warnings.map((warning, index) => (
            <div key={index} className="alert alert-warning">
              {warning}
            </div>
          ))}
        </div>
      )}

      <div className="preview-content">
        <div className="preview-grid">
          {PREVIEW_TARGETS.map((target) => (
            <PreviewTile
              key={target.id}
              targetId={target.id}
              label={target.label}
              type={target.type}
              beforeUrl={artifacts?.before[target.id]}
              afterUrl={artifacts?.after[target.id]}
              isLoading={isRunning}
              jobId={jobId}
            />
          ))}
        </div>

        <LogPanel logs={logs} />
      </div>

      <style>{`
        .preview-page {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .preview-actions {
          display: flex;
          gap: 1rem;
        }

        .status-bar {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem 1rem;
          background-color: var(--bg-secondary);
          border-radius: var(--radius-sm);
        }

        .status-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .warnings-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .preview-content {
          display: grid;
          grid-template-columns: 1fr 350px;
          gap: 1.5rem;
        }

        @media (max-width: 1200px) {
          .preview-content {
            grid-template-columns: 1fr;
          }
        }

        .preview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.5rem;
        }
      `}</style>
    </div>
  )
}

function getStatusBadgeType(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'error'
    case 'running':
    case 'rendering':
      return 'info'
    default:
      return 'warning'
  }
}

export default PreviewPage
