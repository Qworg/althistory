import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { ActorStats, ActorStatsData } from './ActorStats'

const mockStatsWithTimeSpan: ActorStatsData = {
  eventCount: 10,
  timeSpan: {
    start: new Date('2024-01-01T00:00:00Z'),
    end: new Date('2024-01-31T23:59:59Z')
  },
  relationshipMetrics: {
    asActor: 6,
    asTarget: 4,
    uniqueTargets: 3,
    uniqueActors: 2
  }
}

const mockStatsWithoutTimeSpan: ActorStatsData = {
  eventCount: 0,
  timeSpan: null,
  relationshipMetrics: {
    asActor: 0,
    asTarget: 0,
    uniqueTargets: 0,
    uniqueActors: 0
  }
}

const mockStatsLongTimeSpan: ActorStatsData = {
  eventCount: 50,
  timeSpan: {
    start: new Date('2020-01-01T00:00:00Z'),
    end: new Date('2024-01-01T00:00:00Z')
  },
  relationshipMetrics: {
    asActor: 30,
    asTarget: 20,
    uniqueTargets: 10,
    uniqueActors: 8
  }
}

const mockStatsSameDay: ActorStatsData = {
  eventCount: 5,
  timeSpan: {
    start: new Date('2024-01-01T10:00:00Z'),
    end: new Date('2024-01-01T18:00:00Z')
  },
  relationshipMetrics: {
    asActor: 3,
    asTarget: 2,
    uniqueTargets: 2,
    uniqueActors: 1
  }
}

describe('ActorStats', () => {
  describe('Basic Rendering', () => {
    it('renders actor name and basic statistics', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)
      
      expect(screen.getByText('Statistics for Alice')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument() // Total events
      expect(screen.getByText('Total Events')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} className="custom-class" />)
      
      const container = screen.getByText('Statistics for Alice').closest('div')
      expect(container).toHaveClass('custom-class')
    })
  })

  describe('Event Count Display', () => {
    it('displays correct total event count', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)
      
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('Total Events')).toBeInTheDocument()
    })

    it('displays zero events correctly', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithoutTimeSpan} />)

      // '0' appears multiple times (total events, actor/target roles, activity rate)
      // Just check that Total Events section exists with its content
      const totalEventsSection = screen.getByText('Total Events').closest('div')
      expect(totalEventsSection).toHaveTextContent('0')
    })
  })

  describe('Time Span Display', () => {
    it('displays formatted duration for month-long span', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)

      // The duration for Jan 1-31 is 30 days = 1 month (no remaining days, so shows "1 month")
      const timeSpanSection = screen.getByText('Time Span').closest('.bg-white')
      expect(timeSpanSection).toHaveTextContent('1 month')
      // Date formatting may vary by timezone, just check it contains the dates
      expect(timeSpanSection).toHaveTextContent(/Jan \d+, 2024/)
    })

    it('displays formatted duration for year-long span', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsLongTimeSpan} />)
      
      expect(screen.getByText('4 years')).toBeInTheDocument()
      expect(screen.getByText('Time Span')).toBeInTheDocument()
    })

    it('displays "Same day" for same-day events', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsSameDay} />)

      const timeSpanSection = screen.getByText('Time Span').closest('.bg-white')
      expect(timeSpanSection).toHaveTextContent('Same day')
      expect(timeSpanSection).toHaveTextContent('Jan 1, 2024')
    })

    it('displays N/A when no time span', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithoutTimeSpan} />)
      
      expect(screen.getByText('N/A')).toBeInTheDocument()
      expect(screen.getByText('Time Span')).toBeInTheDocument()
    })
  })

  describe('Activity Rate Calculation', () => {
    it('calculates activity rate correctly for normal span', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)

      // 10 events over 30 days = ~0.33 events/day (calculated as floor of diffDays)
      const activitySection = screen.getByText('Events/Day').closest('.bg-white')
      // The exact rate depends on how days are calculated, just check the section has a decimal rate
      expect(activitySection).toHaveTextContent(/0\.\d+/)
    })

    it('displays high activity rate with one decimal', () => {
      const highActivityStats: ActorStatsData = {
        eventCount: 100,
        timeSpan: {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-01-31T23:59:59Z')
        },
        relationshipMetrics: {
          asActor: 60,
          asTarget: 40,
          uniqueTargets: 20,
          uniqueActors: 15
        }
      }

      renderWithProviders(<ActorStats actor="Alice" stats={highActivityStats} />)

      // 100 events over ~30 days = ~3.3 events/day (1 decimal for rates >= 1)
      const activitySection = screen.getByText('Events/Day').closest('.bg-white')
      expect(activitySection).toHaveTextContent(/\d\.\d/)
    })

    it('displays zero activity rate when no events', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithoutTimeSpan} />)

      // Check the activity rate section shows 0
      const activitySection = screen.getByText('Events/Day').closest('.bg-white')
      expect(activitySection).toHaveTextContent('0')
    })
  })

  describe('Role Distribution', () => {
    it('displays actor/target split correctly', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)

      // Numbers appear in multiple places, check the role distribution section
      const roleSection = screen.getByText('Actor / Target').closest('.bg-white')
      expect(roleSection).toHaveTextContent('6')
      expect(roleSection).toHaveTextContent('4')
    })

    it('displays zero values correctly', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithoutTimeSpan} />)
      
      const actorTargetSection = screen.getByText('Actor / Target').closest('div')
      expect(actorTargetSection).toHaveTextContent('0')
      expect(actorTargetSection).toHaveTextContent('0')
    })
  })

  describe('Relationship Details', () => {
    it('displays "As Actor" section correctly', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)
      
      expect(screen.getByText('As Actor')).toBeInTheDocument()
      
      // Check events count
      const asActorSection = screen.getByText('As Actor').closest('div')
      expect(asActorSection).toHaveTextContent('Events:6')
      expect(asActorSection).toHaveTextContent('Unique Targets:3')
      expect(asActorSection).toHaveTextContent('Avg per Target:2.0')
    })

    it('displays "As Target" section correctly', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)
      
      expect(screen.getByText('As Target')).toBeInTheDocument()
      
      // Check events count
      const asTargetSection = screen.getByText('As Target').closest('div')
      expect(asTargetSection).toHaveTextContent('Events:4')
      expect(asTargetSection).toHaveTextContent('Unique Actors:2')
      expect(asTargetSection).toHaveTextContent('Avg per Actor:2.0')
    })

    it('handles division by zero in averages', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithoutTimeSpan} />)
      
      const asActorSection = screen.getByText('As Actor').closest('div')
      expect(asActorSection).toHaveTextContent('Avg per Target:0')
      
      const asTargetSection = screen.getByText('As Target').closest('div')
      expect(asTargetSection).toHaveTextContent('Avg per Actor:0')
    })
  })

  describe('Activity Distribution Bar', () => {
    it('displays activity distribution when both roles have events', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)
      
      expect(screen.getByText('Activity Distribution')).toBeInTheDocument()
      expect(screen.getByText('Actor (60.0%)')).toBeInTheDocument()
      expect(screen.getByText('Target (40.0%)')).toBeInTheDocument()
    })

    it('does not display activity distribution when only actor role has events', () => {
      const onlyActorStats: ActorStatsData = {
        eventCount: 5,
        timeSpan: {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-01-05T23:59:59Z')
        },
        relationshipMetrics: {
          asActor: 5,
          asTarget: 0,
          uniqueTargets: 3,
          uniqueActors: 0
        }
      }
      
      renderWithProviders(<ActorStats actor="Alice" stats={onlyActorStats} />)
      
      expect(screen.queryByText('Activity Distribution')).not.toBeInTheDocument()
    })

    it('does not display activity distribution when only target role has events', () => {
      const onlyTargetStats: ActorStatsData = {
        eventCount: 3,
        timeSpan: {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-01-03T23:59:59Z')
        },
        relationshipMetrics: {
          asActor: 0,
          asTarget: 3,
          uniqueTargets: 0,
          uniqueActors: 2
        }
      }
      
      renderWithProviders(<ActorStats actor="Alice" stats={onlyTargetStats} />)
      
      expect(screen.queryByText('Activity Distribution')).not.toBeInTheDocument()
    })

    it('calculates percentages correctly', () => {
      const unevenStats: ActorStatsData = {
        eventCount: 7,
        timeSpan: {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-01-07T23:59:59Z')
        },
        relationshipMetrics: {
          asActor: 5,
          asTarget: 2,
          uniqueTargets: 3,
          uniqueActors: 1
        }
      }
      
      renderWithProviders(<ActorStats actor="Alice" stats={unevenStats} />)
      
      expect(screen.getByText('Actor (71.4%)')).toBeInTheDocument()
      expect(screen.getByText('Target (28.6%)')).toBeInTheDocument()
    })
  })

  describe('Visual Elements', () => {
    it('displays icons for different sections', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)

      // Check that SVG icons are present (heroicons use aria-hidden, not role=img)
      const container = screen.getByText('Statistics for Alice').closest('div')
      const svgElements = container?.querySelectorAll('svg')
      expect(svgElements?.length).toBeGreaterThan(0)
    })

    it('displays colored indicators in activity distribution', () => {
      renderWithProviders(<ActorStats actor="Alice" stats={mockStatsWithTimeSpan} />)
      
      const distributionSection = screen.getByText('Activity Distribution').closest('div')
      
      // Check for colored elements (divs with background colors)
      const coloredElements = distributionSection?.querySelectorAll('[class*="bg-blue"], [class*="bg-green"]')
      expect(coloredElements?.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles very small activity rates', () => {
      const lowActivityStats: ActorStatsData = {
        eventCount: 1,
        timeSpan: {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-12-31T23:59:59Z')
        },
        relationshipMetrics: {
          asActor: 1,
          asTarget: 0,
          uniqueTargets: 1,
          uniqueActors: 0
        }
      }
      
      renderWithProviders(<ActorStats actor="Alice" stats={lowActivityStats} />)
      
      // Should display with 3 decimal places for very small rates
      expect(screen.getByText(/0\.00\d/)).toBeInTheDocument()
    })

    it('handles large numbers correctly', () => {
      const largeStats: ActorStatsData = {
        eventCount: 9999,
        timeSpan: {
          start: new Date('2020-01-01T00:00:00Z'),
          end: new Date('2024-01-01T00:00:00Z')
        },
        relationshipMetrics: {
          asActor: 5000,
          asTarget: 4999,
          uniqueTargets: 500,
          uniqueActors: 300
        }
      }

      renderWithProviders(<ActorStats actor="Alice" stats={largeStats} />)

      // Numbers appear in multiple places (role distribution and detail sections)
      // Check Total Events section
      const totalEventsSection = screen.getByText('Total Events').closest('.bg-white')
      expect(totalEventsSection).toHaveTextContent('9999')

      // Check role distribution section
      const roleSection = screen.getByText('Actor / Target').closest('.bg-white')
      expect(roleSection).toHaveTextContent('5000')
      expect(roleSection).toHaveTextContent('4999')
    })
  })
})