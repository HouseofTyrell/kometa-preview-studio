// Overlay Editor Components
export { default as VisualOverlayEditor } from './VisualOverlayEditor'
export { default as PositionPicker } from './PositionPicker'
export { default as BuiltinOverlayLibrary } from './BuiltinOverlayLibrary'
export { default as OverlayPropertiesPanel } from './OverlayPropertiesPanel'
export { default as ActiveOverlaysList } from './ActiveOverlaysList'

// Re-export types
export * from '../../types/overlayConfig'

// Re-export utilities
export { generateOverlayYaml, generateConfigSummary } from '../../utils/overlayYamlGenerator'
