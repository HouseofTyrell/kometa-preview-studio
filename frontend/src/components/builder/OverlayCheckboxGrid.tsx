import './OverlayCheckboxGrid.css'

interface OverlayCheckboxGridProps {
  enabledOverlays: Record<string, boolean>
  onToggleOverlay: (overlayKey: string, enabled: boolean) => void
  mediaType: 'movie' | 'show' | 'season' | 'episode'
  targetMetadata?: Record<string, any> | null
}

interface OverlayGroup {
  title: string
  overlays: {
    key: string
    label: string
    description: string
    icon: string
    disabledFor?: string[] // Media types this overlay doesn't apply to
  }[]
}

const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    title: 'Quality Badges',
    overlays: [
      {
        key: 'resolution',
        label: 'Resolution',
        description: '4K, 1080p, 720p, etc.',
        icon: '📺',
      },
      {
        key: 'audio_codec',
        label: 'Audio Codec',
        description: 'Dolby Atmos, DTS-HD, TrueHD, etc.',
        icon: '🔊',
      },
      {
        key: 'hdr',
        label: 'HDR / Dolby Vision',
        description: 'HDR10, HDR10+, Dolby Vision badges',
        icon: '✨',
      },
    ],
  },
  {
    title: 'Streaming & Providers',
    overlays: [
      {
        key: 'streaming',
        label: 'Streaming Services',
        description: 'Netflix, Disney+, Prime Video, etc.',
        icon: '📡',
      },
      {
        key: 'network',
        label: 'Network Logos',
        description: 'HBO, AMC, FX, etc.',
        icon: '📻',
        disabledFor: ['movie'],
      },
      {
        key: 'studio',
        label: 'Studio Logos',
        description: 'Warner Bros, Universal, etc.',
        icon: '🎬',
      },
    ],
  },
  {
    title: 'Ratings',
    overlays: [
      {
        key: 'ratings',
        label: 'Ratings (IMDb, TMDb, RT)',
        description: 'IMDb, The Movie Database, and Rotten Tomatoes ratings',
        icon: '⭐',
      },
    ],
  },
  {
    title: 'Awards & Ribbons',
    overlays: [
      {
        key: 'imdb_top250',
        label: 'IMDb Top 250',
        description: 'Ribbon for Top 250 ranked titles',
        icon: '🏆',
      },
      {
        key: 'rt_certified',
        label: 'RT Certified Fresh',
        description: 'Certified Fresh badge from Rotten Tomatoes',
        icon: '✅',
      },
      {
        key: 'imdb_lowest',
        label: 'IMDb Lowest Rated',
        description: 'Badge for bottom-ranked titles',
        icon: '💩',
      },
    ],
  },
  {
    title: 'TV Shows Only',
    overlays: [
      {
        key: 'status',
        label: 'Status Badges',
        description: 'Returning, Ended, Canceled, etc.',
        icon: '📊',
        disabledFor: ['movie'],
      },
    ],
  },
]

function OverlayCheckboxGrid({
  enabledOverlays,
  onToggleOverlay,
  mediaType,
  targetMetadata,
}: OverlayCheckboxGridProps) {
  const handleToggle = (overlayKey: string) => {
    onToggleOverlay(overlayKey, !enabledOverlays[overlayKey])
  }

  const handleSelectAll = (group: OverlayGroup) => {
    group.overlays.forEach((overlay) => {
      if (!isDisabled(overlay)) {
        onToggleOverlay(overlay.key, true)
      }
    })
  }

  const handleSelectNone = (group: OverlayGroup) => {
    group.overlays.forEach((overlay) => {
      onToggleOverlay(overlay.key, false)
    })
  }

  const isDisabled = (overlay: { key: string; disabledFor?: string[] }) => {
    // Check if disabled for this media type
    if (overlay.disabledFor?.includes(mediaType)) {
      return true
    }

    // Check if target has metadata for this overlay type
    if (targetMetadata) {
      switch (overlay.key) {
        case 'resolution':
          return !targetMetadata.resolution
        case 'audio_codec':
          return !targetMetadata.audioCodec
        case 'hdr':
          return !targetMetadata.hdr && !targetMetadata.dolbyVision
        case 'streaming':
          return !targetMetadata.streaming || targetMetadata.streaming.length === 0
        case 'network':
          return !targetMetadata.network
        case 'studio':
          return !targetMetadata.studio
        case 'ratings':
          return !targetMetadata.imdbRating && !targetMetadata.tmdbRating && !targetMetadata.rtRating
        case 'status':
          return !targetMetadata.status
        case 'imdb_top250':
        case 'rt_certified':
        case 'imdb_lowest':
          return !targetMetadata.ribbon || targetMetadata.ribbon !== overlay.key
        default:
          return false
      }
    }

    return false
  }

  const getDisabledReason = (overlay: { key: string; disabledFor?: string[] }): string | null => {
    if (overlay.disabledFor?.includes(mediaType)) {
      return `Not available for ${mediaType}s`
    }

    if (targetMetadata) {
      switch (overlay.key) {
        case 'resolution':
          return !targetMetadata.resolution ? 'No resolution data available for this target' : null
        case 'audio_codec':
          return !targetMetadata.audioCodec ? 'No audio codec data available for this target' : null
        case 'hdr':
          return !targetMetadata.hdr && !targetMetadata.dolbyVision ? 'No HDR/DV data available for this target' : null
        case 'streaming':
          return !targetMetadata.streaming || targetMetadata.streaming.length === 0 ? 'No streaming service data available for this target' : null
        case 'network':
          return !targetMetadata.network ? 'No network data available for this target' : null
        case 'studio':
          return !targetMetadata.studio ? 'No studio data available for this target' : null
        case 'ratings':
          return !targetMetadata.imdbRating && !targetMetadata.tmdbRating && !targetMetadata.rtRating ? 'No rating data available for this target' : null
        case 'status':
          return !targetMetadata.status ? 'No status data available for this target' : null
        case 'imdb_top250':
          return targetMetadata.ribbon !== 'imdb_top_250' ? 'This target does not qualify for IMDb Top 250 ribbon' : null
        case 'rt_certified':
          return targetMetadata.ribbon !== 'rt_certified_fresh' ? 'This target does not qualify for RT Certified Fresh ribbon' : null
        case 'imdb_lowest':
          return targetMetadata.ribbon !== 'imdb_lowest' ? 'This target does not qualify for IMDb Lowest Rated ribbon' : null
      }
    }

    return null
  }

  const isGroupFullySelected = (group: OverlayGroup) => {
    return group.overlays
      .filter((o) => !isDisabled(o))
      .every((o) => enabledOverlays[o.key])
  }

  return (
    <div className="overlay-checkbox-grid">
      {OVERLAY_GROUPS.map((group) => (
        <div key={group.title} className="overlay-group">
          <div className="group-header">
            <h4>{group.title}</h4>
            <div className="group-actions">
              <button
                className="group-action-button"
                onClick={() => handleSelectAll(group)}
                disabled={isGroupFullySelected(group)}
              >
                All
              </button>
              <button
                className="group-action-button"
                onClick={() => handleSelectNone(group)}
              >
                None
              </button>
            </div>
          </div>
          <div className="overlay-list">
            {group.overlays.map((overlay) => {
              const disabled = isDisabled(overlay)
              const disabledReason = getDisabledReason(overlay)
              return (
                <label
                  key={overlay.key}
                  className={`overlay-item ${disabled ? 'disabled' : ''}`}
                  title={disabledReason || overlay.description}
                >
                  <input
                    type="checkbox"
                    checked={enabledOverlays[overlay.key] || false}
                    onChange={() => handleToggle(overlay.key)}
                    disabled={disabled}
                  />
                  <span className="overlay-icon">{overlay.icon}</span>
                  <span className="overlay-label">{overlay.label}</span>
                  <span className="overlay-description">{overlay.description}</span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default OverlayCheckboxGrid
