/**
 * Overlay configuration types for the visual editor
 * Based on Kometa overlay file attributes
 */

// Position alignment options
export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'center' | 'bottom';

// Overlay source types
export type OverlaySourceType = 'pmm' | 'file' | 'url' | 'text' | 'backdrop' | 'blur';

// Built-in PMM overlay categories
export type PmmOverlayCategory =
  | 'resolution'
  | 'audio_codec'
  | 'ratings'
  | 'streaming'
  | 'network'
  | 'studio'
  | 'status'
  | 'ribbon'
  | 'versions'
  | 'aspect';

// Position configuration
export interface OverlayPosition {
  horizontalAlign: HorizontalAlign;
  verticalAlign: VerticalAlign;
  horizontalOffset: number;
  verticalOffset: number;
}

// Backdrop/background styling
export interface OverlayBackdrop {
  enabled: boolean;
  color: string;           // Hex with alpha: #RRGGBBAA
  width?: number;          // pixels, undefined = auto
  height?: number;         // pixels, undefined = auto
  radius?: number;         // corner radius in pixels
  padding?: number;        // internal padding in pixels
  lineColor?: string;      // border color
  lineWidth?: number;      // border width in pixels
}

// Text overlay configuration
export interface OverlayText {
  content: string;         // Static text or variable like <<imdb_rating>>
  font: string;            // Font name or path
  fontSize: number;
  fontColor: string;       // Hex color
  fontStyle?: 'bold' | 'italic' | 'bold italic';
  strokeColor?: string;
  strokeWidth?: number;
}

// Available fonts (commonly available system fonts + PMM fonts)
export const AVAILABLE_FONTS = [
  { id: 'inter', name: 'Inter', value: 'Inter' },
  { id: 'roboto', name: 'Roboto', value: 'Roboto' },
  { id: 'arial', name: 'Arial', value: 'Arial' },
  { id: 'helvetica', name: 'Helvetica', value: 'Helvetica' },
  { id: 'georgia', name: 'Georgia', value: 'Georgia' },
  { id: 'times', name: 'Times New Roman', value: 'Times New Roman' },
  { id: 'courier', name: 'Courier New', value: 'Courier New' },
  { id: 'verdana', name: 'Verdana', value: 'Verdana' },
  { id: 'tahoma', name: 'Tahoma', value: 'Tahoma' },
  { id: 'trebuchet', name: 'Trebuchet MS', value: 'Trebuchet MS' },
] as const;

// Kometa text variables that can be used in overlays
export interface TextVariable {
  id: string;
  name: string;
  variable: string;
  description: string;
  category: string;
  modifiers?: string[];
}

export const TEXT_VARIABLES: TextVariable[] = [
  // Ratings
  { id: 'imdb_rating', name: 'IMDb Rating', variable: '<<imdb_rating>>', description: 'IMDb rating (e.g., 8.5)', category: 'Ratings', modifiers: ['%', '#', 'W'] },
  { id: 'tmdb_rating', name: 'TMDb Rating', variable: '<<tmdb_rating>>', description: 'TMDb rating', category: 'Ratings', modifiers: ['%', '#', 'W'] },
  { id: 'rt_rating', name: 'Rotten Tomatoes', variable: '<<rt_rating>>', description: 'Rotten Tomatoes score', category: 'Ratings', modifiers: ['%', '#', 'W'] },
  { id: 'audience_rating', name: 'Audience Rating', variable: '<<audience_rating>>', description: 'Audience rating', category: 'Ratings' },
  { id: 'critic_rating', name: 'Critic Rating', variable: '<<critic_rating>>', description: 'Critic rating', category: 'Ratings' },

  // Media Info
  { id: 'runtime', name: 'Runtime', variable: '<<runtime>>', description: 'Duration in minutes', category: 'Media Info', modifiers: ['H', 'M'] },
  { id: 'bitrate', name: 'Bitrate', variable: '<<bitrate>>', description: 'Video bitrate', category: 'Media Info' },
  { id: 'resolution', name: 'Resolution', variable: '<<resolution>>', description: 'Video resolution (e.g., 1080p)', category: 'Media Info' },
  { id: 'audio_codec', name: 'Audio Codec', variable: '<<audio_codec>>', description: 'Audio codec name', category: 'Media Info' },
  { id: 'video_codec', name: 'Video Codec', variable: '<<video_codec>>', description: 'Video codec name', category: 'Media Info' },
  { id: 'audio_channels', name: 'Audio Channels', variable: '<<audio_channels>>', description: 'Number of audio channels', category: 'Media Info' },

  // Metadata
  { id: 'title', name: 'Title', variable: '<<title>>', description: 'Item title', category: 'Metadata' },
  { id: 'year', name: 'Year', variable: '<<year>>', description: 'Release year', category: 'Metadata' },
  { id: 'content_rating', name: 'Content Rating', variable: '<<content_rating>>', description: 'Content rating (PG, R, etc.)', category: 'Metadata' },
  { id: 'originally_available', name: 'Release Date', variable: '<<originally_available>>', description: 'Original release date', category: 'Metadata' },

  // Library Info
  { id: 'episode_count', name: 'Episode Count', variable: '<<episode_count>>', description: 'Number of episodes', category: 'Library' },
  { id: 'season_count', name: 'Season Count', variable: '<<season_count>>', description: 'Number of seasons', category: 'Library' },
  { id: 'versions', name: 'Versions', variable: '<<versions>>', description: 'Number of versions', category: 'Library' },
];

// Grouping and queue configuration
export interface OverlayGrouping {
  group?: string;
  weight: number;
  queue?: string;
  suppressOverlays?: string[];
}

// Queue direction type
export type QueueDirection = 'horizontal' | 'vertical';

// Queue configuration for managing multiple overlays in sequence
export interface QueueConfig {
  id: string;
  name: string;
  position: Pick<OverlayPosition, 'horizontalAlign' | 'verticalAlign'>;
  horizontalOffset: number;
  verticalOffset: number;
  direction: QueueDirection;
  spacing: number;          // Spacing between items in pixels
}

// Main overlay configuration
export interface OverlayConfig {
  id: string;
  name: string;
  displayName: string;
  enabled: boolean;

  // Source type
  sourceType: OverlaySourceType;

  // For PMM built-in overlays
  pmmOverlay?: PmmOverlayCategory;

  // For custom file/url overlays
  sourcePath?: string;

  // Preview URL for custom images (browser-accessible)
  previewUrl?: string;

  // For blur overlays
  blurAmount?: number;

  // Positioning
  position: OverlayPosition;

  // Styling
  backdrop: OverlayBackdrop;

  // Text configuration (for text overlays)
  text?: OverlayText;

  // Grouping
  grouping: OverlayGrouping;
}

// Built-in overlay definition
export interface BuiltinOverlay {
  id: string;
  name: string;
  description: string;
  category: string;
  pmmName: PmmOverlayCategory;
  icon: string;
  defaultPosition: Pick<OverlayPosition, 'horizontalAlign' | 'verticalAlign'>;
  supportsBackdrop: boolean;
}

// Default position presets
export const POSITION_PRESETS: Record<string, Pick<OverlayPosition, 'horizontalAlign' | 'verticalAlign'>> = {
  'top-left': { horizontalAlign: 'left', verticalAlign: 'top' },
  'top-center': { horizontalAlign: 'center', verticalAlign: 'top' },
  'top-right': { horizontalAlign: 'right', verticalAlign: 'top' },
  'middle-left': { horizontalAlign: 'left', verticalAlign: 'center' },
  'middle-center': { horizontalAlign: 'center', verticalAlign: 'center' },
  'middle-right': { horizontalAlign: 'right', verticalAlign: 'center' },
  'bottom-left': { horizontalAlign: 'left', verticalAlign: 'bottom' },
  'bottom-center': { horizontalAlign: 'center', verticalAlign: 'bottom' },
  'bottom-right': { horizontalAlign: 'right', verticalAlign: 'bottom' },
};

// Built-in overlay library
export const BUILTIN_OVERLAYS: BuiltinOverlay[] = [
  // Resolution & Quality
  {
    id: 'resolution',
    name: 'Resolution',
    description: '4K, 1080p, 720p, etc.',
    category: 'Quality',
    pmmName: 'resolution',
    icon: '🎬',
    defaultPosition: { horizontalAlign: 'left', verticalAlign: 'top' },
    supportsBackdrop: true,
  },
  {
    id: 'audio_codec',
    name: 'Audio Codec',
    description: 'Atmos, DTS-HD, TrueHD, etc.',
    category: 'Quality',
    pmmName: 'audio_codec',
    icon: '🔊',
    defaultPosition: { horizontalAlign: 'right', verticalAlign: 'top' },
    supportsBackdrop: true,
  },
  {
    id: 'versions',
    name: 'Versions',
    description: 'Number of versions available',
    category: 'Quality',
    pmmName: 'versions',
    icon: '📀',
    defaultPosition: { horizontalAlign: 'right', verticalAlign: 'top' },
    supportsBackdrop: true,
  },
  {
    id: 'aspect',
    name: 'Aspect Ratio',
    description: '16:9, 21:9, IMAX, etc.',
    category: 'Quality',
    pmmName: 'aspect',
    icon: '📐',
    defaultPosition: { horizontalAlign: 'left', verticalAlign: 'top' },
    supportsBackdrop: true,
  },

  // Ratings
  {
    id: 'ratings',
    name: 'Ratings',
    description: 'IMDb, TMDb, RT scores',
    category: 'Ratings',
    pmmName: 'ratings',
    icon: '⭐',
    defaultPosition: { horizontalAlign: 'left', verticalAlign: 'bottom' },
    supportsBackdrop: true,
  },

  // Streaming
  {
    id: 'streaming',
    name: 'Streaming',
    description: 'Netflix, Disney+, Max, etc.',
    category: 'Services',
    pmmName: 'streaming',
    icon: '📺',
    defaultPosition: { horizontalAlign: 'right', verticalAlign: 'bottom' },
    supportsBackdrop: false,
  },
  {
    id: 'network',
    name: 'Network',
    description: 'TV Networks (HBO, AMC, etc.)',
    category: 'Services',
    pmmName: 'network',
    icon: '📡',
    defaultPosition: { horizontalAlign: 'right', verticalAlign: 'bottom' },
    supportsBackdrop: false,
  },
  {
    id: 'studio',
    name: 'Studio',
    description: 'Production studios',
    category: 'Services',
    pmmName: 'studio',
    icon: '🎥',
    defaultPosition: { horizontalAlign: 'center', verticalAlign: 'bottom' },
    supportsBackdrop: false,
  },

  // Status
  {
    id: 'status',
    name: 'Status',
    description: 'Returning, Ended, Canceled',
    category: 'Status',
    pmmName: 'status',
    icon: '📊',
    defaultPosition: { horizontalAlign: 'left', verticalAlign: 'top' },
    supportsBackdrop: true,
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    description: 'Awards, Top 250, etc.',
    category: 'Status',
    pmmName: 'ribbon',
    icon: '🏆',
    defaultPosition: { horizontalAlign: 'right', verticalAlign: 'top' },
    supportsBackdrop: false,
  },
];

// Default backdrop configuration
export const DEFAULT_BACKDROP: OverlayBackdrop = {
  enabled: false,
  color: '#000000CC',
  radius: 0,
  padding: 0,
};

// Default position
export const DEFAULT_POSITION: OverlayPosition = {
  horizontalAlign: 'left',
  verticalAlign: 'top',
  horizontalOffset: 15,
  verticalOffset: 15,
};

// Default grouping
export const DEFAULT_GROUPING: OverlayGrouping = {
  weight: 100,
};

// Create a new overlay config
export function createOverlayConfig(
  builtin: BuiltinOverlay,
  overrides?: Partial<OverlayConfig>
): OverlayConfig {
  return {
    id: `${builtin.id}-${Date.now()}`,
    name: builtin.pmmName,
    displayName: builtin.name,
    enabled: true,
    sourceType: 'pmm',
    pmmOverlay: builtin.pmmName,
    position: {
      ...DEFAULT_POSITION,
      ...builtin.defaultPosition,
    },
    backdrop: {
      ...DEFAULT_BACKDROP,
      enabled: builtin.supportsBackdrop,
    },
    grouping: {
      ...DEFAULT_GROUPING,
      group: builtin.category.toLowerCase(),
    },
    ...overrides,
  };
}

// Create a text overlay config
export function createTextOverlayConfig(text: string): OverlayConfig {
  return {
    id: `text-${Date.now()}`,
    name: `text(${text})`,
    displayName: text,
    enabled: true,
    sourceType: 'text',
    position: DEFAULT_POSITION,
    backdrop: {
      ...DEFAULT_BACKDROP,
      enabled: true,
    },
    text: {
      content: text,
      font: 'Inter',
      fontSize: 45,
      fontColor: '#FFFFFF',
    },
    grouping: DEFAULT_GROUPING,
  };
}

// Get position preset key from position
export function getPositionPresetKey(position: OverlayPosition): string {
  return `${position.verticalAlign}-${position.horizontalAlign}`;
}

// Create a new queue config
export function createQueueConfig(name: string): QueueConfig {
  return {
    id: `queue-${Date.now()}`,
    name,
    position: { horizontalAlign: 'left', verticalAlign: 'bottom' },
    horizontalOffset: 15,
    verticalOffset: 15,
    direction: 'horizontal',
    spacing: 10,
  };
}

// Create a custom file overlay config
export function createFileOverlayConfig(
  name: string,
  filePath: string,
  previewUrl?: string
): OverlayConfig {
  return {
    id: `file-${Date.now()}`,
    name: name.replace(/[^a-zA-Z0-9_]/g, '_'),
    displayName: name,
    enabled: true,
    sourceType: 'file',
    sourcePath: filePath,
    previewUrl,
    position: DEFAULT_POSITION,
    backdrop: DEFAULT_BACKDROP,
    grouping: DEFAULT_GROUPING,
  };
}

// Create a URL-based overlay config
export function createUrlOverlayConfig(
  name: string,
  url: string
): OverlayConfig {
  return {
    id: `url-${Date.now()}`,
    name: name.replace(/[^a-zA-Z0-9_]/g, '_'),
    displayName: name,
    enabled: true,
    sourceType: 'url',
    sourcePath: url,
    position: DEFAULT_POSITION,
    backdrop: DEFAULT_BACKDROP,
    grouping: DEFAULT_GROUPING,
  };
}

// Default queue config
export const DEFAULT_QUEUE_CONFIG: Omit<QueueConfig, 'id' | 'name'> = {
  position: { horizontalAlign: 'left', verticalAlign: 'bottom' },
  horizontalOffset: 15,
  verticalOffset: 15,
  direction: 'horizontal',
  spacing: 10,
};
