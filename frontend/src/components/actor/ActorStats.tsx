import { CalendarIcon, ChartBarIcon, UserIcon, UsersIcon } from '@heroicons/react/24/outline'
import { formatHistoricalDate } from '@/utils/historicalTime'

export interface ActorStatsData {
  eventCount: number
  timeSpan: { start: Date; end: Date } | null
  relationshipMetrics: {
    asActor: number
    asTarget: number
    uniqueTargets: number
    uniqueActors: number
  }
}

export interface ActorStatsProps {
  actor: string
  stats: ActorStatsData
  className?: string
}

export function ActorStats({ actor, stats, className = '' }: ActorStatsProps) {
  const formatDuration = (start: Date, end: Date): string => {
    const diffMs = end.getTime() - start.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffYears = Math.floor(diffDays / 365)
    const remainingDays = diffDays % 365
    const diffMonths = Math.floor(remainingDays / 30)
    const remainingDaysAfterMonths = remainingDays % 30

    if (diffYears > 0) {
      if (diffMonths > 0) {
        return `${diffYears}y ${diffMonths}m`
      }
      return `${diffYears} year${diffYears !== 1 ? 's' : ''}`
    } else if (diffMonths > 0) {
      if (remainingDaysAfterMonths > 0) {
        return `${diffMonths}m ${remainingDaysAfterMonths}d`
      }
      return `${diffMonths} month${diffMonths !== 1 ? 's' : ''}`
    } else if (diffDays > 0) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''}`
    } else {
      return 'Same day'
    }
  }

  const formatDateRange = (start: Date, end: Date): string => {
    // Historical dates: formatted in UTC so the viewer's time zone cannot
    // move them to a neighbouring day.
    const startStr = formatHistoricalDate(start, 'en-US')
    const endStr = formatHistoricalDate(end, 'en-US')
    
    if (startStr === endStr) {
      return startStr
    }
    
    return `${startStr} - ${endStr}`
  }

  const calculateActivityRate = (): string => {
    if (!stats.timeSpan || stats.eventCount === 0) return '0'
    
    const diffMs = stats.timeSpan.end.getTime() - stats.timeSpan.start.getTime()
    const diffDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
    const rate = stats.eventCount / diffDays
    
    if (rate >= 1) {
      return rate.toFixed(1)
    } else if (rate >= 0.1) {
      return rate.toFixed(2)
    } else {
      return rate.toFixed(3)
    }
  }

  return (
    <div className={`bg-gray-50 rounded-lg p-4 ${className}`}>
      <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
        <ChartBarIcon className="h-4 w-4 mr-2 text-gray-500" />
        Statistics for {actor}
      </h4>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Events */}
        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.eventCount}</p>
              <p className="text-xs text-gray-600">Total Events</p>
            </div>
            <div className="p-2 bg-blue-100 rounded-lg">
              <CalendarIcon className="h-4 w-4 text-blue-600" />
            </div>
          </div>
        </div>

        {/* Time Span */}
        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {stats.timeSpan ? formatDuration(stats.timeSpan.start, stats.timeSpan.end) : 'N/A'}
              </p>
              <p className="text-xs text-gray-600">Time Span</p>
              {stats.timeSpan && (
                <p className="text-xs text-gray-500 mt-1">
                  {formatDateRange(stats.timeSpan.start, stats.timeSpan.end)}
                </p>
              )}
            </div>
            <div className="p-2 bg-green-100 rounded-lg">
              <ChartBarIcon className="h-4 w-4 text-green-600" />
            </div>
          </div>
        </div>

        {/* Activity Rate */}
        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">{calculateActivityRate()}</p>
              <p className="text-xs text-gray-600">Events/Day</p>
            </div>
            <div className="p-2 bg-purple-100 rounded-lg">
              <ChartBarIcon className="h-4 w-4 text-purple-600" />
            </div>
          </div>
        </div>

        {/* Role Distribution */}
        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex space-x-2 text-sm">
                <span className="text-blue-600 font-semibold">{stats.relationshipMetrics.asActor}</span>
                <span className="text-gray-400">/</span>
                <span className="text-green-600 font-semibold">{stats.relationshipMetrics.asTarget}</span>
              </div>
              <p className="text-xs text-gray-600">Actor / Target</p>
            </div>
            <div className="p-2 bg-orange-100 rounded-lg">
              <UserIcon className="h-4 w-4 text-orange-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Relationship Details */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <h5 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
            <UserIcon className="h-4 w-4 mr-1 text-blue-600" />
            As Actor
          </h5>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Events:</span>
              <span className="font-medium">{stats.relationshipMetrics.asActor}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Unique Targets:</span>
              <span className="font-medium">{stats.relationshipMetrics.uniqueTargets}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Avg per Target:</span>
              <span className="font-medium">
                {stats.relationshipMetrics.uniqueTargets > 0 
                  ? (stats.relationshipMetrics.asActor / stats.relationshipMetrics.uniqueTargets).toFixed(1)
                  : '0'
                }
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <h5 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
            <UsersIcon className="h-4 w-4 mr-1 text-green-600" />
            As Target
          </h5>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Events:</span>
              <span className="font-medium">{stats.relationshipMetrics.asTarget}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Unique Actors:</span>
              <span className="font-medium">{stats.relationshipMetrics.uniqueActors}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Avg per Actor:</span>
              <span className="font-medium">
                {stats.relationshipMetrics.uniqueActors > 0 
                  ? (stats.relationshipMetrics.asTarget / stats.relationshipMetrics.uniqueActors).toFixed(1)
                  : '0'
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Distribution */}
      {stats.relationshipMetrics.asActor > 0 && stats.relationshipMetrics.asTarget > 0 && (
        <div className="mt-4 bg-white rounded-lg p-3 border border-gray-200">
          <h5 className="text-sm font-medium text-gray-900 mb-2">Activity Distribution</h5>
          <div className="flex h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="bg-blue-500 transition-all duration-300"
              style={{ 
                width: `${(stats.relationshipMetrics.asActor / stats.eventCount) * 100}%` 
              }}
              title={`${((stats.relationshipMetrics.asActor / stats.eventCount) * 100).toFixed(1)}% as Actor`}
            />
            <div 
              className="bg-green-500 transition-all duration-300"
              style={{ 
                width: `${(stats.relationshipMetrics.asTarget / stats.eventCount) * 100}%` 
              }}
              title={`${((stats.relationshipMetrics.asTarget / stats.eventCount) * 100).toFixed(1)}% as Target`}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-600">
            <span className="flex items-center">
              <div className="w-2 h-2 bg-blue-500 rounded-full mr-1"></div>
              Actor ({((stats.relationshipMetrics.asActor / stats.eventCount) * 100).toFixed(1)}%)
            </span>
            <span className="flex items-center">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
              Target ({((stats.relationshipMetrics.asTarget / stats.eventCount) * 100).toFixed(1)}%)
            </span>
          </div>
        </div>
      )}
    </div>
  )
}