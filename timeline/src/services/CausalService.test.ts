import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CausalService } from './CausalService';
import { Event } from '@/models/Event';
import { CausalRelationship } from '@/models/relationships';
import { CausalParadoxError, ValidationError, DatabaseError } from '@/utils/errors';
import { getDatabaseManager } from '@/utils/database';

// Mock the database manager
vi.mock('@/utils/database');

// Mock the config to use cloud mode (Neo4j) for these tests
vi.mock('@/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    localExecution: {
      enabled: false,
      dataDirectory: './data'
    }
  }))
}));

// Mock the cache manager
vi.mock('@/utils/cache', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null), // Always return null to bypass cache
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
  })),
  CacheKeyGenerator: {
    causalChain: vi.fn((eventId: string, maxDepth: number) => `causal_chain_${eventId}_${maxDepth}`),
    causalCycles: vi.fn(() => 'causal_cycles')
  }
}));

// Mock the CacheInvalidationService
vi.mock('./CacheInvalidationService', () => ({
  CacheInvalidationService: vi.fn().mockImplementation(() => ({
    invalidateCausalCache: vi.fn().mockResolvedValue(undefined)
  }))
}));

describe('CausalService', () => {
  let causalService: CausalService;
  let mockSession: any;
  let mockDatabaseManager: any;

  beforeEach(() => {
    causalService = new CausalService();
    
    // Mock session
    mockSession = {
      run: vi.fn(),
      close: vi.fn()
    };

    // Mock database manager
    mockDatabaseManager = {
      getNeo4jSession: vi.fn().mockReturnValue(mockSession)
    };

    vi.mocked(getDatabaseManager).mockReturnValue(mockDatabaseManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createCausalLink', () => {
    const createTestEvent = (id: string, timestamp: Date): Event => {
      return new Event({
        id,
        description: `Test event ${id}`,
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp
      });
    };

    const createValidRelationship = (): CausalRelationship => ({
      weight: 0.8,
      evidence: 'Strong historical evidence',
      confidence: 0.9,
      relationship_type: 'direct'
    });

    it('should create a valid causal link successfully', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = createValidRelationship();

      mockSession.run.mockResolvedValue({
        records: [{ get: () => ({ properties: relationship }) }]
      });

      await expect(causalService.createCausalLink(cause, effect, relationship)).resolves.not.toThrow();

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('CREATE (cause)-[r:CAUSES'),
        expect.objectContaining({
          causeId: 'cause1',
          effectId: 'effect1',
          weight: 0.8,
          evidence: 'Strong historical evidence',
          confidence: 0.9,
          relationshipType: 'direct'
        })
      );
    });

    it('should prevent temporal paradox when effect precedes cause', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T11:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T10:00:00Z'));
      const relationship = createValidRelationship();

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(CausalParadoxError);
    });

    it('should allow a cause and an effect at the same moment', async () => {
      // The rule the whole project uses: a cause may not follow its effect,
      // but it may happen at the same moment. The importer and the merge
      // accept such a pair, so the link-creation path has to accept it too.
      const timestamp = new Date('2023-01-01T10:00:00Z');
      const cause = createTestEvent('cause1', timestamp);
      const effect = createTestEvent('effect1', timestamp);
      const relationship = createValidRelationship();

      mockSession.run.mockResolvedValue({
        records: [{ get: () => ({ properties: relationship }) }]
      });

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .resolves.toBeDefined();
    });

    it('should refuse a link that would close a cycle', async () => {
      // The project's rule lets a cause and an effect share a moment, so the
      // ordering check alone no longer keeps the graph acyclic. A link
      // between two events at the same moment is the one that can close a
      // cycle, and it has to be refused.
      const timestamp = new Date('2023-01-01T10:00:00Z');
      const cause = createTestEvent('cause1', timestamp);
      const effect = createTestEvent('effect1', timestamp);
      const relationship = createValidRelationship();

      // The relationships the cycle check reads: the link already runs the
      // other way round, so a new link from cause to effect closes a cycle.
      const existing = {
        id: 'r1',
        cause_event_id: 'effect1',
        effect_event_id: 'cause1',
        weight: 0.8,
        confidence: 0.9,
        evidence: '',
        relationship_type: 'direct',
      };

      vi.mocked(getDatabaseManager).mockReturnValue({
        getNeo4jSession: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation(async (query: string) => {
            if (query.includes('CREATE (cause)-[r:CAUSES')) {
              return { records: [{ get: () => ({ properties: relationship }) }] };
            }
            return {
              records: [
                {
                  get: (key: string) =>
                    key in existing ? existing[key as keyof typeof existing] : '',
                },
              ],
            };
          }),
          close: vi.fn(),
        }),
      } as any);

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(CausalParadoxError);
    });

    it('should reject invalid weight values', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = { ...createValidRelationship(), weight: 1.5 };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should reject negative weight values', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = { ...createValidRelationship(), weight: -0.1 };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should reject invalid confidence values', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = { ...createValidRelationship(), confidence: 2.0 };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should reject empty evidence', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = { ...createValidRelationship(), evidence: '' };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should reject invalid relationship type', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = { ...createValidRelationship(), relationship_type: 'invalid' as any };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should reject self-referential causal relationships', async () => {
      const event = createTestEvent('event1', new Date('2023-01-01T10:00:00Z'));
      const relationship = createValidRelationship();

      await expect(causalService.createCausalLink(event, event, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should handle database errors gracefully', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = createValidRelationship();

      mockSession.run.mockRejectedValue(new Error('Database connection failed'));

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(DatabaseError);
    });

    it('should handle case when events do not exist in database', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = createValidRelationship();

      mockSession.run.mockResolvedValue({ records: [] });

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(DatabaseError);
    });

    it('should accept valid relationship types', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));

      const validTypes = ['direct', 'indirect', 'contributory'] as const;

      for (const type of validTypes) {
        const relationship = { ...createValidRelationship(), relationship_type: type };
        mockSession.run.mockResolvedValue({
          records: [{ get: () => ({ properties: relationship }) }]
        });

        await expect(causalService.createCausalLink(cause, effect, relationship))
          .resolves.not.toThrow();
      }
    });

    it('should validate boundary weight values', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));

      // Test boundary values
      const boundaryWeights = [0.0, 1.0];

      for (const weight of boundaryWeights) {
        const relationship = { ...createValidRelationship(), weight };
        mockSession.run.mockResolvedValue({
          records: [{ get: () => ({ properties: relationship }) }]
        });

        await expect(causalService.createCausalLink(cause, effect, relationship))
          .resolves.not.toThrow();
      }
    });

    it('should validate boundary confidence values', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));

      // Test boundary values
      const boundaryConfidences = [0.0, 1.0];

      for (const confidence of boundaryConfidences) {
        const relationship = { ...createValidRelationship(), confidence };
        mockSession.run.mockResolvedValue({
          records: [{ get: () => ({ properties: relationship }) }]
        });

        await expect(causalService.createCausalLink(cause, effect, relationship))
          .resolves.not.toThrow();
      }
    });

    it('should ensure session is closed even on error', async () => {
      const cause = createTestEvent('cause1', new Date('2023-01-01T10:00:00Z'));
      const effect = createTestEvent('effect1', new Date('2023-01-01T11:00:00Z'));
      const relationship = createValidRelationship();

      mockSession.run.mockRejectedValue(new Error('Database error'));

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow();

      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe('validation edge cases', () => {
    it('should handle non-string evidence', async () => {
      const cause = new Event({
        id: 'cause1',
        description: 'Test cause',
        actor: 'Actor',
        target: 'Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      });
      const effect = new Event({
        id: 'effect1',
        description: 'Test effect',
        actor: 'Actor',
        target: 'Target',
        timestamp: new Date('2023-01-01T11:00:00Z')
      });
      const relationship = {
        weight: 0.8,
        evidence: null as any,
        confidence: 0.9,
        relationship_type: 'direct' as const
      };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });

    it('should handle non-number weight', async () => {
      const cause = new Event({
        id: 'cause1',
        description: 'Test cause',
        actor: 'Actor',
        target: 'Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      });
      const effect = new Event({
        id: 'effect1',
        description: 'Test effect',
        actor: 'Actor',
        target: 'Target',
        timestamp: new Date('2023-01-01T11:00:00Z')
      });
      const relationship = {
        weight: 'high' as any,
        evidence: 'Valid evidence',
        confidence: 0.9,
        relationship_type: 'direct' as const
      };

      await expect(causalService.createCausalLink(cause, effect, relationship))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('findCausalChain', () => {
    const createTestEvent = (id: string): Event => {
      return new Event({
        id,
        description: `Test event ${id}`,
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      });
    };

    it('should find causal chains successfully', async () => {
      const startEvent = createTestEvent('start');
      const mockChainData = [
        {
          get: (key: string) => {
            switch (key) {
              case 'eventIds': return ['start', 'middle', 'end'];
              case 'weights': return [0.8, 0.7];
              case 'depth': return 2;
              default: return null;
            }
          }
        }
      ];

      mockSession.run.mockResolvedValue({ records: mockChainData });

      const result = await causalService.findCausalChain(startEvent, 3);

      expect(result).toHaveLength(1);
      expect(result[0].events).toEqual(['start', 'middle', 'end']);
      expect(result[0].relationship_weights).toEqual([0.8, 0.7]);
      expect(result[0].depth).toBe(2);
      expect(result[0].total_strength).toBeCloseTo(Math.sqrt(0.8 * 0.7), 5);
    });

    it('should reject invalid max depth', async () => {
      const startEvent = createTestEvent('start');

      await expect(causalService.findCausalChain(startEvent, 0))
        .rejects.toThrow(ValidationError);

      await expect(causalService.findCausalChain(startEvent, -1))
        .rejects.toThrow(ValidationError);
    });

    it('should handle database errors in chain finding', async () => {
      const startEvent = createTestEvent('start');
      mockSession.run.mockRejectedValue(new Error('Database error'));

      await expect(causalService.findCausalChain(startEvent, 3))
        .rejects.toThrow(DatabaseError);
    });

    it('should return empty array when no chains found', async () => {
      const startEvent = createTestEvent('start');
      mockSession.run.mockResolvedValue({ records: [] });

      const result = await causalService.findCausalChain(startEvent, 3);

      expect(result).toEqual([]);
    });

    it('should ensure session is closed after chain finding', async () => {
      const startEvent = createTestEvent('start');
      mockSession.run.mockResolvedValue({ records: [] });

      await causalService.findCausalChain(startEvent, 3);

      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe('calculateCausalStrength', () => {
    it('should calculate strength using geometric mean', () => {
      const path = {
        events: ['a', 'b', 'c'],
        total_strength: 0,
        relationship_weights: [0.8, 0.6],
        depth: 2
      };

      const strength = causalService.calculateCausalStrength(path);
      const expectedStrength = Math.sqrt(0.8 * 0.6);

      expect(strength).toBeCloseTo(expectedStrength, 5);
    });

    it('should return 0 for empty weights', () => {
      const path = {
        events: ['a'],
        total_strength: 0,
        relationship_weights: [],
        depth: 0
      };

      const strength = causalService.calculateCausalStrength(path);

      expect(strength).toBe(0);
    });

    it('should handle single weight', () => {
      const path = {
        events: ['a', 'b'],
        total_strength: 0,
        relationship_weights: [0.9],
        depth: 1
      };

      const strength = causalService.calculateCausalStrength(path);

      expect(strength).toBe(0.9);
    });

    it('should handle multiple weights correctly', () => {
      const path = {
        events: ['a', 'b', 'c', 'd'],
        total_strength: 0,
        relationship_weights: [1.0, 0.8, 0.6],
        depth: 3
      };

      const strength = causalService.calculateCausalStrength(path);
      const expectedStrength = Math.pow(1.0 * 0.8 * 0.6, 1/3);

      expect(strength).toBeCloseTo(expectedStrength, 5);
    });
  });

  describe('detectCausalCycles', () => {
    it('should detect causal cycles successfully', async () => {
      const mockCycleData = [
        {
          get: (key: string) => {
            switch (key) {
              case 'eventIds': return ['event1', 'event2', 'event3', 'event1'];
              case 'relationships': return [
                { weight: 0.8, evidence: 'Evidence 1', confidence: 0.9, relationship_type: 'direct' },
                { weight: 0.7, evidence: 'Evidence 2', confidence: 0.8, relationship_type: 'indirect' },
                { weight: 0.6, evidence: 'Evidence 3', confidence: 0.7, relationship_type: 'contributory' }
              ];
              case 'paradoxSeverity': return 2;
              default: return null;
            }
          }
        }
      ];

      mockSession.run.mockResolvedValue({ records: mockCycleData });

      const result = await causalService.detectCausalCycles();

      expect(result).toHaveLength(1);
      expect(result[0].events).toEqual(['event1', 'event2', 'event3', 'event1']);
      expect(result[0].relationships).toHaveLength(3);
      expect(result[0].paradox_severity).toBe(2);
    });

    it('should handle database errors in cycle detection', async () => {
      mockSession.run.mockRejectedValue(new Error('Database error'));

      await expect(causalService.detectCausalCycles())
        .rejects.toThrow(DatabaseError);
    });

    it('should return empty array when no cycles found', async () => {
      mockSession.run.mockResolvedValue({ records: [] });

      const result = await causalService.detectCausalCycles();

      expect(result).toEqual([]);
    });

    it('should ensure session is closed after cycle detection', async () => {
      mockSession.run.mockResolvedValue({ records: [] });

      await causalService.detectCausalCycles();

      expect(mockSession.close).toHaveBeenCalled();
    });

    it('should handle cycle detection errors gracefully', async () => {
      mockSession.run.mockRejectedValue(new Error('Neo4j connection failed'));

      await expect(causalService.detectCausalCycles())
        .rejects.toThrow(DatabaseError);

      expect(mockSession.close).toHaveBeenCalled();
    });
  });
});