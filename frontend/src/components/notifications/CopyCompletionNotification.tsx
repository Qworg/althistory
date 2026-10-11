import React, { useEffect, useState, useCallback } from 'react'
import { CopyOperation } from '@/types'

interface CopyCompletionNotificationProps {
  operation: CopyOperation
  onSwitchToGraph?: (graphName: string) => void
  onDismiss: () => void
  autoHideDelay?: number
}

export const CopyCompletionNotification: React.FC<CopyCompletionNotificationProps> = ({
  operation,
  onSwitchToGraph,
  onDismiss,
  autoHideDelay = 10000 // 10 seconds
}) => {
  const [isVisible, setIsVisible] = useState(true)
  const [progress, setProgress] = useState(100)

  const handleDismiss = useCallback(() => {
    setIsVisible(false)
    setTimeout(onDismiss, 300) // Allow fade out animation
  }, [onDismiss])

  useEffect(() => {
    if (autoHideDelay > 0) {
      const interval = setInterval(() => {
        setProgress(prev => {
          const newProgress = prev - (100 / (autoHideDelay / 100))
          if (newProgress <= 0) {
            clearInterval(interval)
            handleDismiss()
            return 0
          }
          return newProgress
        })
      }, 100)

      return () => clearInterval(interval)
    }
  }, [autoHideDelay, handleDismiss])

  const handleSwitchToGraph = () => {
    if (onSwitchToGraph) {
      onSwitchToGraph(operation.name)
    }
    handleDismiss()
  }

  const getNotificationStyle = () => {
    if (operation.status === 'completed') {
      return {
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        iconColor: 'text-green-600',
        titleColor: 'text-green-800',
        textColor: 'text-green-700'
      }
    } else if (operation.status === 'failed') {
      return {
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        iconColor: 'text-red-600',
        titleColor: 'text-red-800',
        textColor: 'text-red-700'
      }
    } else {
      return {
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        iconColor: 'text-blue-600',
        titleColor: 'text-blue-800',
        textColor: 'text-blue-700'
      }
    }
  }

  const getIcon = () => {
    if (operation.status === 'completed') {
      return (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    } else if (operation.status === 'failed') {
      return (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    } else {
      return (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  }

  const getTitle = () => {
    if (operation.status === 'completed') {
      return 'Copy Completed Successfully'
    } else if (operation.status === 'failed') {
      return 'Copy Failed'
    } else {
      return 'Copy Status Update'
    }
  }

  const getMessage = () => {
    const copyType = operation.type.replace('_', ' ')
    
    if (operation.status === 'completed') {
      return `Your ${copyType} copy "${operation.name}" has been created successfully.`
    } else if (operation.status === 'failed') {
      return `Your ${copyType} copy "${operation.name}" failed to complete. ${operation.error_message || 'Please try again.'}`
    } else {
      return `Your ${copyType} copy "${operation.name}" is ${operation.status.replace('_', ' ')}.`
    }
  }

  const styles = getNotificationStyle()

  if (!isVisible) return null

  return (
    <div className={`
      fixed top-4 right-4 z-50 max-w-md w-full
      ${styles.bgColor} ${styles.borderColor} border rounded-lg shadow-lg
      transform transition-all duration-300 ease-in-out
      ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
    `}>
      {/* Progress bar */}
      {autoHideDelay > 0 && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gray-200 rounded-t-lg overflow-hidden">
          <div 
            className="h-full bg-gray-400 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start">
          <div className={`flex-shrink-0 ${styles.iconColor}`}>
            {getIcon()}
          </div>
          
          <div className="ml-3 flex-1">
            <h3 className={`text-sm font-medium ${styles.titleColor}`}>
              {getTitle()}
            </h3>
            <p className={`mt-1 text-sm ${styles.textColor}`}>
              {getMessage()}
            </p>
            
            {/* Operation details */}
            <div className={`mt-2 text-xs ${styles.textColor} opacity-75`}>
              <div>Type: {operation.type.replace('_', ' ')}</div>
              {operation.completed_at && (
                <div>Completed: {new Date(operation.completed_at).toLocaleString()}</div>
              )}
              {operation.parameters.timeRange && (
                <div>
                  Range: {new Date(operation.parameters.timeRange.start).toLocaleDateString()} - {new Date(operation.parameters.timeRange.end).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex space-x-2">
              {operation.status === 'completed' && onSwitchToGraph && (
                <button
                  onClick={handleSwitchToGraph}
                  className={`text-xs font-medium ${styles.titleColor} hover:underline`}
                >
                  Switch to Graph
                </button>
              )}
              
              <button
                onClick={handleDismiss}
                className={`text-xs font-medium ${styles.textColor} hover:underline`}
              >
                Dismiss
              </button>
            </div>
          </div>

          <div className="ml-4 flex-shrink-0">
            <button
              onClick={handleDismiss}
              className={`inline-flex ${styles.textColor} hover:${styles.titleColor} transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}