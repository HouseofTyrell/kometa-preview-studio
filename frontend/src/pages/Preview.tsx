import { useState, useEffect, useCallback, useMemo } from 'react'
import PreviewTile from '../components/PreviewTile'
import LogPanel from '../components/LogPanel'
import TestOptionsPanel from '../components/TestOptionsPanel'
import {
  startPreview,
  getJobStatus,
  getJobArtifacts,
  subscribeToJobEvents,
  JobStatus,
  JobArtifacts,
  JobEvent,
} from '../api/client'
import { TestOptions, DEFAULT_TEST_OPTIONS } from '../types/testOptions'
import { PREVIEW_TARGETS, filterTargetsByMediaType } from '../constants/previewTargets'

interface PreviewPageProps {
  profileId: string | null
  configYaml: string
  libraryNames?: string[]
  overlayFiles?: string[]
}

function PreviewPage({
  profileId,
  configYaml,
  libraryNames = [],
  overlayFiles = [],
}: PreviewPageProps) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [artifacts, setArtifacts] = useState<JobArtifacts | null>(null)
  const [logs, setLogs] = useState<JobEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [testOptions, setTestOptions] = useState<TestOptions>(DEFAULT_TEST_OPTIONS)

  // Calculate which targets to display based on test options
  const visibleTargets = useMemo(() => {
    // Filter by media types
    let targets = filterTargetsByMediaType(PREVIEW_TARGETS, testOptions.mediaTypes)

    // Filter by selected targets
    if (testOptions.selectedTargets.length > 0) {
      targets = targets.filter((t) => testOptions.selectedTargets.includes(t.id))
    }

    return targets
  }, [testOptions])

  const handleStartPreview = async () => {
    if (!configYaml) {
      setError('Please upload a config first')
      return
    }

    if (visibleTargets.length === 0) {
      setError('Please select at least one target to preview')
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
        testOptions,
      })

      setJobId(result.jobId)
      setLogs([{ type: 'log', timestamp: new Date().toISOString(), message: `Job started: ${result.jobId}` }])

      // Fetch artifacts immediately to show "before" images
      try {
        const initialArtifacts = await getJobArtifacts(result.jobId)
        setArtifacts(initialArtifacts)
      } catch {
        // Artifacts may not be ready yet, polling will pick them up
      }

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

  // Poll for status AND artifacts while running (shows draft images as they appear)
  useEffect(() => {
    if (!jobId || !isRunning) return

    const interval = setInterval(async () => {
      try {
        // Fetch both status and artifacts to show draft images immediately
        const [statusResult, artifactsResult] = await Promise.all([
          getJobStatus(jobId),
          getJobArtifacts(jobId),
        ])
        setStatus(statusResult)
        setArtifacts(artifactsResult)
      } catch (err) {
        console.error('Status/artifacts poll failed:', err)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [jobId, isRunning])

  const hasConfig = !!configYaml

  // Helper to look up artifact URLs for a target
  const getArtifactUrls = useCallback((targetId: string): { beforeUrl?: string; afterUrl?: string; draftUrl?: string } => {
    if (!artifacts?.items) return {}
    const item = artifacts.items.find((i) => i.id === targetId)
    if (!item) return {}
    return {
      beforeUrl: item.beforeUrl || undefined,
      afterUrl: item.afterUrl || undefined,
      draftUrl: item.draftUrl || undefined,
    }
  }, [artifacts])

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

      {/* Test Options Panel */}
      {hasConfig && (
        <TestOptionsPanel
          options={testOptions}
          onChange={setTestOptions}
          libraryNames={libraryNames}
          overlayFiles={overlayFiles}
          disabled={isRunning}
        />
      )}

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
          {visibleTargets.length === 0 ? (
            <div className="no-targets-message">
              No targets selected. Expand "Test Options" above to select targets.
            </div>
          ) : (
            visibleTargets.map((target) => {
              const urls = getArtifactUrls(target.id)
              return (
                <PreviewTile
                  key={target.id}
                  targetId={target.id}
                  label={target.label}
                  type={target.displayType}
                  mediaType={target.type}
                  beforeUrl={urls.beforeUrl}
                  afterUrl={urls.afterUrl}
                  draftUrl={urls.draftUrl}
                  isLoading={isRunning}
                  jobId={jobId}
                />
              )
            })
          )}
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

        .no-targets-message {
          grid-column: 1 / -1;
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
          background-color: var(--bg-secondary);
          border-radius: var(--radius-md);
          border: 1px dashed var(--border-color);
        }
      `}</style>
    </div>
  )
}

function getStatusBadgeType(status: string): string {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'error'
    case 'running':
      return 'info'
    case 'pending':
      return 'warning'
    default:
      return 'warning'
  }
}

export default PreviewPage
