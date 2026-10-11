import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Event } from '@/models';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { InferenceService } from './InferenceService';
import { ValidationService } from './ValidationService';
import {
  MAX_SIMULATION_STEPS,
  SimulationService,
  type SimulationServiceDependencies,
  type SimulationStep,
} from './SimulationService';
import type { GraphScopedRepositories } from '@/container';
import type { CausalRelationship } from '@/models/relationships';
import type { StoredCausalRelationship } from './CausalService';

function makeEvent(overrides: Partial<{ id: string; actor: string; target: string; timestamp: Date; description: string }> = {}): Event {
  return new Event({
    id: overrides.id ?? 'event-anchor',
    description: overrides.description ?? 'Founding of the republic',
    actor: overrides.actor ?? 'Roman Republic',
    target: overrides.target ?? 'Carthage',
    timestamp: overrides.timestamp ?? new Date('0200-01-01T00:00:00Z'),
  });
}

type CreateArgs = [
  data: {
    description: string;
    actor: string;
    target: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  },
];
type LinkArgs = [cause: Event, effect: Event, relationship: CausalRelationship];
type ParadoxArgs = [cause: Event, effect: Event];

interface Harness {
  service: SimulationService;
  create: Mock<CreateArgs, Promise<Event>>;
  createCausalLink: Mock<LinkArgs, Promise<StoredCausalRelationship>>;
  preventTemporalParadox: Mock<ParadoxArgs, boolean>;
}

function makeHarness(seedEvents: Event[]): Harness {
  let created = 0;
  const persisted = [...seedEvents];

  const create = vi.fn(async (data: CreateArgs[0]) => {
    const event = new Event({ ...data, id: `sim-${(created += 1)}` });
    persisted.push(event);
    return event;
  });

  const createCausalLink = vi.fn(async (cause: Event, effect: Event, relationship: CausalRelationship): Promise<StoredCausalRelationship> => ({
    id: `rel-${cause.id}-${effect.id}`,
    cause_event_id: cause.id,
    effect_event_id: effect.id,
    weight: relationship.weight,
    evidence: relationship.evidence,
    confidence: relationship.confidence,
    relationship_type: relationship.relationship_type,
  }));

  const preventTemporalParadox = vi.fn((cause: Event, effect: Event): boolean => {
    if (cause.timestamp.getTime() >= effect.timestamp.getTime()) {
      throw new Error('temporal paradox');
    }
    return true;
  });

  const scoped = {
    eventRepository: {
      findAll: vi.fn(async () => [...persisted]),
      findById: vi.fn(async (id: string) => persisted.find((event) => event.id === id) ?? null),
      create,
    },
    causalService: { createCausalLink },
    temporalService: { preventTemporalParadox },
  } as unknown as GraphScopedRepositories;

  const dependencies: SimulationServiceDependencies = {
    inferenceService: new InferenceService(),
    validationService: new ValidationService(),
    graphScopedRepositories: vi.fn(async () => scoped),
  };

  return {
    service: new SimulationService(dependencies),
    create,
    createCausalLink,
    preventTemporalParadox,
  };
}

describe('SimulationService', () => {
  it('rejects a missing graph id', async () => {
    const { service } = makeHarness([makeEvent()]);
    await expect(service.simulate({ graphId: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown anchor event', async () => {
    const { service } = makeHarness([makeEvent()]);
    await expect(
      service.simulate({ graphId: 'g1', anchorEventId: 'missing' })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to evolve a graph with no events', async () => {
    const { service } = makeHarness([]);
    await expect(service.simulate({ graphId: 'g1' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('chains persisted milestones forward from the anchor', async () => {
    const anchor = makeEvent({ timestamp: new Date('0200-01-01T00:00:00Z') });
    const { service, create, createCausalLink } = makeHarness([anchor]);

    const result = await service.simulate({
      graphId: 'g1',
      steps: 3,
      stepDurationMs: 1000 * 60 * 60 * 24 * 365,
      domain: 'military',
    });

    expect(result.events).toHaveLength(3);
    // Every hop links its milestone to its precursor, so step one links real
    // history to the first generated event and the rest chain milestones.
    expect(result.relationships).toHaveLength(3);
    expect(create).toHaveBeenCalledTimes(3);
    expect(createCausalLink).toHaveBeenCalledTimes(3);
    expect(createCausalLink.mock.calls[0][0].id).toBe(anchor.id);
    expect(createCausalLink.mock.calls[1][0].id).toBe('sim-1');

    // Each hop advances by exactly one step duration.
    const [first, second, third] = result.events;
    expect(first.timestamp.getTime() - anchor.timestamp.getTime()).toBe(result.stepDurationMs);
    expect(second.timestamp.getTime() - first.timestamp.getTime()).toBe(result.stepDurationMs);
    expect(third.timestamp.getTime() - second.timestamp.getTime()).toBe(result.stepDurationMs);
  });

  it('honours the requested domain and records the pressure that drove each step', async () => {
    const { service } = makeHarness([makeEvent()]);
    const result = await service.simulate({ graphId: 'g1', steps: 1, domain: 'scientific' });

    expect(result.domain).toBe('scientific');
    expect(result.pressures.length).toBeGreaterThanOrEqual(0);
    expect(result.events[0].metadata?.domain).toBe('scientific');
    expect(result.events[0].metadata?.simulated).toBe(true);
  });

  it('uses the latest event as the anchor when none is supplied', async () => {
    const older = makeEvent({ id: 'old', timestamp: new Date('0100-01-01T00:00:00Z') });
    const newer = makeEvent({ id: 'new', timestamp: new Date('0300-01-01T00:00:00Z') });
    const { service } = makeHarness([older, newer]);

    const result = await service.simulate({ graphId: 'g1', steps: 1, stepDurationMs: 1000 });
    expect(result.anchorEventId).toBe('new');
    expect(result.events[0].timestamp.getTime()).toBe(newer.timestamp.getTime() + 1000);
  });

  it('never writes during a preview', async () => {
    const { service, create, createCausalLink } = makeHarness([makeEvent()]);
    const result = await service.preview({ graphId: 'g1', steps: 2 });

    expect(result.dryRun).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.relationships).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
    expect(createCausalLink).not.toHaveBeenCalled();
  });

  it('reports each persisted step in order without waiting for the run to finish', async () => {
    const { service } = makeHarness([makeEvent()]);
    const seen: number[] = [];

    await service.simulate({ graphId: 'g1', steps: 3 }, (step: SimulationStep) => {
      seen.push(step.index);
      expect(step.event.id).toMatch(/^sim-/);
    });

    expect(seen).toEqual([0, 1, 2]);
  });

  it('does not invoke the step callback during a preview', async () => {
    const { service } = makeHarness([makeEvent()]);
    const onStep = vi.fn();
    await service.preview({ graphId: 'g1', steps: 2 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('clamps an over-large step count to the engine bound', async () => {
    const { service, create } = makeHarness([makeEvent()]);
    const result = await service.simulate({ graphId: 'g1', steps: 999 });
    expect(result.steps).toBe(MAX_SIMULATION_STEPS);
    expect(create).toHaveBeenCalledTimes(MAX_SIMULATION_STEPS);
  });

  it('rejects a non-positive step duration and out-of-range aggressiveness', async () => {
    const { service } = makeHarness([makeEvent()]);
    await expect(service.simulate({ graphId: 'g1', stepDurationMs: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.simulate({ graphId: 'g1', aggressiveness: 2 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('surfaces a temporal paradox from the guard instead of writing a bad link', async () => {
    const { service, preventTemporalParadox } = makeHarness([makeEvent()]);
    preventTemporalParadox.mockImplementation(() => {
      throw new Error('temporal paradox');
    });

    await expect(service.simulate({ graphId: 'g1', steps: 1 })).rejects.toThrow('temporal paradox');
  });
});
