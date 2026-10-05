import React, { useMemo } from 'react'
import { PressureWithContext } from '@/types/pressure'

export interface PressureConfidenceTrackerProps {
  pressure: PressureWithContext
  confidenceHistory: number[]
  onConfidenceUpdate?: (newConfidence: number) => void
  showHistory?: boolean
  className?: string
}

export const PressureConfidenceTracker: React.FC<PressureConfidenceTrackerProps> = ({
  pressure,
  confidenceHistory,
  onConfidenceUpdate,
  showHistory = true,
  className = ''
}) => {
  // Calculate confidence trend
  const confidenceTrend = useMemo(() => {
    if (confidenceHistory.length < 2) return 'stable'
    
    const recent = confidenceHistory.slice(-3)
    const trend = recent[recent.length - 1] - recent[0]
    
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

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing': return '📈'
      case 'decreasing': return '📉'
      default: return '➡️'
    }
  }

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'increasing': return 'text-green-600'
      case 'decreasing': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getVolatilityLevel = (volatility: number) => {
    if (volatility < 0.1) return { level: 'Low', color: 'text-green-600' }
    if (volatility < 0.2) return { level: 'Medium', color: 'text-yellow-600' }
    return { level: 'High', color: 'text-red-600' }
  }

  const volatilityInfo = getVolatilityLevel(confidenceStats.volatility)

  return (
    <div className={`pressure-confidence-tracker bg-white rounded-lg border border-gray-200 p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Confidence Tracking</h3>
        <div className={`flex items-center space-x-2 ${getTrendColor(confidenceTrend)}`}>
          <span className="text-lg">{getTrendIcon(confidenceTrend)}</span>
          <span className="text-sm font-medium capitalize">{confidenceTrend}</span>
        </div>
      </div>

      {/* Current Confidence */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Current Confidence</span>
          <span className="text-lg font-bold text-gray-900">
            {Math.round(pressure.confidence_score * 100)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div 
            className="bg-blue-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${pressure.confidence_score * 100}%` }}
          />
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Average</div>
          <div className="text-lg font-semibold text-gray-900">
            {Math.round(confidenceStats.average * 100)}%
          </div>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Volatility</div>
          <div className={`text-lg font-semibold ${volatilityInfo.color}`}>
            {volatilityInfo.level}
          </div>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Min</div>
          <div className="text-lg font-semibold text-gray-900">
            {Math.round(confidenceStats.min * 100)}%
          </div>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Max</div>
          <div className="text-lg font-semibold text-gray-900">
            {Math.round(confidenceStats.max * 100)}%
          </div>
        </div>
      </div>

      {/* Confidence History Chart */}
      {showHistory && confidenceHistory.length > 1 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Confidence History</h4>
          <div className="relative h-20 bg-gray-50 rounded-lg p-2">
            <svg className="w-full h-full" viewBox="0 0 300 60">
              {/* Grid lines */}
              <defs>
                <pattern id="grid" width="30" height="15" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 15" fill="none" stroke="#e5e7eb" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              
              {/* Confidence line */}
              <polyline
                fill="none"
                stroke="#3b82f6"
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
                    fill="#3b82f6"
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                )
              })}
            </svg>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Oldest</span>
            <span>Most Recent</span>
          </div>
        </div>
      )}

      {/* Update Controls */}
      {onConfidenceUpdate && (
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Update Confidence
            </label>
            <span className="text-xs text-gray-500">
              {confidenceHistory.length} updates tracked
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={pressure.confidence_score}
              onChange={(e) => onConfidenceUpdate(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm font-medium text-gray-900 min-w-[3rem]">
              {Math.round(pressure.confidence_score * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Insights */}
      {confidenceHistory.length > 2 && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-start space-x-2">
            <span className="text-blue-500 text-sm">💡</span>
            <div className="text-sm text-blue-800">
              <strong>Insight:</strong> {getConfidenceInsight(confidenceTrend, confidenceStats.volatility, confidenceHistory.length)}
            </div>
          </div>
        </div>
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