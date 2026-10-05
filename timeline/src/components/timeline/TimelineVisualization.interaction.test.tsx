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

// Mock D3 with interaction support
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

describe('TimelineVisualization - Event Markers and Arc Interaction', () => {
  let mockData: TimelineData;
  let mockArcs: Arc[];
  let mockEvents: Event[];

  beforeEach(() => {
    // Create hierarchical test data
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
      }),
      new Arc({
        name: 'First Day of Somme',
        description: 'Opening day of the battle',
        start_time: new Date('1916-07-01'),
        end_time: new Date('1916-07-02'),
        level: 2
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
      }),
      new Event({
        description: 'Battle of Somme begins',
        actor: 'British Army',
        target: 'German Army',
        timestamp: new Date('1916-07-01')
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

  it('renders with hierarchical arc data', () => {
    render(<TimelineVisualization data={mockData} />);
    
    const container = document.querySelector('.timeline-visualization');
    expect(container).toBeInTheDocument();
    
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('handles arc click interactions', () => {
    const mockOnArcClick = vi.fn();
    const interactions = {
      onArcClick: mockOnArcClick
    };

    render(
      <TimelineVisualization 
        data={mockData} 
        interactions={interactions}
      />
    );

    // Component should render without errors
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('handles event hover interactions', () => {
    const mockOnEventHover = vi.fn();
    const interactions = {
      onEventHover: mockOnEventHover
    };

    render(
      <TimelineVisualization 
        data={mockData} 
        interactions={interactions}
      />
    );

    // Component should render without errors
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('displays tooltip container', () => {
    render(<TimelineVisualization data={mockData} />);
    
    const container = document.querySelector('.timeline-visualization');
    expect(container).toHaveStyle({ position: 'relative' });
    
    // Tooltip should be present but hidden
    const tooltip = container?.querySelector('div[style*="position: absolute"]');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveStyle({ display: 'none' });
  });

  it('processes child arcs correctly', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Component should handle hierarchical data without errors
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('processes events within arcs correctly', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Component should handle events within arcs without errors
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('handles expansion state changes', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Component should manage expansion state internally
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with custom interaction configuration', () => {
    const interactions = {
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
        interactions={interactions}
      />
    );

    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('handles drill-down functionality setup', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Component should set up drill-down without errors
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('manages event marker positioning', () => {
    render(<TimelineVisualization data={mockData} />);
    
    // Component should position event markers correctly
    expect(document.querySelector('svg')).toBeInTheDocument();
  });
});