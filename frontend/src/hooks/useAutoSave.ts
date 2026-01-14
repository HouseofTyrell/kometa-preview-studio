import { useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'kometa-preview-studio-draft'
const DEBOUNCE_MS = 1000

export interface DraftData {
  overlays: unknown[]
  queues: unknown[]
  configYaml?: string
  profileId?: string
  savedAt: string
}

/**
 * Hook for auto-saving editor state to localStorage
 */
export function useAutoSave() {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Save draft to localStorage (debounced)
  const saveDraft = useCallback((data: Omit<DraftData, 'savedAt'>) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(() => {
      try {
        const draft: DraftData = {
          ...data,
          savedAt: new Date().toISOString(),
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
      } catch (err) {
        console.warn('Failed to save draft:', err)
      }
    }, DEBOUNCE_MS)
  }, [])

  // Load draft from localStorage
  const loadDraft = useCallback((): DraftData | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return null

      const draft = JSON.parse(stored) as DraftData

      // Check if draft is too old (24 hours)
      const savedAt = new Date(draft.savedAt)
      const now = new Date()
      const hoursDiff = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60)

      if (hoursDiff > 24) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }

      return draft
    } catch {
      return null
    }
  }, [])

  // Clear saved draft
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore errors
    }
  }, [])

  // Check if draft exists
  const hasDraft = useCallback((): boolean => {
    return loadDraft() !== null
  }, [loadDraft])

  // Get draft age as human-readable string
  const getDraftAge = useCallback((): string | null => {
    const draft = loadDraft()
    if (!draft) return null

    const savedAt = new Date(draft.savedAt)
    const now = new Date()
    const minutesDiff = Math.floor((now.getTime() - savedAt.getTime()) / (1000 * 60))

    if (minutesDiff < 1) return 'just now'
    if (minutesDiff < 60) return `${minutesDiff} minute${minutesDiff === 1 ? '' : 's'} ago`

    const hoursDiff = Math.floor(minutesDiff / 60)
    return `${hoursDiff} hour${hoursDiff === 1 ? '' : 's'} ago`
  }, [loadDraft])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [])

  return {
    saveDraft,
    loadDraft,
    clearDraft,
    hasDraft,
    getDraftAge,
  }
}

/**
 * Hook for persisting Plex credentials in localStorage
 */
const PLEX_STORAGE_KEY = 'kometa-preview-studio-plex'

export interface PlexCredentials {
  plexUrl: string
  plexToken: string
}

export function usePlexCredentials() {
  const saveCredentials = useCallback((credentials: PlexCredentials) => {
    try {
      localStorage.setItem(PLEX_STORAGE_KEY, JSON.stringify(credentials))
    } catch {
      // Ignore errors
    }
  }, [])

  const loadCredentials = useCallback((): PlexCredentials | null => {
    try {
      const stored = localStorage.getItem(PLEX_STORAGE_KEY)
      if (!stored) return null
      return JSON.parse(stored) as PlexCredentials
    } catch {
      return null
    }
  }, [])

  const clearCredentials = useCallback(() => {
    try {
      localStorage.removeItem(PLEX_STORAGE_KEY)
    } catch {
      // Ignore errors
    }
  }, [])

  return {
    saveCredentials,
    loadCredentials,
    clearCredentials,
  }
}
