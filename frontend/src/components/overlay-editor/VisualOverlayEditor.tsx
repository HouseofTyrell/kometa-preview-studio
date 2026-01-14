import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import BuiltinOverlayLibrary from './BuiltinOverlayLibrary'
import OverlayPropertiesPanel from './OverlayPropertiesPanel'
import ActiveOverlaysList from './ActiveOverlaysList'
import QueueConfigPanel from './QueueConfigPanel'
import CustomImageUpload from './CustomImageUpload'
import PosterPreview from './PosterPreview'
import YamlView from './YamlView'
import {
  OverlayConfig,
  BuiltinOverlay,
  QueueConfig,
  createOverlayConfig,
  createTextOverlayConfig,
} from '../../types/overlayConfig'
import { generateOverlayYaml } from '../../utils/overlayYamlGenerator'
import { exportOverlays, parseImportedOverlays, readFileAsText } from '../../utils/overlayExport'
import { useAutoSave, DraftData } from '../../hooks/useAutoSave'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import './VisualOverlayEditor.css'

// Combined state for undo/redo
interface EditorState {
  overlays: OverlayConfig[]
  queues: QueueConfig[]
}

interface VisualOverlayEditorProps {
  initialOverlays?: OverlayConfig[]
  initialQueues?: QueueConfig[]
  onConfigChange?: (overlays: OverlayConfig[], queues: QueueConfig[], yaml: string) => void
  disabled?: boolean
}

function VisualOverlayEditor({
  initialOverlays = [],
  initialQueues = [],
  onConfigChange,
  disabled = false,
}: VisualOverlayEditorProps) {
  const { saveDraft, loadDraft, clearDraft, getDraftAge } = useAutoSave()

  // Draft recovery state
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [draftAge, setDraftAge] = useState<string | null>(null)
  const [savedDraft, setSavedDraft] = useState<DraftData | null>(null)

  // Use undo/redo for combined overlay and queue state
  const {
    state: editorState,
    setState: setEditorState,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<EditorState>({
    overlays: initialOverlays,
    queues: initialQueues,
  })

  // Destructure for convenience
  const { overlays, queues } = editorState

  // Helper to update state
  const updateState = useCallback(
    (updates: Partial<EditorState>) => {
      setEditorState((prev) => ({ ...prev, ...updates }))
    },
    [setEditorState]
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual')
  const [showQueuesPanel, setShowQueuesPanel] = useState(false)
  const [clipboardOverlay, setClipboardOverlay] = useState<OverlayConfig | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Check for saved draft on mount (only if no initial data)
  useEffect(() => {
    if (initialOverlays.length === 0 && initialQueues.length === 0) {
      const draft = loadDraft()
      if (draft && draft.overlays.length > 0) {
        setSavedDraft(draft)
        setDraftAge(getDraftAge())
        setShowDraftBanner(true)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever overlays or queues change
  useEffect(() => {
    if (overlays.length > 0 || queues.length > 0) {
      saveDraft({ overlays, queues })
    }
  }, [overlays, queues, saveDraft])

  // Restore draft
  const handleRestoreDraft = useCallback(() => {
    if (savedDraft) {
      const restoredOverlays = savedDraft.overlays as OverlayConfig[]
      const restoredQueues = savedDraft.queues as QueueConfig[]
      updateState({ overlays: restoredOverlays, queues: restoredQueues })
      setShowDraftBanner(false)
      if (onConfigChange) {
        const yaml = generateOverlayYaml(restoredOverlays, restoredQueues)
        onConfigChange(restoredOverlays, restoredQueues, yaml)
      }
    }
  }, [savedDraft, onConfigChange, updateState])

  // Dismiss draft banner
  const handleDismissDraft = useCallback(() => {
    setShowDraftBanner(false)
    clearDraft()
  }, [clearDraft])

  // Get the selected overlay
  const selectedOverlay = useMemo(
    () => overlays.find((o) => o.id === selectedId) || null,
    [overlays, selectedId]
  )

  // Generate YAML from current config
  const generatedYaml = useMemo(() => generateOverlayYaml(overlays, queues), [overlays, queues])

  // Get list of added overlay base IDs (for library highlighting)
  const addedOverlayIds = useMemo(
    () => overlays.map((o) => o.pmmOverlay || o.id.split('-')[0]),
    [overlays]
  )

  // Get available queue names
  const availableQueues = useMemo(() => queues.map((q) => q.name), [queues])

  // Notify parent of changes
  const notifyChange = useCallback(
    (newOverlays: OverlayConfig[], newQueues?: QueueConfig[]) => {
      if (onConfigChange) {
        const yaml = generateOverlayYaml(newOverlays, newQueues || queues)
        onConfigChange(newOverlays, newQueues || queues, yaml)
      }
    },
    [onConfigChange, queues]
  )

  // Add a new overlay from library
  const handleAddOverlay = useCallback(
    (builtin: BuiltinOverlay) => {
      const newOverlay = createOverlayConfig(builtin)
      const newOverlays = [...overlays, newOverlay]
      updateState({ overlays: newOverlays })
      setSelectedId(newOverlay.id)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange, updateState]
  )

  // Add a new text overlay
  const handleAddTextOverlay = useCallback(() => {
    const newOverlay = createTextOverlayConfig('New Text')
    const newOverlays = [...overlays, newOverlay]
    updateState({ overlays: newOverlays })
    setSelectedId(newOverlay.id)
    notifyChange(newOverlays)
  }, [overlays, notifyChange, updateState])

  // Add a custom overlay (from file or URL)
  const handleAddCustomOverlay = useCallback(
    (overlay: OverlayConfig) => {
      const newOverlays = [...overlays, overlay]
      updateState({ overlays: newOverlays })
      setSelectedId(overlay.id)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange, updateState]
  )

  // Update an overlay
  const handleUpdateOverlay = useCallback(
    (updated: OverlayConfig) => {
      const newOverlays = overlays.map((o) => (o.id === updated.id ? updated : o))
      updateState({ overlays: newOverlays })
      notifyChange(newOverlays)
    },
    [overlays, notifyChange, updateState]
  )

  // Delete an overlay
  const handleDeleteOverlay = useCallback(
    (id: string) => {
      const newOverlays = overlays.filter((o) => o.id !== id)
      updateState({ overlays: newOverlays })
      if (selectedId === id) {
        setSelectedId(newOverlays.length > 0 ? newOverlays[0].id : null)
      }
      notifyChange(newOverlays)
    },
    [overlays, selectedId, notifyChange, updateState]
  )

  // Toggle overlay enabled state
  const handleToggleOverlay = useCallback(
    (id: string, enabled: boolean) => {
      const newOverlays = overlays.map((o) => (o.id === id ? { ...o, enabled } : o))
      updateState({ overlays: newOverlays })
      notifyChange(newOverlays)
    },
    [overlays, notifyChange, updateState]
  )

  // Reorder overlays
  const handleReorderOverlays = useCallback(
    (newOverlays: OverlayConfig[]) => {
      updateState({ overlays: newOverlays })
      notifyChange(newOverlays)
    },
    [notifyChange, updateState]
  )

  // Export all overlays
  const handleExportAll = useCallback(() => {
    exportOverlays(overlays, queues)
  }, [overlays, queues])

  // Import overlays from file
  const handleImportOverlays = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        setImportError(null)
        const content = await readFileAsText(file)
        const result = parseImportedOverlays(content)

        if ('error' in result) {
          setImportError(result.error)
          return
        }

        // Add imported overlays to existing ones
        const newOverlays = [...overlays, ...result.overlays]
        updateState({ overlays: newOverlays })
        notifyChange(newOverlays)

        // Select the first imported overlay
        if (result.overlays.length > 0) {
          setSelectedId(result.overlays[0].id)
        }
      } catch {
        setImportError('Failed to read import file')
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [overlays, notifyChange, updateState]
  )

  // Queue management
  const handleQueuesChange = useCallback(
    (newQueues: QueueConfig[]) => {
      updateState({ queues: newQueues })
      notifyChange(overlays, newQueues)
    },
    [overlays, notifyChange, updateState]
  )

  // Change overlay queue assignment
  const handleOverlayQueueChange = useCallback(
    (overlayId: string, queueName: string | undefined) => {
      const newOverlays = overlays.map((o) =>
        o.id === overlayId ? { ...o, grouping: { ...o.grouping, queue: queueName } } : o
      )
      updateState({ overlays: newOverlays })
      notifyChange(newOverlays)
    },
    [overlays, notifyChange, updateState]
  )

  // Move selected overlay up/down
  const moveSelectedOverlay = useCallback(
    (direction: 'up' | 'down') => {
      if (!selectedId || overlays.length < 2) return

      const currentIndex = overlays.findIndex((o) => o.id === selectedId)
      if (currentIndex === -1) return

      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (newIndex < 0 || newIndex >= overlays.length) return

      const newOverlays = [...overlays]
      const [moved] = newOverlays.splice(currentIndex, 1)
      newOverlays.splice(newIndex, 0, moved)

      updateState({ overlays: newOverlays })
      notifyChange(newOverlays)
    },
    [selectedId, overlays, notifyChange, updateState]
  )

  // Copy overlay to clipboard
  const handleCopyOverlay = useCallback(() => {
    if (!selectedId) return
    const overlay = overlays.find((o) => o.id === selectedId)
    if (overlay) {
      setClipboardOverlay({ ...overlay })
    }
  }, [selectedId, overlays])

  // Paste overlay from clipboard
  const handlePasteOverlay = useCallback(() => {
    if (!clipboardOverlay) return
    // Create a new overlay with a unique ID
    const newOverlay: OverlayConfig = {
      ...clipboardOverlay,
      id: `${clipboardOverlay.id.split('-')[0]}-${Date.now()}`,
      displayName: `${clipboardOverlay.displayName} (Copy)`,
    }
    const newOverlays = [...overlays, newOverlay]
    updateState({ overlays: newOverlays })
    setSelectedId(newOverlay.id)
    notifyChange(newOverlays)
  }, [clipboardOverlay, overlays, updateState, notifyChange])

  // Duplicate selected overlay
  const handleDuplicateOverlay = useCallback(() => {
    if (!selectedId) return
    const overlay = overlays.find((o) => o.id === selectedId)
    if (overlay) {
      const newOverlay: OverlayConfig = {
        ...overlay,
        id: `${overlay.id.split('-')[0]}-${Date.now()}`,
        displayName: `${overlay.displayName} (Copy)`,
      }
      const newOverlays = [...overlays, newOverlay]
      updateState({ overlays: newOverlays })
      setSelectedId(newOverlay.id)
      notifyChange(newOverlays)
    }
  }, [selectedId, overlays, updateState, notifyChange])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea (except for undo/redo)
      const target = e.target as HTMLElement
      const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Always allow undo/redo shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !disabled) {
        e.preventDefault()
        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !disabled) {
        e.preventDefault()
        redo()
        return
      }

      // Copy overlay (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedId && !disabled && !isTextInput) {
        e.preventDefault()
        handleCopyOverlay()
        return
      }

      // Paste overlay (Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardOverlay && !disabled && !isTextInput) {
        e.preventDefault()
        handlePasteOverlay()
        return
      }

      // Duplicate overlay (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedId && !disabled && !isTextInput) {
        e.preventDefault()
        handleDuplicateOverlay()
        return
      }

      // Ignore other shortcuts if typing in an input
      if (isTextInput) return

      // Ignore if disabled or in YAML view
      if (disabled || viewMode === 'yaml') return

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (selectedId) {
            e.preventDefault()
            handleDeleteOverlay(selectedId)
          }
          break

        case 'ArrowUp':
          if (selectedId && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            if (e.shiftKey) {
              // Shift+Up = Move overlay up in list
              moveSelectedOverlay('up')
            } else {
              // Up = Select previous overlay
              const currentIndex = overlays.findIndex((o) => o.id === selectedId)
              if (currentIndex > 0) {
                setSelectedId(overlays[currentIndex - 1].id)
              }
            }
          }
          break

        case 'ArrowDown':
          if (selectedId && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            if (e.shiftKey) {
              // Shift+Down = Move overlay down in list
              moveSelectedOverlay('down')
            } else {
              // Down = Select next overlay
              const currentIndex = overlays.findIndex((o) => o.id === selectedId)
              if (currentIndex < overlays.length - 1) {
                setSelectedId(overlays[currentIndex + 1].id)
              }
            }
          }
          break

        case 'Escape':
          setSelectedId(null)
          break

        case 'e':
        case 'E':
          // Toggle enable/disable
          if (selectedId && !e.metaKey && !e.ctrlKey) {
            const overlay = overlays.find((o) => o.id === selectedId)
            if (overlay) {
              handleToggleOverlay(selectedId, !overlay.enabled)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    disabled,
    viewMode,
    selectedId,
    overlays,
    clipboardOverlay,
    handleDeleteOverlay,
    handleToggleOverlay,
    moveSelectedOverlay,
    handleCopyOverlay,
    handlePasteOverlay,
    handleDuplicateOverlay,
    undo,
    redo,
  ])

  return (
    <div className="visual-overlay-editor">
      {/* Draft Recovery Banner */}
      {showDraftBanner && (
        <div className="draft-banner">
          <div className="draft-banner-content">
            <span className="draft-icon">📝</span>
            <span className="draft-message">
              You have unsaved work from {draftAge || 'a previous session'}
            </span>
          </div>
          <div className="draft-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleRestoreDraft}
            >
              Restore
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleDismissDraft}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="editor-header">
        <h2 className="editor-title">Overlay Editor</h2>
        <div className="header-controls">
          <div className="undo-redo-controls">
            <button
              type="button"
              className="btn btn-icon"
              onClick={undo}
              disabled={disabled || !canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
              </svg>
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={redo}
              disabled={disabled || !canRedo}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6" />
                <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            className={`queues-btn ${showQueuesPanel ? 'active' : ''}`}
            onClick={() => setShowQueuesPanel(!showQueuesPanel)}
            disabled={disabled}
          >
            Queues {queues.length > 0 && `(${queues.length})`}
          </button>
          <div className="view-toggle">
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'visual' ? 'active' : ''}`}
              onClick={() => setViewMode('visual')}
            >
              Visual
            </button>
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'yaml' ? 'active' : ''}`}
              onClick={() => setViewMode('yaml')}
            >
              YAML
            </button>
          </div>
        </div>
      </div>

      {/* Queues Panel (collapsible) */}
      {showQueuesPanel && (
        <div className="queues-panel-container">
          <QueueConfigPanel
            queues={queues}
            overlays={overlays}
            onQueuesChange={handleQueuesChange}
            onOverlayQueueChange={handleOverlayQueueChange}
            disabled={disabled}
          />
        </div>
      )}

      {viewMode === 'visual' ? (
        <div className="editor-content">
          {/* Left: Library */}
          <div className="editor-library">
            <BuiltinOverlayLibrary
              onAddOverlay={handleAddOverlay}
              addedOverlayIds={addedOverlayIds}
              disabled={disabled}
            />
            <div className="create-text-section">
              <button
                type="button"
                className="create-text-btn"
                onClick={handleAddTextOverlay}
                disabled={disabled}
              >
                <span className="btn-icon">T</span>
                <span>Create Text Overlay</span>
              </button>
            </div>
            <CustomImageUpload onAddOverlay={handleAddCustomOverlay} disabled={disabled} />

            {/* Import/Export Section */}
            <div className="import-export-section">
              <h4 className="section-title">Import / Export</h4>
              <div className="import-export-buttons">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportOverlays}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="import-export-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Import
                </button>
                <button
                  type="button"
                  className="import-export-btn"
                  onClick={handleExportAll}
                  disabled={disabled || overlays.length === 0}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export All
                </button>
              </div>
              {importError && (
                <div className="import-error">{importError}</div>
              )}
            </div>
          </div>

          {/* Center: Active List + Preview Area */}
          <div className="editor-main">
            <PosterPreview overlays={overlays} selectedId={selectedId} onSelect={setSelectedId} />
            <ActiveOverlaysList
              overlays={overlays}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggle={handleToggleOverlay}
              onReorder={handleReorderOverlays}
              onDelete={handleDeleteOverlay}
              disabled={disabled}
            />
          </div>

          {/* Right: Properties */}
          <div className="editor-properties">
            <OverlayPropertiesPanel
              overlay={selectedOverlay}
              overlays={overlays}
              availableQueues={availableQueues}
              onChange={handleUpdateOverlay}
              onDelete={handleDeleteOverlay}
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <YamlView yaml={generatedYaml} disabled={disabled} />
      )}
    </div>
  )
}

export default VisualOverlayEditor
