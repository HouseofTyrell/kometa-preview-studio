import './PositionPresets.css'

interface PositionPresetsProps {
  selectedPreset: string | null
  onSelectPreset: (presetId: string) => void
}

interface Preset {
  id: string
  name: string
  description: string
  preview: string // ASCII art preview of overlay positions
}

const PRESETS: Preset[] = [
  {
    id: 'top-left',
    name: 'Top Left Stack',
    description: 'All overlays stacked in top-left corner',
    preview: `
┌─────────────┐
│ ▪ ▪ ▪       │
│             │
│             │
│             │
└─────────────┘
    `.trim(),
  },
  {
    id: 'top-right',
    name: 'Top Right Stack',
    description: 'All overlays stacked in top-right corner',
    preview: `
┌─────────────┐
│       ▪ ▪ ▪ │
│             │
│             │
│             │
└─────────────┘
    `.trim(),
  },
  {
    id: 'bottom-corners',
    name: 'Bottom Corners',
    description: 'Overlays distributed in bottom corners',
    preview: `
┌─────────────┐
│             │
│             │
│             │
│ ▪ ▪     ▪ ▪ │
└─────────────┘
    `.trim(),
  },
  {
    id: 'centered-bottom',
    name: 'Centered Bottom',
    description: 'Overlays centered along bottom edge',
    preview: `
┌─────────────┐
│             │
│             │
│             │
│   ▪ ▪ ▪ ▪   │
└─────────────┘
    `.trim(),
  },
  {
    id: 'all-corners',
    name: 'All Corners',
    description: 'Overlays distributed in all four corners',
    preview: `
┌─────────────┐
│ ▪       ▪   │
│             │
│             │
│ ▪       ▪   │
└─────────────┘
    `.trim(),
  },
]

function PositionPresets({ selectedPreset, onSelectPreset }: PositionPresetsProps) {
  return (
    <div className="position-presets">
      <div className="presets-header">
        <h4>Position Presets</h4>
        <p className="presets-description">
          Quick position templates for your overlays
        </p>
      </div>
      <div className="presets-grid">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`preset-card ${selectedPreset === preset.id ? 'selected' : ''}`}
            onClick={() => onSelectPreset(preset.id)}
          >
            <div className="preset-preview">
              <pre>{preset.preview}</pre>
            </div>
            <div className="preset-info">
              <h5>{preset.name}</h5>
              <p>{preset.description}</p>
            </div>
            {selectedPreset === preset.id && (
              <div className="selected-indicator">✓</div>
            )}
          </button>
        ))}
        <button
          className={`preset-card custom ${selectedPreset === 'custom' ? 'selected' : ''}`}
          onClick={() => onSelectPreset('custom')}
        >
          <div className="preset-preview">
            <span className="custom-icon">⚙️</span>
          </div>
          <div className="preset-info">
            <h5>Custom</h5>
            <p>Switch to advanced mode for full control</p>
          </div>
          {selectedPreset === 'custom' && (
            <div className="selected-indicator">✓</div>
          )}
        </button>
      </div>
    </div>
  )
}

export default PositionPresets
