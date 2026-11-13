/**
 * What the feed tells a key about a change (issue 23).
 *
 * A key may watch a graph with `read:events` alone, so a change to arcs or
 * links must not reach it with their ids and names: the entity routes would
 * refuse it the same reads. This fails if a record is passed through whole.
 */

import { describe, it, expect } from 'vitest';
import type { Permission } from '@/models/ApiKey';
import type { ChangeRecord } from '@/services/ChangeFeedService';
import { visibleTo } from './StreamHandler';

const keyWith = (...permissions: Permission[]) => ({
  hasPermission: (permission: Permission) => permissions.includes(permission),
});

type EntityRecord = Extract<ChangeRecord, { kind: 'entities' }>;

const record = (entities: EntityRecord['entities'], summary: string): EntityRecord => ({
  kind: 'entities',
  graphId: 'g1',
  seq: 4,
  at: 'x',
  actor: { kind: 'agent' },
  operation: 'create',
  entities,
  summary,
});

describe('visibleTo', () => {
  it('sends a change whole to a key that may read everything it touches', () => {
    const change = record([{ type: 'arc', id: 'a1' }], 'Added arc “The Tide War”');
    expect(visibleTo(keyWith('read:events', 'read:arcs'), change)).toBe(change);
  });

  it('sends nothing for a change to arcs or links a key may not read', () => {
    const arc = record([{ type: 'arc', id: 'a1' }], 'Added arc “The Tide War”');
    const link = record([{ type: 'relationship', id: 'r1' }], 'Added link: “A” → “B”');
    expect(visibleTo(keyWith('read:events'), arc)).toBeNull();
    expect(visibleTo(keyWith('read:events'), link)).toBeNull();
  });

  it('drops the entities it may not read, and the line that may name them', () => {
    const mixed = record(
      [
        { type: 'event', id: 'e1' },
        { type: 'relationship', id: 'r1' },
      ],
      'Deleted event “X” and its link “A” → “B”'
    );
    const seen = visibleTo(keyWith('read:events'), mixed);
    expect(seen).toMatchObject({ seq: 4, entities: [{ type: 'event', id: 'e1' }], summary: 'Added 1 item' });
    expect(JSON.stringify(seen)).not.toContain('→');
    // The original is not changed: other sockets are sent it as it was.
    expect(mixed.entities).toHaveLength(2);
  });

  it('passes the changes that carry no entities', () => {
    const graph: ChangeRecord = { kind: 'graph', graphId: 'g1', seq: 1, at: 'x', actor: { kind: 'cli' }, operation: 'create', summary: 'x' };
    expect(visibleTo(keyWith('read:events'), graph)).toBe(graph);
  });
});
