/**
 * Tests for the GraphML the exporter writes.
 *
 * GraphML is XML, so the output has to be valid XML: the five metacharacters
 * escaped, the characters XML 1.0 forbids even numerically removed, and no
 * edge pointing at a node the document does not declare. The other formats
 * are checked in `validation-export.test.ts`; this file exists because the
 * GraphML output is the one a parser reads.
 */

import { describe, it, expect } from 'vitest';
import { GraphExporter, type ExportRelationship } from './GraphExporter';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';

const exporter = new GraphExporter();

function event(
  id: string,
  description: string,
  actor = 'A',
  target = 'B',
  metadata?: Record<string, unknown>
): Event {
  return new Event({
    id,
    description,
    actor,
    target,
    timestamp: new Date('1776-07-04T00:00:00Z'),
    ...(metadata ? { metadata } : {}),
  });
}

function arc(id: string, name: string): Arc {
  return new Arc({
    id,
    name,
    start_time: new Date('1776-01-01T00:00:00Z'),
    end_time: new Date('1783-01-01T00:00:00Z'),
    level: 0,
  });
}

function relationship(
  cause: string,
  effect: string,
  evidence = 'Because'
): ExportRelationship {
  return {
    id: `${cause}->${effect}`,
    cause_event_id: cause,
    effect_event_id: effect,
    weight: 0.8,
    confidence: 0.9,
    evidence,
    relationship_type: 'direct',
  };
}

/** The ids the document declares as nodes. */
function declaredNodeIds(graphml: string): Set<string> {
  const ids = new Set<string>();
  for (const match of graphml.matchAll(/<node id="([^"]*)"/g)) {
    ids.add(match[1]!);
  }
  return ids;
}

/** Every endpoint an edge names. */
function edgeEndpoints(graphml: string): string[] {
  const endpoints: string[] = [];
  for (const match of graphml.matchAll(/<edge source="([^"]*)" target="([^"]*)"/g)) {
    endpoints.push(match[1]!, match[2]!);
  }
  return endpoints;
}

describe('generateGraphML', () => {
  it('escapes the five metacharacters', () => {
    const graphml = exporter.generateGraphML(
      'g1',
      'A & B',
      [event('e1', 'Cavour & Garibaldi <allies> "quoted" it\'s')],
      [],
      []
    );

    expect(graphml).toContain('A &amp; B');
    expect(graphml).toContain('Cavour &amp; Garibaldi &lt;allies&gt; &quot;quoted&quot; it&apos;s');
    // The raw characters must not survive anywhere in the document.
    const body = graphml.replace(/<\?xml[^>]*\?>/, '');
    expect(body).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
  });

  it('drops the characters XML 1.0 does not allow', () => {
    // A NUL or a form feed can reach a description from an imported file or a
    // page; XML 1.0 forbids them even as numeric references, so a document
    // carrying one does not parse at all.
    const graphml = exporter.generateGraphML(
      'g1',
      'Graph',
      [event('e1', 'before\u0000after\u000bmid\u001fend')],
      [],
      []
    );

    expect(graphml).toContain('beforeaftermidend');
    // The document holds no C0 control other than the whitespace XML allows
    // between elements: tab, newline and carriage return.
    for (const character of graphml) {
      const code = character.codePointAt(0) ?? 0;
      if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
      expect(code).toBeGreaterThanOrEqual(0x20);
    }
  });

  it('declares every node an edge points at', () => {
    const graphml = exporter.generateGraphML(
      'g1',
      'Graph',
      [event('e1', 'Cause'), event('e2', 'Effect')],
      [],
      [relationship('e1', 'e2')]
    );

    const declared = declaredNodeIds(graphml);
    for (const endpoint of edgeEndpoints(graphml)) {
      expect(declared.has(endpoint)).toBe(true);
    }
  });

  it('leaves out an edge whose endpoint this document does not hold', () => {
    // A cross-graph relationship names an event that lives in another graph.
    // An edge to a node the document does not declare makes the GraphML
    // invalid.
    const graphml = exporter.generateGraphML(
      'g1',
      'Graph',
      [event('e1', 'Cause')],
      [],
      [relationship('e1', 'elsewhere'), relationship('elsewhere', 'e1')]
    );

    expect(graphml).not.toContain('elsewhere');
    const declared = declaredNodeIds(graphml);
    for (const endpoint of edgeEndpoints(graphml)) {
      expect(declared.has(endpoint)).toBe(true);
    }
  });

  it('declares the arcs and the events, and connects an event to its arc', () => {
    const withArc = event('e1', 'The Congress votes', 'A', 'B', { arcId: 'a1' });

    const graphml = exporter.generateGraphML('g1', 'Graph', [withArc], [arc('a1', 'The Revolution')], []);

    const declared = declaredNodeIds(graphml);
    expect(declared.has('a1')).toBe(true);
    expect(declared.has('e1')).toBe(true);
    expect(graphml).toContain('<edge source="a1" target="e1">');
  });

  it('keeps the node ids unique when a forbidden character is dropped', () => {
    // Two ids that differ only by a character XML forbids would collapse to
    // the same `<node id>`, which is invalid GraphML: node ids must be
    // unique.
    const graphml = exporter.generateGraphML(
      'g1',
      'Graph',
      [event('e\u00001', 'First'), event('e1', 'Second')],
      [],
      []
    );

    const ids = [...graphml.matchAll(/<node id="([^"]*)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).not.toBe('');
    }
  });

  it('never emits an empty node id', () => {
    // An id made only of characters XML forbids would become `id=""`.
    const graphml = exporter.generateGraphML('g1', 'Graph', [event('\u0000\u0001', 'Nameless')], [], []);

    expect(graphml).not.toContain('id=""');
    expect(graphml).toContain('id="node"');
  });

  it('points an edge at the mapped id, not the original', () => {
    const graphml = exporter.generateGraphML(
      'g1',
      'Graph',
      [event('e\u00001', 'First'), event('e2', 'Second')],
      [],
      [relationship('e\u00001', 'e2')]
    );

    const declared = declaredNodeIds(graphml);
    for (const endpoint of edgeEndpoints(graphml)) {
      expect(declared.has(endpoint)).toBe(true);
    }
  });

  it('leaves out a containment edge to an arc this document does not hold', () => {
    const withMissingArc = event('e1', 'The Congress votes', 'A', 'B', { arcId: 'a-missing' });

    const graphml = exporter.generateGraphML('g1', 'Graph', [withMissingArc], [], []);

    expect(graphml).not.toContain('a-missing');
  });
});
