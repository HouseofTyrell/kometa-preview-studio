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
  fontStyle?: string;      // bold, italic, etc.
  strokeColor?: string;
  strokeWidth?: number;
}

// Grouping and queue configuration
export interface OverlayGrouping {
  group?: string;
  weight: number;
  queue?: string;
  suppressOverlays?: string[];
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
