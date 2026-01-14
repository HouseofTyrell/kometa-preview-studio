interface PosterSize {
  name: string
  width: number
  height: number
  label: string
}

export const POSTER_SIZES: PosterSize[] = [
  { name: 'auto', width: 0, height: 0, label: 'Auto' },
  { name: 'large', width: 1000, height: 1500, label: '1000×1500' },
  { name: 'medium', width: 500, height: 750, label: '500×750' },
  { name: 'small', width: 300, height: 450, label: '300×450' },
  { name: 'thumbnail', width: 150, height: 225, label: '150×225' },
]

export const EPISODE_SIZES: PosterSize[] = [
  { name: 'auto', width: 0, height: 0, label: 'Auto' },
  { name: 'large', width: 1920, height: 1080, label: '1920×1080' },
  { name: 'medium', width: 1280, height: 720, label: '1280×720' },
  { name: 'small', width: 640, height: 360, label: '640×360' },
  { name: 'thumbnail', width: 320, height: 180, label: '320×180' },
]

interface PosterSizeSelectorProps {
  selectedSize: string
  onSizeChange: (size: string) => void
  mediaType: 'movie' | 'show' | 'season' | 'episode'
}

function PosterSizeSelector({
  selectedSize,
  onSizeChange,
  mediaType,
}: PosterSizeSelectorProps) {
  const sizes = mediaType === 'episode' ? EPISODE_SIZES : POSTER_SIZES

  return (
    <div className="poster-size-selector">
      <select
        value={selectedSize}
        onChange={(e) => onSizeChange(e.target.value)}
        className="size-select"
        title="Preview at different sizes"
      >
        {sizes.map((size) => (
          <option key={size.name} value={size.name}>
            {size.label}
          </option>
        ))}
      </select>

      <style>{`
        .poster-size-selector {
          display: flex;
          align-items: center;
        }

        .size-select {
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          font-weight: 500;
          background-color: var(--bg-primary);
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.2s;
          min-width: 90px;
        }

        .size-select:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .size-select:focus {
          outline: none;
          box-shadow: 0 0 0 2px var(--accent-primary);
        }
      `}</style>
    </div>
  )
}

export default PosterSizeSelector
