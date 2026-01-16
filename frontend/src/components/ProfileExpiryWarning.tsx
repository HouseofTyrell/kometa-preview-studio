import { useState, useEffect } from 'react'

interface ProfileExpiryWarningProps {
  expiresAt: string | undefined
}

/**
 * Calculate time remaining until expiration
 */
function getTimeRemaining(expiresAt: string): {
  hours: number
  minutes: number
  isExpiringSoon: boolean
  isExpired: boolean
} {
  const expiryTime = new Date(expiresAt).getTime()
  const now = Date.now()
  const diff = expiryTime - now

  if (diff <= 0) {
    return { hours: 0, minutes: 0, isExpiringSoon: false, isExpired: true }
  }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const isExpiringSoon = hours < 2 // Less than 2 hours remaining

  return { hours, minutes, isExpiringSoon, isExpired: false }
}

/**
 * Format time remaining as a human-readable string
 */
function formatTimeRemaining(hours: number, minutes: number): string {
  if (hours === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`
  }
  if (hours < 24) {
    return `${hours}h ${minutes}m`
  }
  return `${hours} hours`
}

/**
 * ProfileExpiryWarning displays a warning when a profile is about to expire.
 * Profiles auto-expire after 24 hours to prevent data accumulation.
 */
function ProfileExpiryWarning({ expiresAt }: ProfileExpiryWarningProps) {
  const [timeRemaining, setTimeRemaining] = useState(() =>
    expiresAt ? getTimeRemaining(expiresAt) : null
  )

  useEffect(() => {
    if (!expiresAt) return

    // Update immediately
    setTimeRemaining(getTimeRemaining(expiresAt))

    // Update every minute
    const interval = setInterval(() => {
      setTimeRemaining(getTimeRemaining(expiresAt))
    }, 60000)

    return () => clearInterval(interval)
  }, [expiresAt])

  if (!expiresAt || !timeRemaining) {
    return null
  }

  if (timeRemaining.isExpired) {
    return (
      <div className="profile-expiry-warning expired">
        <span className="expiry-icon">&#9888;</span>
        <span className="expiry-text">
          This session has expired. Please upload your config again.
        </span>
      </div>
    )
  }

  // Only show warning when less than 2 hours remaining
  if (!timeRemaining.isExpiringSoon) {
    return (
      <div className="profile-expiry-info">
        <span className="expiry-icon-info">&#128337;</span>
        <span className="expiry-text-muted">
          Session expires in {formatTimeRemaining(timeRemaining.hours, timeRemaining.minutes)}
        </span>
      </div>
    )
  }

  return (
    <div className="profile-expiry-warning">
      <span className="expiry-icon">&#9888;</span>
      <span className="expiry-text">
        Session expires in {formatTimeRemaining(timeRemaining.hours, timeRemaining.minutes)}.
        {' '}Export your config to avoid losing changes.
      </span>
    </div>
  )
}

export default ProfileExpiryWarning
