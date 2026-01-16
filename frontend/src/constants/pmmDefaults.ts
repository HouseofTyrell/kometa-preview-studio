/**
 * Kometa PMM (Plex Meta Manager) Default Overlays
 * Based on https://kometa.wiki/en/latest/defaults/guide/
 */

export interface PMMOverlayDefault {
  id: string
  name: string
  pmmKey: string // The key used in YAML (e.g., 'pmm: resolution')
  category: PMMCategory
  description: string
  icon: string
  mediaTypes: ('movie' | 'show' | 'season' | 'episode')[]
  templateVariables?: PMMTemplateVariable[]
  exampleImage?: string
  documentationUrl: string
}

export interface PMMTemplateVariable {
  key: string
  name: string
  description: string
  type: 'boolean' | 'string' | 'number' | 'select'
  default: string | number | boolean
  options?: { value: string | number | boolean; label: string }[]
}

export type PMMCategory =
  | 'chart'
  | 'content'
  | 'content_rating'
  | 'media'
  | 'production'
  | 'utility'

export const PMM_CATEGORIES: Record<PMMCategory, { name: string; icon: string; description: string }> = {
  chart: {
    name: 'Chart',
    icon: '📊',
    description: 'Ranking and chart-based overlays'
  },
  content: {
    name: 'Content',
    icon: '📝',
    description: 'Content information and metadata overlays'
  },
  content_rating: {
    name: 'Content Rating',
    icon: '🔞',
    description: 'Age and content rating overlays'
  },
  media: {
    name: 'Media',
    icon: '🎬',
    description: 'Technical media information overlays'
  },
  production: {
    name: 'Production',
    icon: '🎭',
    description: 'Studio, network, and streaming service overlays'
  },
  utility: {
    name: 'Utility',
    icon: '🔧',
    description: 'Utility and playback information overlays'
  }
}

export const PMM_OVERLAY_DEFAULTS: PMMOverlayDefault[] = [
  // Chart Category
  {
    id: 'ribbon',
    name: 'Ribbon',
    pmmKey: 'pmm: ribbon',
    category: 'chart',
    description: 'Display ribbons for IMDb Top 250, RT Certified Fresh, and IMDb Bottom 100',
    icon: '🏆',
    mediaTypes: ['movie', 'show'],
    templateVariables: [
      {
        key: 'weight',
        name: 'Weight',
        description: 'Controls the order overlays are applied',
        type: 'number',
        default: 40
      },
      {
        key: 'style',
        name: 'Style',
        description: 'Visual style of the ribbon',
        type: 'select',
        default: 'standard',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'fresh', label: 'Fresh' },
          { value: 'half', label: 'Half Size' }
        ]
      }
    ],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/ribbon/'
  },

  // Content Category
  {
    id: 'episode_info',
    name: 'Episode Info',
    pmmKey: 'pmm: episode_info',
    category: 'content',
    description: 'Display episode information on episode posters',
    icon: '📺',
    mediaTypes: ['episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/episode_info/'
  },
  {
    id: 'mediastinger',
    name: 'MediaStinger',
    pmmKey: 'pmm: mediastinger',
    category: 'content',
    description: 'Show indicators for post-credits scenes',
    icon: '🎬',
    mediaTypes: ['movie'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/mediastinger/'
  },
  {
    id: 'ratings',
    name: 'Ratings',
    pmmKey: 'pmm: ratings',
    category: 'content',
    description: 'Display ratings from IMDb, Rotten Tomatoes, TMDb, and more',
    icon: '⭐',
    mediaTypes: ['movie', 'show'],
    templateVariables: [
      {
        key: 'rating_source',
        name: 'Rating Source',
        description: 'Which rating service to display',
        type: 'select',
        default: 'imdb',
        options: [
          { value: 'imdb', label: 'IMDb' },
          { value: 'tmdb', label: 'TMDb' },
          { value: 'rt_audience', label: 'Rotten Tomatoes (Audience)' },
          { value: 'rt_critic', label: 'Rotten Tomatoes (Critics)' },
          { value: 'letterboxd', label: 'Letterboxd' },
          { value: 'metacritic', label: 'Metacritic' }
        ]
      }
    ],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/ratings/'
  },
  {
    id: 'status',
    name: 'Status',
    pmmKey: 'pmm: status',
    category: 'content',
    description: 'Display status badges (Airing, Returning, Ended, Canceled)',
    icon: '📡',
    mediaTypes: ['show'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/status/'
  },

  // Content Rating Category
  {
    id: 'content_rating_us_movie',
    name: 'US Movie Ratings',
    pmmKey: 'pmm: content_rating_us_movie',
    category: 'content_rating',
    description: 'Display US content ratings for movies (G, PG, PG-13, R, NC-17)',
    icon: '🇺🇸',
    mediaTypes: ['movie'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/content_rating_us/'
  },
  {
    id: 'content_rating_us_show',
    name: 'US TV Ratings',
    pmmKey: 'pmm: content_rating_us_show',
    category: 'content_rating',
    description: 'Display US TV content ratings (TV-Y, TV-G, TV-PG, TV-14, TV-MA)',
    icon: '📺',
    mediaTypes: ['show'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/content_rating_us/'
  },
  {
    id: 'content_rating_uk',
    name: 'UK Ratings',
    pmmKey: 'pmm: content_rating_uk',
    category: 'content_rating',
    description: 'Display UK content ratings (U, PG, 12A, 15, 18)',
    icon: '🇬🇧',
    mediaTypes: ['movie', 'show'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/content_rating_uk/'
  },
  {
    id: 'commonsense',
    name: 'Common Sense Media',
    pmmKey: 'pmm: commonsense',
    category: 'content_rating',
    description: 'Display age recommendations from Common Sense Media',
    icon: '👨‍👩‍👧‍👦',
    mediaTypes: ['movie', 'show'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/commonsense/'
  },

  // Media Category
  {
    id: 'aspect',
    name: 'Aspect Ratio',
    pmmKey: 'pmm: aspect',
    category: 'media',
    description: 'Display aspect ratio information (1.33, 1.78, 1.85, 2.35, 2.77)',
    icon: '📐',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/aspect/'
  },
  {
    id: 'audio_codec',
    name: 'Audio Codec',
    pmmKey: 'pmm: audio_codec',
    category: 'media',
    description: 'Display audio codec (Dolby Atmos, DTS-X, TrueHD, DTS-HD MA)',
    icon: '🔊',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/audio_codec/'
  },
  {
    id: 'language_count',
    name: 'Language Count',
    pmmKey: 'pmm: language_count',
    category: 'media',
    description: 'Display count of available audio and subtitle languages',
    icon: '🌍',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/language_count/'
  },
  {
    id: 'languages',
    name: 'Language Flags',
    pmmKey: 'pmm: languages',
    category: 'media',
    description: 'Display flags for available audio and subtitle languages',
    icon: '🏳️',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/languages/'
  },
  {
    id: 'resolution',
    name: 'Resolution',
    pmmKey: 'pmm: resolution',
    category: 'media',
    description: 'Display video resolution (4K, 1080p, 720p, 576p, 480p)',
    icon: '📺',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    templateVariables: [
      {
        key: 'style',
        name: 'Style',
        description: 'Visual style of the badge',
        type: 'select',
        default: 'standard',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'compact', label: 'Compact' }
        ]
      }
    ],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/resolution/'
  },
  {
    id: 'resolution_edition',
    name: 'Resolution/Edition',
    pmmKey: 'pmm: resolution_edition',
    category: 'media',
    description: 'Display resolution with edition info (4K IMAX, 1080p Extended)',
    icon: '🎞️',
    mediaTypes: ['movie'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/resolution/'
  },
  {
    id: 'runtimes',
    name: 'Runtimes',
    pmmKey: 'pmm: runtimes',
    category: 'media',
    description: 'Display runtime ranges (<30min, 30-90min, 90-120min, >120min)',
    icon: '⏱️',
    mediaTypes: ['movie'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/runtimes/'
  },
  {
    id: 'versions',
    name: 'Versions',
    pmmKey: 'pmm: versions',
    category: 'media',
    description: 'Display edition indicators (Director\'s Cut, Extended, IMAX)',
    icon: '🎬',
    mediaTypes: ['movie'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/versions/'
  },
  {
    id: 'video_format',
    name: 'Video Format',
    pmmKey: 'pmm: video_format',
    category: 'media',
    description: 'Display HDR format (Dolby Vision, HDR10+, HDR10, HDR)',
    icon: '✨',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/video_format/'
  },

  // Production Category
  {
    id: 'network',
    name: 'Networks',
    pmmKey: 'pmm: network',
    category: 'production',
    description: 'Display network logos (NBC, CBS, ABC, FOX, etc.)',
    icon: '📡',
    mediaTypes: ['show'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/network/'
  },
  {
    id: 'streaming',
    name: 'Streaming Services',
    pmmKey: 'pmm: streaming',
    category: 'production',
    description: 'Display streaming service logos (Netflix, Disney+, HBO Max, etc.)',
    icon: '📺',
    mediaTypes: ['movie', 'show'],
    templateVariables: [
      {
        key: 'region',
        name: 'Region',
        description: 'Regional availability for streaming services',
        type: 'select',
        default: 'US',
        options: [
          { value: 'US', label: 'United States' },
          { value: 'UK', label: 'United Kingdom' },
          { value: 'CA', label: 'Canada' },
          { value: 'AU', label: 'Australia' }
        ]
      }
    ],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/streaming/'
  },
  {
    id: 'studio',
    name: 'Studios',
    pmmKey: 'pmm: studio',
    category: 'production',
    description: 'Display studio logos (Warner Bros, Disney, Universal, etc.)',
    icon: '🎬',
    mediaTypes: ['movie', 'show'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/studio/'
  },

  // Utility Category
  {
    id: 'direct_play',
    name: 'Direct Play Only',
    pmmKey: 'pmm: direct_play',
    category: 'utility',
    description: 'Highlight media that can only be direct played',
    icon: '▶️',
    mediaTypes: ['movie', 'show', 'season', 'episode'],
    documentationUrl: 'https://kometa.wiki/en/latest/defaults/overlays/direct_play/'
  }
]

/**
 * Get overlays by category
 */
export function getOverlaysByCategory(category: PMMCategory): PMMOverlayDefault[] {
  return PMM_OVERLAY_DEFAULTS.filter(overlay => overlay.category === category)
}

/**
 * Get overlay by ID
 */
export function getOverlayById(id: string): PMMOverlayDefault | undefined {
  return PMM_OVERLAY_DEFAULTS.find(overlay => overlay.id === id)
}

/**
 * Get overlays compatible with a media type
 */
export function getOverlaysForMediaType(mediaType: 'movie' | 'show' | 'season' | 'episode'): PMMOverlayDefault[] {
  return PMM_OVERLAY_DEFAULTS.filter(overlay => overlay.mediaTypes.includes(mediaType))
}

/**
 * Search overlays by name or description
 */
export function searchOverlays(query: string): PMMOverlayDefault[] {
  const lowerQuery = query.toLowerCase()
  return PMM_OVERLAY_DEFAULTS.filter(
    overlay =>
      overlay.name.toLowerCase().includes(lowerQuery) ||
      overlay.description.toLowerCase().includes(lowerQuery)
  )
}
