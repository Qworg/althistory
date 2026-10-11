import { Event, InferredPressure, PressureType } from '@/models';
import { CausalRelationship } from '@/models/relationships';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { InferenceService } from './InferenceService';
import { ValidationService } from './ValidationService';
import type { StoredCausalRelationship } from './CausalService';
import type { GraphScopedRepositories } from '@/container';

/**
 * Domains the simulation engine can evolve a timeline through.
 *
 * Wider than `PressureType` because a counterfactual forward-evolution is
 * usually framed around military or scientific developments, neither of which
 * the pressure model names directly. `pressureTypeFor` maps each domain onto
 * the pressure signal the existing `InferenceService` actually infers, so the
 * simulation reads real signals rather than inventing a parallel taxonomy.
 */
export type SimulationDomain =
  | 'political'
  | 'military'
  | 'economic'
  | 'scientific'
  | 'social'
  | 'environmental';

/** Default forward hop when a caller does not name a step duration. */
export const DEFAULT_SIMULATION_STEP_MS = 365 * 24 * 60 * 60 * 1000;

/** Hard bounds, so a request cannot ask the engine to run away. */
export const MIN_SIMULATION_STEPS = 1;
export const MAX_SIMULATION_STEPS = 10;

const SIMULATION_DOMAINS: readonly SimulationDomain[] = [
  'political',
  'military',
  'economic',
  'scientific',
  'social',
  'environmental',
];

/** Runtime guard for a domain arriving from an untyped request body. */
export function isSimulationDomain(value: unknown): value is SimulationDomain {
  return typeof value === 'string' && (SIMULATION_DOMAINS as readonly string[]).includes(value);
}

/** Map a simulation domain onto the pressure signal it is driven by. */
const DOMAIN_PRESSURE: Record<SimulationDomain, PressureType> = {
  political: 'political',
  military: 'political',
  economic: 'economic',
  scientific: 'economic',
  social: 'social',
  environmental: 'environmental',
};

/** Domain-specific sentence frames used to describe a synthesised milestone. */
const DOMAIN_TEMPLATES: Record<SimulationDomain, (actor: string, target: string) => string> = {
  political: (actor, target) =>
    `${actor} consolidates political control over ${target} as rival factions are marginalised`,
  military: (actor, target) =>
    `${actor} mobilises armed forces against ${target}, escalating a regional confrontation`,
  economic: (actor, target) =>
    `${actor} restructures trade and industry with ${target}, redirecting the flow of resources`,
  scientific: (actor, target) =>
    `${actor} achieves a technological breakthrough that reshapes its standing with ${target}`,
  social: (actor, target) =>
    `${actor} undergoes sweeping social change that redefines its relationship with ${target}`,
  environmental: (actor, target) =>
    `${actor} is forced to adapt as environmental pressures reshape its dealings with ${target}`,
};

/** How aggressively the engine should push each forward step. */
export const MIN_AGGRESSIVENESS = 0;
export const MAX_AGGRESSIVENESS = 1;
const DEFAULT_AGGRESSIVENESS = 0.5;

export interface SimulationRequest {
  /** Graph whose history is being evolved forward. */
  graphId: string;
  /**
   * Point of divergence. When omitted the latest event in the graph is used as
   * the anchor, so the engine always starts from real history.
   */
  anchorEventId?: string;
  /** Number of discrete forward hops. Clamped to [1, 10]. */
  steps?: number;
  /** Wall-clock span of each hop. Defaults to one year. */
  stepDurationMs?: number;
  /** Dominant domain to evolve. When omitted the dominant inferred pressure wins. */
  domain?: SimulationDomain;
  /** 0..1 - biases causal weights and importance upward. Defaults to 0.5. */
  aggressiveness?: number;
  /** Optional free-text premise recorded on every generated event. */
  seedContext?: string;
}

/** One generated milestone together with the evidence that produced it. */
export interface SimulationStep {
  /** Zero-based index of the step within the run. */
  index: number;
  /** The persisted (or, in a dry run, planned) event. */
  event: Event;
  /** The pressure signal that drove this step. */
  pressure: InferredPressure;
  /** Link from the previous milestone, absent on the first step. */
  causalLink?: StoredCausalRelationship;
}

export interface SimulationResult {
  graphId: string;
  anchorEventId?: string;
  /** Domain actually used (explicit request, or the dominant inferred signal). */
  domain: SimulationDomain;
  steps: number;
  stepDurationMs: number;
  aggressiveness: number;
  dryRun: boolean;
  events: Event[];
  relationships: StoredCausalRelationship[];
  /** All inferred pressures observed while evolving the timeline. */
  pressures: InferredPressure[];
}

/** Repositories the engine reads and writes through. */
export interface SimulationRepositories {
  eventRepository: {
    findAll(): Promise<Event[]>;
    findById(id: string): Promise<Event | null>;
    create(data: {
      description: string;
      actor: string;
      target: string;
      timestamp: Date;
      metadata?: Record<string, unknown>;
    }): Promise<Event>;
  };
  causalService: {
    createCausalLink(
      cause: Event,
      effect: Event,
      relationship: CausalRelationship
    ): Promise<StoredCausalRelationship>;
  };
  temporalService: {
    preventTemporalParadox(cause: Event, effect: Event): boolean;
  };
}

export interface SimulationServiceDependencies {
  inferenceService: InferenceService;
  validationService: ValidationService;
  graphScopedRepositories(graphId: string): Promise<GraphScopedRepositories>;
}

/**
 * Autonomous historical simulation engine.
 *
 * Given an anchor event, the engine walks the timeline forward in discrete
 * hops. Each hop reads the recent causal window, infers the pressures acting on
 * it, picks the dominant (or explicitly requested) domain, synthesises one
 * milestone event, and persists it together with a causal link to the previous
 * milestone. Every candidate passes the same event validation and temporal
 * paradox guards the write API uses, so a simulation cannot inject a record the
 * rest of the system would reject.
 *
 * The engine owns no storage of its own: repositories come from the container
 * through {@link SimulationServiceDependencies}, which is what keeps the
 * graph-scoped reads honest and makes the whole thing testable without a
 * database.
 */
export class SimulationService {
  private readonly inferenceService: InferenceService;
  private readonly validationService: ValidationService;
  private readonly graphScopedRepositories: SimulationServiceDependencies['graphScopedRepositories'];

  constructor(dependencies: SimulationServiceDependencies) {
    this.inferenceService = dependencies.inferenceService;
    this.validationService = dependencies.validationService;
    this.graphScopedRepositories = dependencies.graphScopedRepositories;
  }

  /**
   * Evolve `graphId` forward, optionally reporting each persisted step.
   *
   * `onStep` is awaited before the next hop begins, which is what lets an SSE
   * route flush a milestone to the client before the engine produces the next
   * one. It is not called at all during a dry run, because nothing is written.
   */
  async simulate(
    request: SimulationRequest,
    onStep?: (step: SimulationStep) => Promise<void> | void
  ): Promise<SimulationResult> {
    return this.execute(request, onStep, false);
  }

  /**
   * Plan the same forward evolution without writing anything.
   *
   * Kept as a separate entry point rather than a request flag so a production
   * simulate call can never silently skip persistence.
   */
  async preview(request: SimulationRequest): Promise<SimulationResult> {
    return this.execute(request, undefined, true);
  }

  private async execute(
    request: SimulationRequest,
    onStep: ((step: SimulationStep) => Promise<void> | void) | undefined,
    dryRun: boolean
  ): Promise<SimulationResult> {
    const graphId = this.requireGraphId(request);
    const { steps, stepDurationMs, aggressiveness, domain } =
      this.resolveOptions(request);

    const scoped = await this.graphScopedRepositories(graphId);
    const repositories: SimulationRepositories = {
      eventRepository: scoped.eventRepository,
      causalService: scoped.causalService,
      temporalService: scoped.temporalService,
    };

    const anchor = await this.resolveAnchor(request.anchorEventId, repositories);
    const history = await repositories.eventRepository.findAll();

    const generatedEvents: Event[] = [];
    const relationships: StoredCausalRelationship[] = [];
    const observedPressures: InferredPressure[] = [];
    const stepResults: SimulationStep[] = [];

    let cursorEvent = anchor;
    let cursorTime = anchor.timestamp.getTime();
    let previousEvent: Event | null = null;

    for (let index = 0; index < steps; index += 1) {
      const window = this.recentWindow(history, generatedEvents, cursorTime);
      const pressures = this.inferenceService.analyzeEventClusters(window);
      observedPressures.push(...pressures);

      const stepDomain = domain ?? this.dominantDomain(pressures);
      const pressure = this.selectPressure(pressures, stepDomain);
      const precursor: Event = previousEvent ?? cursorEvent;
      const event = this.buildCandidateEvent({
        domain: stepDomain,
        pressure,
        timestamp: new Date(cursorTime + stepDurationMs),
        window,
        anchor,
        aggressiveness,
        seedContext: request.seedContext,
      });

      const validation = this.validationService.validateCreateEvent({
        description: event.description,
        actor: event.actor,
        target: event.target,
        timestamp: event.timestamp,
        metadata: event.metadata,
      });
      if (!validation.isValid) {
        throw new ValidationError(
          `Simulated event failed validation: ${validation.errors.join(', ')}`,
          'simulation',
          { ...request, step: index }
        );
      }

      // A generated milestone is always later than its precursor, so this is a
      // real guard rather than a formality: it rejects a request that manages to
      // place the anchor in the future beyond the step span.
      repositories.temporalService.preventTemporalParadox(precursor, event);

      const step: SimulationStep = { index, event, pressure };

      if (!dryRun) {
        const persisted = await repositories.eventRepository.create({
          description: event.description,
          actor: event.actor,
          target: event.target,
          timestamp: event.timestamp,
          metadata: event.metadata,
        });

        const relationship = this.buildRelationship(
          stepDomain,
          pressure,
          aggressiveness
        );
        const link = await repositories.causalService.createCausalLink(
          precursor,
          persisted,
          relationship
        );

        step.event = persisted;
        step.causalLink = link;
        relationships.push(link);
        generatedEvents.push(persisted);
        previousEvent = persisted;
        cursorEvent = persisted;
      } else {
        generatedEvents.push(event);
        previousEvent = event;
        cursorEvent = event;
      }

      cursorTime = event.timestamp.getTime();
      stepResults.push(step);
      if (!dryRun && onStep) {
        await onStep(step);
      }
    }

    return {
      graphId,
      anchorEventId: anchor.id,
      domain: domain ?? this.dominantDomain(observedPressures),
      steps,
      stepDurationMs,
      aggressiveness,
      dryRun,
      events: stepResults.map((step) => step.event),
      relationships,
      pressures: observedPressures,
    };
  }

  private requireGraphId(request: SimulationRequest): string {
    const graphId = request.graphId?.trim();
    if (!graphId) {
      throw new ValidationError('graphId is required', 'graphId', request.graphId);
    }
    return graphId;
  }

  private resolveOptions(request: SimulationRequest): {
    steps: number;
    stepDurationMs: number;
    aggressiveness: number;
    domain?: SimulationDomain;
  } {
    const requestedSteps = request.steps ?? 3;
    if (!Number.isFinite(requestedSteps) || requestedSteps < MIN_SIMULATION_STEPS) {
      throw new ValidationError(
        `steps must be an integer between ${MIN_SIMULATION_STEPS} and ${MAX_SIMULATION_STEPS}`,
        'steps',
        request.steps
      );
    }
    const steps = Math.min(Math.floor(requestedSteps), MAX_SIMULATION_STEPS);

    const stepDurationMs = request.stepDurationMs ?? DEFAULT_SIMULATION_STEP_MS;
    if (!Number.isFinite(stepDurationMs) || stepDurationMs <= 0) {
      throw new ValidationError(
        'stepDurationMs must be a positive number',
        'stepDurationMs',
        request.stepDurationMs
      );
    }

    const rawAggressiveness = request.aggressiveness ?? DEFAULT_AGGRESSIVENESS;
    if (
      !Number.isFinite(rawAggressiveness) ||
      rawAggressiveness < MIN_AGGRESSIVENESS ||
      rawAggressiveness > MAX_AGGRESSIVENESS
    ) {
      throw new ValidationError(
        `aggressiveness must be between ${MIN_AGGRESSIVENESS} and ${MAX_AGGRESSIVENESS}`,
        'aggressiveness',
        request.aggressiveness
      );
    }

    if (request.domain !== undefined && !isSimulationDomain(request.domain)) {
      throw new ValidationError(
        `domain must be one of: ${SIMULATION_DOMAINS.join(', ')}`,
        'domain',
        request.domain
      );
    }

    return {
      steps,
      stepDurationMs,
      aggressiveness: rawAggressiveness,
      domain: request.domain,
    };
  }

  private async resolveAnchor(
    anchorEventId: string | undefined,
    repositories: SimulationRepositories
  ): Promise<Event> {
    if (anchorEventId) {
      const anchor = await repositories.eventRepository.findById(anchorEventId);
      if (!anchor) {
        throw new NotFoundError('Anchor event not found', 'Event', anchorEventId);
      }
      return anchor;
    }

    const events = await repositories.eventRepository.findAll();
    if (events.length === 0) {
      throw new ValidationError(
        'Cannot simulate forward evolution on a graph with no events',
        'graphId',
        undefined,
        ['graphId']
      );
    }

    return events.reduce((latest, candidate) =>
      candidate.timestamp.getTime() > latest.timestamp.getTime() ? candidate : latest
    );
  }

  /**
   * The window of events the inference pass should read for this hop: real
   * history up to the cursor plus everything generated so far in this run.
   */
  private recentWindow(
    history: Event[],
    generated: Event[],
    cursorTime: number
  ): Event[] {
    const combined = [...history, ...generated];
    const upToCursor = combined.filter(
      (event) => event.timestamp.getTime() <= cursorTime
    );
    return upToCursor.length > 0 ? upToCursor : combined;
  }

  /** Pick the pressure type with the strongest confidence for the next hop. */
  private dominantDomain(pressures: InferredPressure[]): SimulationDomain {
    if (pressures.length === 0) {
      return 'political';
    }

    const strongest = pressures.reduce((best, candidate) =>
      candidate.confidence_score > best.confidence_score ? candidate : best
    );

    return this.domainForPressure(strongest.pressure_type);
  }

  /** The reverse of `DOMAIN_PRESSURE`, preferring the first matching domain. */
  private domainForPressure(pressureType: PressureType): SimulationDomain {
    const match = SIMULATION_DOMAINS.find(
      (domain) => DOMAIN_PRESSURE[domain] === pressureType
    );
    return match ?? 'political';
  }

  /**
   * Choose the pressure record that best explains the requested domain, falling
   * back to a synthetic record when inference found nothing for it so a step is
   * always attributable to a named force.
   */
  private selectPressure(
    pressures: InferredPressure[],
    domain: SimulationDomain
  ): InferredPressure {
    const wanted = DOMAIN_PRESSURE[domain];
    const matching = pressures.filter((pressure) => pressure.pressure_type === wanted);
    if (matching.length > 0) {
      return matching.reduce((best, candidate) =>
        candidate.confidence_score > best.confidence_score ? candidate : best
      );
    }

    if (pressures.length > 0) {
      return pressures.reduce((best, candidate) =>
        candidate.confidence_score > best.confidence_score ? candidate : best
      );
    }

    return new InferredPressure({
      description: `Latent ${wanted} pressure accumulated without overt evidence`,
      confidence_score: 0.3,
      pressure_type: wanted,
      evidence: ['No clustered events supplied direct evidence for this hop'],
    });
  }

  /**
   * Build the milestone event for one hop.
   *
   * The actor/target pair is deliberately drawn from the busiest participants in
   * the recent window (falling back to the anchor event when the window is
   * empty), so generated events continue the story that is already on the graph
   * instead of inventing unrelated cast members.
   */
  private buildCandidateEvent(input: {
    domain: SimulationDomain;
    pressure: InferredPressure;
    timestamp: Date;
    window: Event[];
    anchor: Event;
    aggressiveness: number;
    seedContext?: string;
  }): Event {
    const actor = this.mostFrequent(input.window.map((e) => e.actor)) ?? input.anchor.actor;
    const target =
      this.mostFrequent(input.window.map((e) => e.target)) ?? input.anchor.target;
    const template = DOMAIN_TEMPLATES[input.domain];

    const description = `${template(actor, target)} (${input.pressure.description.toLowerCase()})`;
    const importance = this.round(
      Math.min(1, 0.5 + input.aggressiveness * 0.5)
    );

    return new Event({
      description,
      actor,
      target,
      timestamp: input.timestamp,
      metadata: {
        simulated: true,
        domain: input.domain,
        pressureType: input.pressure.pressure_type,
        pressureConfidence: input.pressure.confidence_score,
        ...(input.seedContext ? { seedContext: input.seedContext } : {}),
        importance,
      },
    });
  }

  private buildRelationship(
    domain: SimulationDomain,
    pressure: InferredPressure,
    aggressiveness: number
  ): CausalRelationship {
    const weight = this.round(
      Math.min(1, 0.5 + aggressiveness * 0.4 + pressure.confidence_score * 0.1)
    );

    return {
      weight,
      evidence: `Forward simulation: ${domain} trajectory driven by ${pressure.description}`,
      confidence: this.round(Math.min(1, pressure.confidence_score)),
      relationship_type:
        pressure.confidence_score >= 0.6
          ? 'direct'
          : pressure.confidence_score >= 0.35
            ? 'contributory'
            : 'indirect',
    };
  }

  private mostFrequent(values: string[]): string | undefined {
    if (values.length === 0) {
      return undefined;
    }

    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    let winner = values[0];
    let winnerCount = 0;
    for (const [value, count] of counts) {
      if (count > winnerCount) {
        winner = value;
        winnerCount = count;
      }
    }
    return winner;
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
