import React, { useId, useMemo } from 'react'
import { ArrowRightIcon, ArrowTrendingDownIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline'
import { PressureWithContext } from '@/types/pressure'

export interface PressureConfidenceTrackerProps {
  pressure: PressureWithContext
  confidenceHistory: number[]
  onConfidenceUpdate?: (newConfidence: number) => void
  showHistory?: boolean
  className?: string
}

type Trend = 'increasing' | 'decreasing' | 'stable'

const TREND_ICON: Record<Trend, typeof ArrowRightIcon> = {
  increasing: ArrowTrendingUpIcon,
  decreasing: ArrowTrendingDownIcon,
  stable: ArrowRightIcon,
}

/** Confidence on the 0–1 scale the rest of the Timeline view uses. */
const formatScore = (score: number): string => score.toFixed(2)

export const PressureConfidenceTracker: React.FC<PressureConfidenceTrackerProps> = ({
  pressure,
  confidenceHistory,
  onConfidenceUpdate,
  showHistory = true,
  className = ''
}) => {
  // Calculate confidence trend
  const confidenceTrend = useMemo((): Trend => {
    if (confidenceHistory.length < 2) return 'stable'
    
    const recent = confidenceHistory.slice(-3)
    const firstValue = recent[0]
    const lastValue = recent[recent.length - 1]
    if (firstValue === undefined || lastValue === undefined) return 'stable'
    
    const trend = lastValue - firstValue
    
    if (trend > 0.1) return 'increasing'
    if (trend < -0.1) return 'decreasing'
    return 'stable'
  }, [confidenceHistory])

  // Calculate confidence statistics
  const confidenceStats = useMemo(() => {
    if (confidenceHistory.length === 0) {
      return {
        average: pressure.confidence_score,
        min: pressure.confidence_score,
        max: pressure.confidence_score,
        volatility: 0
      }
    }

    const average = confidenceHistory.reduce((sum, conf) => sum + conf, 0) / confidenceHistory.length
    const min = Math.min(...confidenceHistory)
    const max = Math.max(...confidenceHistory)
    
    // Calculate volatility as standard deviation
    const variance = confidenceHistory.reduce((sum, conf) => sum + Math.pow(conf - average, 2), 0) / confidenceHistory.length
    const volatility = Math.sqrt(variance)

    return { average, min, max, volatility }
  }, [confidenceHistory, pressure.confidence_score])

  // Volatility is named, not coloured: a green "Low" was 2.8:1 on white and the
  // word already says it.
  const getVolatilityLevel = (volatility: number) => {
    if (volatility < 0.1) return 'Low'
    if (volatility < 0.2) return 'Medium'
    return 'High'
  }

  const volatilityInfo = getVolatilityLevel(confidenceStats.volatility)
  const TrendIcon = TREND_ICON[confidenceTrend]
  const sliderId = useId()

  return (
    <div className={`pressure-confidence-tracker ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-base font-semibold text-ink">Confidence Tracking</h4>
        <div className="flex items-center gap-1.5 text-ink-secondary" data-trend={confidenceTrend}>
          <TrendIcon className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium capitalize">{confidenceTrend}</span>
        </div>
      </div>

      {/* Current Confidence */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ink-secondary">Current Confidence</span>
          <span className="font-mono-code text-base font-semibold text-ink">
            {formatScore(pressure.confidence_score)}
          </span>
        </div>
        <div className="w-full bg-subtle rounded-full h-2">
          <div
            className="bg-baseline h-2 rounded-full transition-all duration-300"
            style={{ width: `${pressure.confidence_score * 100}%` }}
          />
        </div>
      </div>

      {/* Statistics: one row of label/value pairs, not a grid of tiles */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-4 text-sm">
        <div data-stat="average">
          <dt className="text-xs font-medium text-ink-muted">Average</dt>
          <dd className="font-mono-code text-ink">{formatScore(confidenceStats.average)}</dd>
        </div>
        <div data-stat="volatility">
          <dt className="text-xs font-medium text-ink-muted">Volatility</dt>
          <dd className="text-ink">{volatilityInfo}</dd>
        </div>
        <div data-stat="min">
          <dt className="text-xs font-medium text-ink-muted">Min</dt>
          <dd className="font-mono-code text-ink">{formatScore(confidenceStats.min)}</dd>
        </div>
        <div data-stat="max">
          <dt className="text-xs font-medium text-ink-muted">Max</dt>
          <dd className="font-mono-code text-ink">{formatScore(confidenceStats.max)}</dd>
        </div>
      </dl>

      {/* Confidence History Chart */}
      {showHistory && confidenceHistory.length > 1 && (
        <div className="mb-4">
          <p className="text-sm font-medium text-ink-secondary mb-2">Confidence History</p>
          <div className="relative h-20 bg-subtle rounded-md p-2">
            <svg className="w-full h-full" viewBox="0 0 300 60" aria-hidden="true">
              {/* Confidence line */}
              <polyline
                fill="none"
                stroke="var(--accent-baseline)"
                strokeWidth="2"
                points={confidenceHistory.map((conf, index) => {
                  const x = (index / (confidenceHistory.length - 1)) * 280 + 10
                  const y = 50 - (conf * 40)
                  return `${x},${y}`
                }).join(' ')}
              />

              {/* Data points */}
              {confidenceHistory.map((conf, index) => {
                const x = (index / (confidenceHistory.length - 1)) * 280 + 10
                const y = 50 - (conf * 40)
                return (
                  <circle
                    key={index}
                    cx={x}
                    cy={y}
                    r="3"
                    fill="var(--accent-baseline)"
                    stroke="var(--surface-card)"
                    strokeWidth="1"
                  />
                )
              })}
            </svg>
          </div>
          <div className="flex justify-between text-xs text-ink-muted mt-1">
            <span>Oldest</span>
            <span>Most Recent</span>
          </div>
        </div>
      )}

      {/* Update Controls */}
      {onConfidenceUpdate && (
        <div className="border-t border-line pt-4">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor={sliderId} className="text-sm font-medium text-ink-secondary">
              Update Confidence
            </label>
            <span className="text-xs text-ink-muted">
              {confidenceHistory.length} updates tracked
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <input
              id={sliderId}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={pressure.confidence_score}
              onChange={(e) => onConfidenceUpdate(parseFloat(e.target.value))}
              className="flex-1 cursor-pointer accent-[var(--accent-baseline)]"
            />
            <span className="font-mono-code text-sm text-ink min-w-[3rem] text-right">
              {formatScore(pressure.confidence_score)}
            </span>
          </div>
        </div>
      )}

      {/* Insights */}
      {confidenceHistory.length > 2 && (
        <p className="mt-4 text-sm text-ink-secondary">
          <strong className="font-semibold text-ink">Insight:</strong> {getConfidenceInsight(confidenceTrend, confidenceStats.volatility, confidenceHistory.length)}
        </p>
      )}
    </div>
  )
}

function getConfidenceInsight(trend: string, volatility: number, historyLength: number): string {
  if (trend === 'increasing' && volatility < 0.1) {
    return `Confidence is steadily increasing with low volatility. This suggests strengthening evidence over ${historyLength} updates.`
  }
  
  if (trend === 'decreasing' && volatility < 0.1) {
    return `Confidence is steadily decreasing with low volatility. Consider reviewing the evidence quality.`
  }
  
  if (volatility > 0.2) {
    return `High volatility detected in confidence scores. This may indicate conflicting or uncertain evidence.`
  }
  
  if (trend === 'stable' && volatility < 0.1) {
    return `Confidence remains stable with low volatility, indicating consistent evidence quality.`
  }
  
  return `Confidence pattern shows ${trend} trend with ${volatility > 0.15 ? 'high' : 'moderate'} volatility over ${historyLength} updates.`
}

export default PressureConfidenceTracker