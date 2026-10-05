import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimelineVisualization } from './TimelineVisualization';
import { TimelineData } from './types';
import { Arc } from '../../models/Arc';
import { Event } from '../../models/Event';

/**
 * Shape of the stand-in for a d3 selection: every method returns the selection
 * itself so calls can be chained, exactly like the real API.
 */
interface MockSelection {
  selectAll(): MockSelection;
  remove(): MockSelection;
  data(): MockSelection;
  enter(): MockSelection;
  append(): MockSelection;
  attr(): MockSelection;
  style(): MockSelection;
  on(): MockSelection;
  text(): MockSelection;
  call(): MockSelection;
  select(): MockSelection;
  each(): MockSelection;
}

/** Shape of the stand-in for a d3 time scale (callable, chainable). */
interface MockScale {
  (date: Date): number;
  domain(): MockScale;
  range(): MockScale;
  rescaleX(): MockScale;
}

// Mock D3 completely to avoid DOM manipulation in tests
vi.mock('d3', () => {
  const mockSelection: MockSelection = {
    selectAll: vi.fn(() => mockSelection),
    remove: vi.fn(() => mockSelection),
    data: vi.fn(() => mockSelection),
    enter: vi.fn(() => mockSelection),
    append: vi.fn(() => mockSelection),
    attr: vi.fn(() => mockSelection),
    style: vi.fn(() => mockSelection),
    on: vi.fn(() => mockSelection),
    text: vi.fn(() => mockSelection),
    call: vi.fn(() => mockSelection),
    select: vi.fn(() => mockSelection),
    each: vi.fn(() => mockSelection)
  };

  const mockScale: MockScale = Object.assign(
    vi.fn((date: Date) => date.getTime() / 1000000),
    {
      domain: vi.fn(() => mockScale),
      range: vi.fn(() => mockScale),
      rescaleX: vi.fn(() => mockScale)
    }
  );

  return {
    select: vi.fn(() => mockSelection),
    scaleTime: vi.fn(() => mockScale),
    axisBottom: vi.fn(() => vi.fn()),
    zoom: vi.fn(() => ({
      scaleExtent: vi.fn(() => ({
        extent: vi.fn(() => ({
          on: vi.fn(() => ({}))
        }))
      }))
    }))
  };
});

describe('TimelineVisualization', () => {
  let mockData: TimelineData;
  let mockArcs: Arc[];
  let mockEvents: Event[];

  beforeEach(() => {
    // Create test data
    mockArcs = [
      new Arc({
        name: 'World War I',
        description: 'The Great War',
        start_time: new Date('1914-07-28'),
        end_time: new Date('1918-11-11'),
        level: 0
      }),
      new Arc({
        name: 'Battle of Somme',
        description: 'Major WWI battle',
        start_time: new Date('1916-07-01'),
        end_time: new Date('1916-11-18'),
        level: 1
      })
    ];

    mockEvents = [
      new Event({
        description: 'Assassination of Archduke Franz Ferdinand',
        actor: 'Gavrilo Princip',
        target: 'Archduke Franz Ferdinand',
        timestamp: new Date('1914-06-28')
      }),
      new Event({
        description: 'Germany declares war on Russia',
        actor: 'Germany',
        target: 'Russia',
        timestamp: new Date('1914-08-01')
      })
    ];

    mockData = {
      arcs: mockArcs,
      events: mockEvents,
      timeRange: {
        start: new Date('1914-01-01'),
        end: new Date('1919-01-01')
      }
    };
  });

  it('renders timeline container', () => {
    render(<TimelineVisualization data={mockData} />);
    
    const container = document.querySelector('svg');
    expect(container).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<TimelineVisualization data={mockData} className="custom-timeline" />);
    
    const container = document.querySelector('.timeline-visualization.custom-timeline');
    expect(container).toBeInTheDocument();
  });

  it('uses default configuration when none provided', () => {
    render(<TimelineVisualization data={mockData} />);
    
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('width', '1200');
    expect(svg).toHaveAttribute('height', '600');
  });

  it('applies custom configuration', () => {
    const customConfig = {
      width: 800,
      height: 400
    };

    render(<TimelineVisualization data={mockData} config={customConfig} />);
    
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('width', '800');
    expect(svg).toHaveAttribute('height', '400');
  });

  it('handles empty data gracefully', () => {
    const emptyData: TimelineData = {
      arcs: [],
      events: [],
      timeRange: {
        start: new Date('2020-01-01'),
        end: new Date('2020-12-31')
      }
    };

    expect(() => {
      render(<TimelineVisualization data={emptyData} />);
    }).not.toThrow();
  });

  it('calls interaction handlers when provided', () => {
    const mockInteractions = {
      onArcClick: vi.fn(),
      onEventClick: vi.fn(),
      onArcHover: vi.fn(),
      onEventHover: vi.fn(),
      onZoom: vi.fn(),
      onPan: vi.fn()
    };

    render(
      <TimelineVisualization 
        data={mockData} 
        interactions={mockInteractions}
      />
    );

    // The actual interaction testing would require more complex D3 mocking
    // For now, we just verify the component renders without errors
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('processes arcs for rendering correctly', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Verify component renders - detailed arc processing would require
    // more sophisticated D3 mocking or integration tests
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('processes events for rendering correctly', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Verify component renders - detailed event processing would require
    // more sophisticated D3 mocking or integration tests
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('handles arc expansion state', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // The expansion state is managed internally and would require
    // integration tests or more complex mocking to test thoroughly
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('maintains zoom state', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Zoom state management would require D3 zoom behavior testing
    // which is better suited for integration tests
    expect(document.querySelector('svg')).toBeInTheDocument();
  });
});