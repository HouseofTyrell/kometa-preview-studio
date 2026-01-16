import { useState, useMemo, useEffect, useCallback } from 'react'
import MediaSelector from '../components/builder/MediaSelector'
import LivePreview from '../components/builder/LivePreview'
import OverlayCheckboxGrid from '../components/builder/OverlayCheckboxGrid'
import PositionPresets from '../components/builder/PositionPresets'
import AdvancedConfigurator from '../components/builder/AdvancedConfigurator'
import DefaultsLibrary from '../components/builder/DefaultsLibrary'
import CommunityBrowser from '../components/builder/CommunityBrowser'
import ShareDialog from '../components/builder/ShareDialog'
import YamlEditor from '../components/YamlEditor'
import { PREVIEW_TARGETS } from '../constants/previewTargets'
import type { OverlayConfig, QueueConfig } from '../types/overlayConfig'
import type { PMMOverlayDefault } from '../constants/pmmDefaults'
import {
  startPreview,
  getJobArtifacts,
  exportBuilderConfig,
  importBuilderConfig,
  saveBuilderOverlays,
  getBuilderOverlays,
  parseCommunityOverlays,
  validateYaml,
  parseYamlOverlays,
} from '../api/client'
import type { TestOptions, ManualBuilderConfig } from '../types/testOptions'
import {
  generateOverlayYaml,
  generateFullKometaConfig,
  generateSimplePmmOverlays,
} from '../utils/overlayYamlGenerator'
import './OverlayBuilder.css'

interface OverlayBuilderPageProps {
  profileId: string | null
  configYaml: string
  libraryNames: string[]
  overlayFiles: string[]
  onConfigUpdate: (
    profileId: string,
    configYaml: string,
    libraryNames: string[],
    overlayFiles: string[]
  ) => void
}

type BuilderMode = 'simple' | 'advanced' | 'defaults' | 'community' | 'yaml'

function OverlayBuilderPage({
  profileId,
  configYaml,
  libraryNames,
}: OverlayBuilderPageProps) {
  const [mode, setMode] = useState<BuilderMode>('simple')
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [enabledOverlays, setEnabledOverlays] = useState<Record<string, boolean>>({})
  const [selectedPreset, setSelectedPreset] = useState<string | null>('top-left')
  const [advancedOverlays, setAdvancedOverlays] = useState<OverlayConfig[]>([])
  const [advancedQueues, setAdvancedQueues] = useState<QueueConfig[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [yamlContent, setYamlContent] = useState<string>('')
  const [yamlError, setYamlError] = useState<string | null>(null)
  const [isYamlSynced, setIsYamlSynced] = useState(true)

  // Auto-dismiss messages after 5 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [errorMessage])

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  // Load overlays from config on mount
  useEffect(() => {
    const loadOverlaysFromConfig = async () => {
      if (!profileId) return

      try {
        const result = await getBuilderOverlays(profileId)

        // Parse overlay files to detect which overlays are enabled
        const detected: Record<string, boolean> = {}

        for (const overlayFiles of Object.values(result.overlaysByLibrary)) {
          for (const overlayFile of overlayFiles) {
            if (typeof overlayFile === 'string') {
              // Map PMM overlay names back to our keys
              if (overlayFile.includes('resolution')) detected['resolution'] = true
              if (overlayFile.includes('audio_codec')) detected['audio_codec'] = true
              if (overlayFile.includes('video_format') || overlayFile.includes('hdr')) detected['hdr'] = true
              if (overlayFile.includes('streaming')) detected['streaming'] = true
              if (overlayFile.includes('network')) detected['network'] = true
              if (overlayFile.includes('studio')) detected['studio'] = true
              if (overlayFile.includes('ratings')) detected['ratings'] = true
              if (overlayFile.includes('ribbon')) {
                detected['imdb_top250'] = true
                detected['rt_certified'] = true
                detected['imdb_lowest'] = true
              }
              if (overlayFile.includes('status')) detected['status'] = true
            }
          }
        }

        if (Object.keys(detected).length > 0) {
          setEnabledOverlays(detected)
        }
      } catch (error) {
        console.error('Failed to load overlays from config:', error)
        // Don't show error to user - it's ok if config has no overlays yet
      }
    }

    loadOverlaysFromConfig()
  }, [profileId])

  // Generate YAML content when builder state changes
  useEffect(() => {
    if (mode !== 'yaml') {
      // When not in YAML mode, regenerate the YAML from builder state
      let generatedYaml = ''

      if (mode === 'advanced' && advancedOverlays.length > 0) {
        // Generate from advanced overlays
        generatedYaml = generateFullKometaConfig(advancedOverlays, advancedQueues, {
          libraryName: libraryNames[0] || 'Movies',
          libraryType: 'movie',
        })
      } else if (Object.keys(enabledOverlays).some((key) => enabledOverlays[key])) {
        // Generate from simple mode PMM overlays
        generatedYaml = generateSimplePmmOverlays(enabledOverlays, selectedPreset || undefined)
      }

      if (generatedYaml) {
        setYamlContent(generatedYaml)
        setIsYamlSynced(true)
      }
    }
  }, [mode, enabledOverlays, selectedPreset, advancedOverlays, advancedQueues, libraryNames])

  // Find the selected target object
  const selectedTargetObj = useMemo(() => {
    if (!selectedTarget) return null
    return PREVIEW_TARGETS.find((t) => t.id === selectedTarget) || null
  }, [selectedTarget])

  const handleSelectTarget = (targetId: string) => {
    setSelectedTarget(targetId)
    setPreviewUrl(null) // Clear preview when switching targets
  }

  const handleToggleOverlay = (overlayKey: string, enabled: boolean) => {
    setEnabledOverlays((prev) => ({
      ...prev,
      [overlayKey]: enabled,
    }))
    // Clear preview when overlays change to show it needs regeneration
    setPreviewUrl(null)
  }

  const handleSelectPreset = (presetId: string) => {
    setSelectedPreset(presetId)
    if (presetId === 'custom') {
      setMode('advanced')
    }
  }

  const handleAdvancedOverlaysChange = (overlays: OverlayConfig[], queues: QueueConfig[]) => {
    setAdvancedOverlays(overlays)
    setAdvancedQueues(queues)
    // Clear preview when overlays change
    setPreviewUrl(null)
  }

  const convertEnabledOverlaysToManualConfig = (): ManualBuilderConfig => {
    return {
      enabled: true,
      resolution: enabledOverlays['resolution'] || false,
      audioCodec: enabledOverlays['audio_codec'] || false,
      hdr: enabledOverlays['hdr'] || false,
      ratings: enabledOverlays['ratings'] || false,
      streaming: enabledOverlays['streaming'] || false,
      network: enabledOverlays['network'] || false,
      studio: enabledOverlays['studio'] || false,
      status: enabledOverlays['status'] || false,
      ribbon: {
        imdbTop250: enabledOverlays['imdb_top250'] || false,
        imdbLowest: enabledOverlays['imdb_lowest'] || false,
        rtCertifiedFresh: enabledOverlays['rt_certified'] || false,
      },
    }
  }

  const handleReset = () => {
    if (!confirm('Reset all overlay configurations? This will clear all your current settings.')) {
      return
    }
    setEnabledOverlays({})
    setSelectedPreset('top-left')
    setAdvancedOverlays([])
    setAdvancedQueues([])
    setPreviewUrl(null)
    setMode('simple')
    setSuccessMessage('Configuration reset successfully')
  }

  const handleExport = async () => {
    try {
      const exportData = await exportBuilderConfig({
        enabledOverlays,
        selectedPreset,
        advancedOverlays,
        advancedQueues,
      })

      // Download as JSON file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `overlay-builder-config-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSuccessMessage('Configuration exported successfully')
    } catch (error) {
      console.error('Export failed:', error)
      setErrorMessage(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const data = JSON.parse(text)

        // Validate with backend
        const result = await importBuilderConfig(data)

        if (result.valid) {
          setEnabledOverlays(result.data.enabledOverlays)
          setSelectedPreset(result.data.selectedPreset)
          setAdvancedOverlays(result.data.advancedOverlays as OverlayConfig[])
          setAdvancedQueues(result.data.advancedQueues as QueueConfig[])
          setPreviewUrl(null)
          setSuccessMessage('Configuration imported successfully!')
        }
      } catch (error) {
        console.error('Import failed:', error)
        setErrorMessage(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
    input.click()
  }

  const handleSaveToConfig = async () => {
    if (mode === 'simple' && Object.keys(enabledOverlays).length === 0) {
      setErrorMessage('No overlays enabled. Enable at least one overlay before saving.')
      return
    }

    if (!profileId) {
      setErrorMessage('No config loaded. To save to a config file, please import a config on the Config page first.')
      return
    }

    try {
      let overlayFilesToSave: Array<string | Record<string, unknown>> = []

      if (mode === 'advanced' && advancedOverlays.length > 0) {
        // In advanced mode, generate full overlay YAML
        const overlayYaml = generateOverlayYaml(advancedOverlays, advancedQueues)

        // Create a file reference for the generated overlays
        // In a real implementation, this would save the YAML to a file
        // For now, we'll use inline YAML
        overlayFilesToSave = [overlayYaml]
      } else if (mode === 'simple') {
        // In simple mode, just reference PMM's built-in overlays
        const enabledKeys = Object.entries(enabledOverlays)
          .filter(([_, enabled]) => enabled)
          .map(([key]) => key)

        // Map to PMM overlay names
        const pmmOverlayMap: Record<string, string> = {
          'resolution': 'pmm: resolution',
          'audio_codec': 'pmm: audio_codec',
          'hdr': 'pmm: video_format',
          'streaming': 'pmm: streaming',
          'network': 'pmm: network',
          'studio': 'pmm: studio',
          'ratings': 'pmm: ratings',
          'imdb_top250': 'pmm: ribbon',
          'rt_certified': 'pmm: ribbon',
          'imdb_lowest': 'pmm: ribbon',
          'status': 'pmm: status',
        }

        // Get unique PMM overlays
        const uniqueOverlays = new Set<string>()
        enabledKeys.forEach(key => {
          const pmmOverlay = pmmOverlayMap[key]
          if (pmmOverlay) {
            uniqueOverlays.add(pmmOverlay)
          }
        })

        overlayFilesToSave = Array.from(uniqueOverlays)
      }

      if (overlayFilesToSave.length === 0) {
        setErrorMessage('No overlay configuration to save.')
        return
      }

      // Save to all libraries (or first library if multiple exist)
      const overlaysByLibrary: Record<string, Array<string | Record<string, unknown>>> = {}

      // Use first library name or "Movies" as default
      const targetLibrary = libraryNames[0] || 'Movies'
      overlaysByLibrary[targetLibrary] = overlayFilesToSave

      await saveBuilderOverlays(profileId, overlaysByLibrary)

      setSuccessMessage(`Overlay configuration saved to ${targetLibrary} library!`)
    } catch (error) {
      console.error('Save to config failed:', error)
      setErrorMessage(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleSelectFromDefaults = (overlay: PMMOverlayDefault) => {
    // Map PMM overlay ID to our internal key
    const keyMap: Record<string, string> = {
      'resolution': 'resolution',
      'resolution_edition': 'resolution',
      'audio_codec': 'audio_codec',
      'video_format': 'hdr',
      'aspect': 'aspect',
      'language_count': 'language_count',
      'languages': 'languages',
      'runtimes': 'runtimes',
      'versions': 'versions',
      'streaming': 'streaming',
      'network': 'network',
      'studio': 'studio',
      'ratings': 'ratings',
      'ribbon': 'imdb_top250',
      'status': 'status',
      'content_rating_us_movie': 'content_rating',
      'content_rating_us_show': 'content_rating',
      'content_rating_uk': 'content_rating',
      'commonsense': 'commonsense',
      'episode_info': 'episode_info',
      'mediastinger': 'mediastinger',
      'direct_play': 'direct_play'
    }

    const overlayKey = keyMap[overlay.id]
    if (overlayKey) {
      // Toggle the overlay
      setEnabledOverlays(prev => ({
        ...prev,
        [overlayKey]: !prev[overlayKey]
      }))

      // Clear preview to show it needs regeneration
      setPreviewUrl(null)

      // Show success message
      const isEnabled = !enabledOverlays[overlayKey]
      setSuccessMessage(`${overlay.name} ${isEnabled ? 'enabled' : 'disabled'}!`)
    } else {
      setErrorMessage(`Could not map overlay "${overlay.name}" - key not found`)
    }
  }

  const handleRequestPreview = async () => {
    if (!selectedTarget) {
      setErrorMessage('Please select a media target first')
      return
    }

    // Only validate enabled overlays in simple/advanced modes
    // In defaults/community modes, user may be browsing before enabling
    if ((mode === 'simple' || mode === 'advanced') && Object.keys(enabledOverlays).length === 0) {
      setErrorMessage('Please enable at least one overlay')
      return
    }

    setIsGenerating(true)
    try {
      // Build test options with manual builder config for fast preview
      const manualBuilderConfig = convertEnabledOverlaysToManualConfig()

      const testOptions: TestOptions = {
        selectedTargets: [selectedTarget],
        mediaTypes: {
          movies: true,
          shows: true,
          seasons: true,
          episodes: true,
        },
        selectedLibraries: [],
        selectedOverlays: [],
        manualBuilderConfig,
      }

      // Use provided config or create a minimal one for builder mode
      // Note: Manual mode doesn't actually use TMDb/Plex, but we include them for config validation
      const effectiveConfig = configYaml || `# Minimal config for overlay builder (manual mode)
plex:
  url: http://localhost:32400
  token: dummy-token
tmdb:
  apikey: dummy-key
settings:
  run_order: ["overlays"]
libraries:
  Movies:
    overlay_files: []`

      // Start preview job
      const { jobId } = await startPreview({
        configYaml: effectiveConfig,
        testOptions,
      })

      // Poll for artifacts (draft image should be available quickly)
      const pollForArtifacts = async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          try {
            const artifacts = await getJobArtifacts(jobId)
            const targetArtifact = artifacts.items.find((item) => item.id === selectedTarget)

            if (targetArtifact?.draftUrl) {
              setPreviewUrl(targetArtifact.draftUrl)
              return
            }
          } catch (error) {
            // Continue polling if artifacts not ready yet
            console.log('Waiting for artifacts...', i)
          }
        }
        throw new Error('Preview timed out after 15 seconds')
      }

      await pollForArtifacts()
      setSuccessMessage('Preview generated successfully!')
    } catch (error) {
      console.error('Preview generation failed:', error)
      setErrorMessage(`Preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsGenerating(false)
    }
  }

  // Handle YAML content change from editor
  const handleYamlChange = useCallback((newYaml: string) => {
    setYamlContent(newYaml)
    setIsYamlSynced(false) // Mark as out of sync with builder state
  }, [])

  // Handle YAML validation result
  const handleYamlValidate = useCallback((_isValid: boolean, error: string | null) => {
    setYamlError(error)
  }, [])

  // Import YAML and update builder state
  const handleImportYaml = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yml,.yaml'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()

        // Validate YAML first
        const validation = await validateYaml(text)
        if (!validation.valid) {
          setErrorMessage(`Invalid YAML: ${validation.error}`)
          return
        }

        // Parse overlays from the YAML
        const parsed = await parseYamlOverlays(text)

        // Update YAML content
        setYamlContent(text)
        setYamlError(null)

        // Try to sync builder state based on parsed content
        if (parsed.type === 'overlay_file' && parsed.overlayNames) {
          // Map overlay names to builder state
          const newEnabledOverlays: Record<string, boolean> = {}
          const overlayMap: Record<string, string> = {
            resolution: 'resolution',
            audio_codec: 'audio_codec',
            video_format: 'hdr',
            streaming: 'streaming',
            network: 'network',
            studio: 'studio',
            ratings: 'ratings',
            ribbon: 'imdb_top250',
            status: 'status',
          }

          for (const overlayName of parsed.overlayNames) {
            const overlayLower = overlayName.toLowerCase()
            for (const [pmmName, builderKey] of Object.entries(overlayMap)) {
              if (overlayLower.includes(pmmName)) {
                newEnabledOverlays[builderKey] = true
              }
            }
          }

          if (Object.keys(newEnabledOverlays).length > 0) {
            setEnabledOverlays(newEnabledOverlays)
          }

          setSuccessMessage(
            `Imported overlay file with ${parsed.overlayCount} overlays!`
          )
        } else if (parsed.type === 'kometa_config' && parsed.overlaysByLibrary) {
          // Parse overlays from Kometa config
          let overlayCount = 0
          const newEnabledOverlays: Record<string, boolean> = {}

          for (const overlays of Object.values(parsed.overlaysByLibrary)) {
            if (Array.isArray(overlays)) {
              for (const overlay of overlays) {
                const overlayStr = String(overlay).toLowerCase()
                overlayCount++

                // Map PMM overlays to builder state
                if (overlayStr.includes('resolution')) newEnabledOverlays['resolution'] = true
                if (overlayStr.includes('audio_codec')) newEnabledOverlays['audio_codec'] = true
                if (overlayStr.includes('video_format') || overlayStr.includes('hdr')) newEnabledOverlays['hdr'] = true
                if (overlayStr.includes('streaming')) newEnabledOverlays['streaming'] = true
                if (overlayStr.includes('network')) newEnabledOverlays['network'] = true
                if (overlayStr.includes('studio')) newEnabledOverlays['studio'] = true
                if (overlayStr.includes('ratings')) newEnabledOverlays['ratings'] = true
                if (overlayStr.includes('ribbon')) {
                  newEnabledOverlays['imdb_top250'] = true
                  newEnabledOverlays['rt_certified'] = true
                }
                if (overlayStr.includes('status')) newEnabledOverlays['status'] = true
              }
            }
          }

          if (Object.keys(newEnabledOverlays).length > 0) {
            setEnabledOverlays(newEnabledOverlays)
          }

          setSuccessMessage(
            `Imported Kometa config with ${parsed.libraryCount} libraries and ${overlayCount} overlay references!`
          )
        } else {
          setSuccessMessage('YAML loaded! Could not auto-detect overlay settings.')
        }

        setIsYamlSynced(true)
        setMode('yaml') // Switch to YAML mode to view
      } catch (error) {
        console.error('Import YAML failed:', error)
        setErrorMessage(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
    input.click()
  }

  // Sync YAML changes back to builder state
  const handleSyncYamlToBuilder = async () => {
    if (!yamlContent) {
      setErrorMessage('No YAML content to sync')
      return
    }

    try {
      // Validate first
      const validation = await validateYaml(yamlContent)
      if (!validation.valid) {
        setErrorMessage(`Cannot sync invalid YAML: ${validation.error}`)
        return
      }

      // Parse and update builder state
      const parsed = await parseYamlOverlays(yamlContent)

      if (parsed.type === 'overlay_file' && parsed.overlayNames) {
        const newEnabledOverlays: Record<string, boolean> = {}
        const overlayMap: Record<string, string> = {
          resolution: 'resolution',
          audio_codec: 'audio_codec',
          video_format: 'hdr',
          streaming: 'streaming',
          network: 'network',
          studio: 'studio',
          ratings: 'ratings',
          ribbon: 'imdb_top250',
          status: 'status',
        }

        for (const overlayName of parsed.overlayNames) {
          const overlayLower = overlayName.toLowerCase()
          for (const [pmmName, builderKey] of Object.entries(overlayMap)) {
            if (overlayLower.includes(pmmName)) {
              newEnabledOverlays[builderKey] = true
            }
          }
        }

        setEnabledOverlays(newEnabledOverlays)
        setIsYamlSynced(true)
        setSuccessMessage('Builder state synced from YAML!')
      } else if (parsed.type === 'kometa_config') {
        // Handle full Kometa config
        const newEnabledOverlays: Record<string, boolean> = {}

        if (parsed.overlaysByLibrary) {
          for (const overlays of Object.values(parsed.overlaysByLibrary)) {
            if (Array.isArray(overlays)) {
              for (const overlay of overlays) {
                const overlayStr = String(overlay).toLowerCase()
                if (overlayStr.includes('resolution')) newEnabledOverlays['resolution'] = true
                if (overlayStr.includes('audio_codec')) newEnabledOverlays['audio_codec'] = true
                if (overlayStr.includes('video_format') || overlayStr.includes('hdr')) newEnabledOverlays['hdr'] = true
                if (overlayStr.includes('streaming')) newEnabledOverlays['streaming'] = true
                if (overlayStr.includes('network')) newEnabledOverlays['network'] = true
                if (overlayStr.includes('studio')) newEnabledOverlays['studio'] = true
                if (overlayStr.includes('ratings')) newEnabledOverlays['ratings'] = true
                if (overlayStr.includes('ribbon')) newEnabledOverlays['imdb_top250'] = true
                if (overlayStr.includes('status')) newEnabledOverlays['status'] = true
              }
            }
          }
        }

        setEnabledOverlays(newEnabledOverlays)
        setIsYamlSynced(true)
        setSuccessMessage('Builder state synced from YAML!')
      } else {
        setErrorMessage('Could not parse overlay information from YAML')
      }
    } catch (error) {
      console.error('Sync failed:', error)
      setErrorMessage(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Create new empty config
  const handleNewConfig = () => {
    const template = `# Kometa Overlay Configuration
# Generated by Kometa Preview Studio
# ${new Date().toISOString()}

overlays:
  # Add your overlay configurations here
  # Example:
  # my_overlay:
  #   pmm: resolution
  #   overlay:
  #     horizontal_align: left
  #     vertical_align: top
  #     horizontal_offset: 15
  #     vertical_offset: 15
`
    setYamlContent(template)
    setYamlError(null)
    setIsYamlSynced(true)
    setEnabledOverlays({})
    setAdvancedOverlays([])
    setAdvancedQueues([])
    setMode('yaml')
    setSuccessMessage('New config created! Edit the YAML to configure your overlays.')
  }

  const handleImportCommunityConfig = async (
    config: string,
    metadata: { username: string; filename: string; url: string }
  ) => {
    try {
      // Parse the YAML to extract overlay information
      const parsed = await parseCommunityOverlays(config)

      if (!parsed.success || parsed.overlays.length === 0) {
        setErrorMessage('No overlays found in this config. It may not contain overlay_files entries.')
        return
      }

      // Map detected overlays to our internal overlay keys
      const overlayMap: Record<string, string[]> = {
        'resolution': ['pmm: resolution', 'resolution'],
        'audio_codec': ['pmm: audio_codec', 'audio_codec'],
        'hdr': ['pmm: video_format', 'video_format', 'hdr'],
        'streaming': ['pmm: streaming', 'streaming'],
        'network': ['pmm: network', 'network'],
        'studio': ['pmm: studio', 'studio'],
        'ratings': ['pmm: ratings', 'ratings'],
        'imdb_top250': ['pmm: ribbon', 'ribbon'],
        'rt_certified': ['pmm: ribbon', 'ribbon'],
        'imdb_lowest': ['pmm: ribbon', 'ribbon'],
        'status': ['pmm: status', 'status'],
        'aspect': ['pmm: aspect', 'aspect'],
        'language_count': ['pmm: language_count', 'language_count'],
        'languages': ['pmm: languages', 'languages'],
        'runtimes': ['pmm: runtimes', 'runtimes'],
        'versions': ['pmm: versions', 'versions'],
        'content_rating': ['pmm: content_rating', 'content_rating'],
        'commonsense': ['pmm: commonsense', 'commonsense'],
        'episode_info': ['pmm: episode_info', 'episode_info'],
        'mediastinger': ['pmm: mediastinger', 'mediastinger'],
        'direct_play': ['pmm: direct_play', 'direct_play'],
      }

      // Enable overlays that were detected
      const newEnabledOverlays: Record<string, boolean> = {}
      let enabledCount = 0

      for (const overlayFile of parsed.overlays) {
        const overlayLower = overlayFile.toLowerCase()

        // Check each overlay key to see if it matches
        for (const [key, patterns] of Object.entries(overlayMap)) {
          if (patterns.some(pattern => overlayLower.includes(pattern.toLowerCase()))) {
            newEnabledOverlays[key] = true
            enabledCount++
            break
          }
        }
      }

      if (enabledCount === 0) {
        setErrorMessage('Could not map any overlays from this config to known overlay types.')
        return
      }

      // Update enabled overlays state
      setEnabledOverlays(newEnabledOverlays)

      // Clear existing preview
      setPreviewUrl(null)

      // Switch to simple mode for easier customization
      setMode('simple')

      setSuccessMessage(
        `Imported "${metadata.filename}" from ${metadata.username}! ${enabledCount} overlay${enabledCount > 1 ? 's' : ''} enabled.`
      )
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <div className="overlay-builder-page">
      {!profileId && (
        <div className="message-banner info">
          <span>💡 Builder Mode: You can test overlays without importing a config! Export or save to config file later.</span>
        </div>
      )}
      {errorMessage && (
        <div className="message-banner error">
          <span>{errorMessage}</span>
          <button className="close-button" onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}
      {successMessage && (
        <div className="message-banner success">
          <span>{successMessage}</span>
          <button className="close-button" onClick={() => setSuccessMessage(null)}>×</button>
        </div>
      )}

      <div className="builder-header">
        <h2>Overlay Builder</h2>
        <div className="mode-toggle">
          <button
            className={`mode-button ${mode === 'simple' ? 'active' : ''}`}
            onClick={() => setMode('simple')}
          >
            Simple
          </button>
          <button
            className={`mode-button ${mode === 'defaults' ? 'active' : ''}`}
            onClick={() => setMode('defaults')}
          >
            📦 PMM Defaults
          </button>
          <button
            className={`mode-button ${mode === 'community' ? 'active' : ''}`}
            onClick={() => setMode('community')}
          >
            👥 Community
          </button>
          <button
            className={`mode-button ${mode === 'advanced' ? 'active' : ''}`}
            onClick={() => setMode('advanced')}
          >
            Advanced
          </button>
          <button
            className={`mode-button ${mode === 'yaml' ? 'active' : ''}`}
            onClick={() => setMode('yaml')}
          >
            YAML
          </button>
        </div>
      </div>

      <div className="builder-content">
        <div className="media-selector-panel">
          <h3>Media Selection</h3>
          <div className="panel-content">
            <MediaSelector
              selectedTarget={selectedTarget}
              onSelectTarget={handleSelectTarget}
            />
          </div>
        </div>

        <div className="overlay-configurator-panel">
          <h3>Overlay Configuration</h3>
          <div className="panel-content">
            {mode === 'simple' ? (
              <div className="simple-mode">
                {selectedTarget ? (
                  <>
                    <OverlayCheckboxGrid
                      enabledOverlays={enabledOverlays}
                      onToggleOverlay={handleToggleOverlay}
                      mediaType={selectedTargetObj?.type || 'movie'}
                      targetMetadata={selectedTargetObj?.metadata}
                    />
                    <PositionPresets
                      selectedPreset={selectedPreset}
                      onSelectPreset={handleSelectPreset}
                    />
                  </>
                ) : (
                  <p className="placeholder-text">
                    Select a media item to configure overlays
                  </p>
                )}
              </div>
            ) : mode === 'defaults' ? (
              <div className="defaults-mode">
                <DefaultsLibrary
                  onSelectOverlay={handleSelectFromDefaults}
                  enabledOverlayIds={(() => {
                    // Map internal keys back to PMM overlay IDs for display
                    const reverseMap: Record<string, string[]> = {
                      'resolution': ['resolution', 'resolution_edition'],
                      'audio_codec': ['audio_codec'],
                      'hdr': ['video_format'],
                      'aspect': ['aspect'],
                      'language_count': ['language_count'],
                      'languages': ['languages'],
                      'runtimes': ['runtimes'],
                      'versions': ['versions'],
                      'streaming': ['streaming'],
                      'network': ['network'],
                      'studio': ['studio'],
                      'ratings': ['ratings'],
                      'imdb_top250': ['ribbon'],
                      'status': ['status'],
                      'content_rating': ['content_rating_us_movie', 'content_rating_us_show', 'content_rating_uk'],
                      'commonsense': ['commonsense'],
                      'episode_info': ['episode_info'],
                      'mediastinger': ['mediastinger'],
                      'direct_play': ['direct_play']
                    }

                    const enabledPMMIds: string[] = []
                    Object.entries(enabledOverlays).forEach(([key, enabled]) => {
                      if (enabled && reverseMap[key]) {
                        enabledPMMIds.push(...reverseMap[key])
                      }
                    })
                    return enabledPMMIds
                  })()}
                />
              </div>
            ) : mode === 'community' ? (
              <div className="community-mode">
                <CommunityBrowser onImportConfig={handleImportCommunityConfig} />
              </div>
            ) : mode === 'yaml' ? (
              <div className="yaml-mode">
                <div className="yaml-mode-toolbar">
                  <button
                    className="yaml-toolbar-btn"
                    onClick={handleNewConfig}
                    title="Create a new blank overlay configuration"
                  >
                    New Config
                  </button>
                  <button
                    className="yaml-toolbar-btn"
                    onClick={handleImportYaml}
                    title="Import a YAML file"
                  >
                    Import YAML
                  </button>
                  {!isYamlSynced && (
                    <button
                      className="yaml-toolbar-btn sync"
                      onClick={handleSyncYamlToBuilder}
                      disabled={!!yamlError}
                      title="Apply YAML changes to builder state"
                    >
                      Sync to Builder
                    </button>
                  )}
                </div>
                <YamlEditor
                  value={yamlContent}
                  onChange={handleYamlChange}
                  onValidate={handleYamlValidate}
                  height="500px"
                  placeholder="# Enter your Kometa overlay configuration here...
# Or use the buttons above to create a new config or import an existing YAML file.

overlays:
  my_overlay:
    pmm: resolution"
                />
                {!isYamlSynced && !yamlError && (
                  <div className="yaml-sync-warning">
                    YAML has been modified. Click &quot;Sync to Builder&quot; to apply changes.
                  </div>
                )}
              </div>
            ) : (
              <div className="advanced-mode">
                {selectedTarget ? (
                  <AdvancedConfigurator
                    enabledOverlays={enabledOverlays}
                    selectedPreset={selectedPreset}
                    onOverlaysChange={handleAdvancedOverlaysChange}
                  />
                ) : (
                  <p className="placeholder-text">
                    Select a media item to configure overlays
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="live-preview-panel">
          <h3>Live Preview</h3>
          <div className="panel-content">
            <LivePreview
              target={selectedTargetObj}
              previewUrl={previewUrl}
              isGenerating={isGenerating}
              onRequestPreview={handleRequestPreview}
            />
          </div>
        </div>
      </div>

      <div className="builder-actions">
        <div className="action-group">
          <button className="action-button secondary" onClick={handleReset}>
            Reset
          </button>
          <button className="action-button secondary" onClick={handleExport}>
            Export
          </button>
          <button className="action-button secondary" onClick={handleImport}>
            Import
          </button>
          <button className="action-button secondary" onClick={() => setShowShareDialog(true)}>
            🔗 Share
          </button>
        </div>
        <div className="action-group">
          <button className="action-button primary" onClick={handleSaveToConfig}>
            Save to Config
          </button>
        </div>
      </div>

      {showShareDialog && (
        <ShareDialog
          config={{
            enabledOverlays,
            selectedPreset,
            advancedOverlays,
            advancedQueues,
          }}
          onClose={() => setShowShareDialog(false)}
          onSuccess={(message) => {
            setSuccessMessage(message)
            // Don't close dialog on success - let user copy links
          }}
          onError={(message) => {
            setErrorMessage(message)
          }}
        />
      )}
    </div>
  )
}

export default OverlayBuilderPage
