import { useReducer, useEffect, useCallback, useMemo } from 'react'
import PreviewTile from '../components/PreviewTile'
import LogPanel from '../components/LogPanel'
import TestOptionsPanel from '../components/TestOptionsPanel'
import {
  startPreview,
  getJobStatus,
  getJobArtifacts,
  subscribeToJobEvents,
  getActiveJob,
  pauseJob,
  resumeJob,
  cancelJob,
  forceDeleteJob,
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

// State shape for the preview page
interface PreviewState {
  jobId: string | null
  status: JobStatus | null
  artifacts: JobArtifacts | null
  logs: JobEvent[]
  error: string | null
  isRunning: boolean
  isPaused: boolean
  testOptions: TestOptions
  reconnecting: boolean
}

// Action types for state transitions
type PreviewAction =
  | { type: 'START_PREVIEW' }
  | { type: 'SET_JOB_ID'; jobId: string }
  | { type: 'SET_STATUS'; status: JobStatus | null }
  | { type: 'SET_ARTIFACTS'; artifacts: JobArtifacts | null }
  | { type: 'ADD_LOG'; event: JobEvent }
  | { type: 'SET_LOGS'; logs: JobEvent[] }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'JOB_PAUSED' }
  | { type: 'JOB_RESUMED' }
  | { type: 'JOB_STOPPED' }
  | { type: 'JOB_COMPLETED' }
  | { type: 'JOB_FAILED'; error?: string }
  | { type: 'SET_TEST_OPTIONS'; options: TestOptions }
  | { type: 'SET_RECONNECTING'; reconnecting: boolean }
  | { type: 'RECONNECT_TO_JOB'; jobId: string; status: 'running' | 'paused' }
  | { type: 'UPDATE_STATUS_AND_ARTIFACTS'; status: JobStatus; artifacts: JobArtifacts | null }

// Initial state
const initialState: PreviewState = {
  jobId: null,
  status: null,
  artifacts: null,
  logs: [],
  error: null,
  isRunning: false,
  isPaused: false,
  testOptions: DEFAULT_TEST_OPTIONS,
  reconnecting: false,
}

// Reducer function handles all state transitions
function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'START_PREVIEW':
      return {
        ...state,
        error: null,
        logs: [],
        artifacts: null,
        isRunning: true,
        isPaused: false,
      }

    case 'SET_JOB_ID':
      return {
        ...state,
        jobId: action.jobId,
        logs: [{ type: 'log', timestamp: new Date().toISOString(), message: `Job started: ${action.jobId}` }],
      }

    case 'SET_STATUS':
      return { ...state, status: action.status }

    case 'SET_ARTIFACTS':
      return { ...state, artifacts: action.artifacts }

    case 'ADD_LOG':
      return { ...state, logs: [...state.logs, action.event] }

    case 'SET_LOGS':
      return { ...state, logs: action.logs }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
        isRunning: action.error ? false : state.isRunning,
      }

    case 'JOB_PAUSED':
      return {
        ...state,
        isPaused: true,
        logs: [...state.logs, { type: 'log', timestamp: new Date().toISOString(), message: 'Job paused' }],
      }

    case 'JOB_RESUMED':
      return {
        ...state,
        isPaused: false,
        logs: [...state.logs, { type: 'log', timestamp: new Date().toISOString(), message: 'Job resumed' }],
      }

    case 'JOB_STOPPED':
      return {
        ...state,
        isRunning: false,
        isPaused: false,
        logs: [...state.logs, { type: 'log', timestamp: new Date().toISOString(), message: 'Job stopped' }],
      }

    case 'JOB_COMPLETED':
      return {
        ...state,
        isRunning: false,
        isPaused: false,
      }

    case 'JOB_FAILED':
      return {
        ...state,
        isRunning: false,
        isPaused: false,
        error: action.error || state.error,
      }

    case 'SET_TEST_OPTIONS':
      return { ...state, testOptions: action.options }

    case 'SET_RECONNECTING':
      return { ...state, reconnecting: action.reconnecting }

    case 'RECONNECT_TO_JOB':
      return {
        ...state,
        jobId: action.jobId,
        isRunning: action.status === 'running',
        isPaused: action.status === 'paused',
        logs: [{ type: 'log', timestamp: new Date().toISOString(), message: `Reconnected to job: ${action.jobId}` }],
      }

    case 'UPDATE_STATUS_AND_ARTIFACTS':
      return {
        ...state,
        status: action.status,
        artifacts: action.artifacts,
      }

    default:
      return state
  }
}

function PreviewPage({
  profileId,
  configYaml,
  libraryNames = [],
  overlayFiles = [],
}: PreviewPageProps) {
  const [state, dispatch] = useReducer(previewReducer, initialState)

  const { jobId, status, artifacts, logs, error, isRunning, isPaused, testOptions, reconnecting } = state

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
      dispatch({ type: 'SET_ERROR', error: 'Please upload a config first' })
      return
    }

    if (visibleTargets.length === 0) {
      dispatch({ type: 'SET_ERROR', error: 'Please select at least one target to preview' })
      return
    }

    dispatch({ type: 'START_PREVIEW' })

    try {
      const result = await startPreview({
        profileId: profileId || undefined,
        configYaml: profileId ? undefined : configYaml,
        testOptions,
      })

      dispatch({ type: 'SET_JOB_ID', jobId: result.jobId })

      // Fetch artifacts immediately to show "before" images
      try {
        const initialArtifacts = await getJobArtifacts(result.jobId)
        dispatch({ type: 'SET_ARTIFACTS', artifacts: initialArtifacts })
      } catch {
        // Artifacts may not be ready yet, polling will pick them up
      }

    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Failed to start preview' })
    }
  }

  const handlePause = async () => {
    if (!jobId) return
    try {
      await pauseJob(jobId)
      dispatch({ type: 'JOB_PAUSED' })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Failed to pause job' })
    }
  }

  const handleResume = async () => {
    if (!jobId) return
    try {
      await resumeJob(jobId)
      dispatch({ type: 'JOB_RESUMED' })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Failed to resume job' })
    }
  }

  const handleStop = async () => {
    if (!jobId) return
    try {
      await cancelJob(jobId)
      dispatch({ type: 'JOB_STOPPED' })
      // Fetch final status
      const statusResult = await getJobStatus(jobId)
      dispatch({ type: 'SET_STATUS', status: statusResult })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Failed to stop job' })
    }
  }

  const handleForceStop = async () => {
    if (!jobId) return
    if (!confirm('Force stop will immediately terminate this job. Use this only if normal stop doesn\'t work. Continue?')) {
      return
    }
    try {
      await forceDeleteJob(jobId)
      dispatch({ type: 'JOB_STOPPED' })
      // Fetch final status
      const statusResult = await getJobStatus(jobId)
      dispatch({ type: 'SET_STATUS', status: statusResult })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Failed to force stop job' })
    }
  }

  const handleTestOptionsChange = useCallback((options: TestOptions) => {
    dispatch({ type: 'SET_TEST_OPTIONS', options })
  }, [])

  // Check for active job on mount (allows frontend to reconnect to running jobs)
  useEffect(() => {
    const checkActiveJob = async () => {
      try {
        dispatch({ type: 'SET_RECONNECTING', reconnecting: true })
        const result = await getActiveJob()
        if (result.hasActiveJob && result.job) {
          const jobStatus = result.job.status as 'running' | 'paused'
          dispatch({ type: 'RECONNECT_TO_JOB', jobId: result.job.jobId, status: jobStatus })

          // Fetch current status and artifacts
          const [statusResult, artifactsResult] = await Promise.all([
            getJobStatus(result.job.jobId),
            getJobArtifacts(result.job.jobId),
          ])
          dispatch({ type: 'UPDATE_STATUS_AND_ARTIFACTS', status: statusResult, artifacts: artifactsResult })
        }
      } catch (err) {
        console.error('Failed to check for active job:', err)
      } finally {
        dispatch({ type: 'SET_RECONNECTING', reconnecting: false })
      }
    }

    checkActiveJob()
  }, [])

  // Subscribe to job events
  useEffect(() => {
    if (!jobId) return

    const unsubscribe = subscribeToJobEvents(
      jobId,
      (event) => {
        dispatch({ type: 'ADD_LOG', event })

        if (event.type === 'progress' && event.progress !== undefined) {
          dispatch({ type: 'SET_STATUS', status: status ? { ...status, progress: event.progress! } : null })
          // Check for paused state from event data
          if (event.message === 'Job paused') {
            dispatch({ type: 'JOB_PAUSED' })
          } else if (event.message === 'Job resumed') {
            dispatch({ type: 'JOB_RESUMED' })
          }
        }

        if (event.type === 'complete') {
          dispatch({ type: 'JOB_COMPLETED' })
          fetchStatusAndArtifacts(jobId)
        } else if (event.type === 'error') {
          dispatch({ type: 'JOB_FAILED' })
          fetchStatusAndArtifacts(jobId)
        }
      },
      (err) => {
        dispatch({ type: 'JOB_FAILED', error: err.message })
      }
    )

    return unsubscribe
  }, [jobId, status])

  const fetchStatusAndArtifacts = useCallback(async (id: string) => {
    try {
      const [statusResult, artifactsResult] = await Promise.all([
        getJobStatus(id),
        getJobArtifacts(id),
      ])
      dispatch({ type: 'UPDATE_STATUS_AND_ARTIFACTS', status: statusResult, artifacts: artifactsResult })
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
        dispatch({ type: 'UPDATE_STATUS_AND_ARTIFACTS', status: statusResult, artifacts: artifactsResult })
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
          {!isRunning && !isPaused ? (
            <button
              className="btn btn-primary"
              onClick={handleStartPreview}
              disabled={!hasConfig || reconnecting}
            >
              {reconnecting ? 'Checking...' : 'Run Preview'}
            </button>
          ) : (
            <>
              {isPaused ? (
                <button
                  className="btn btn-primary"
                  onClick={handleResume}
                  title="Resume the paused job"
                >
                  Resume
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={handlePause}
                  title="Pause the running job"
                >
                  Pause
                </button>
              )}
              <button
                className="btn btn-danger"
                onClick={handleStop}
                title="Stop and cancel the job"
              >
                Stop
              </button>
              <button
                className="btn btn-danger"
                onClick={handleForceStop}
                title="Force terminate stuck job (use if Stop doesn't work)"
                style={{ opacity: 0.8 }}
              >
                Force Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* Test Options Panel */}
      {hasConfig && (
        <TestOptionsPanel
          options={testOptions}
          onChange={handleTestOptionsChange}
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
    case 'paused':
      return 'warning'
    case 'pending':
      return 'warning'
    default:
      return 'warning'
  }
}

export default PreviewPage
