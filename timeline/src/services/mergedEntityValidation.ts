/**
 * Validation for a "harmonized compromise" merge payload.
 *
 * A manual merge resolves each conflict with one of three values: keep the
 * target, keep the source, or supply a blended payload. The blended payload
 * is applied as `{ ...target, ...payload, id }`, so it can change any field of
 * the entity -- which is the point, and also the risk: a payload that changes
 * a field's *type*, or that quietly drops one, produces a graph the rest of
 * the system cannot read.
 *
 * The rules below are deliberately narrow. They reject payloads that would
 * corrupt the entity; they do not demand fields the target never had, because
 * the merge is a blend of two existing versions, not a chance to invent one.
 */

import { EntityType } from '../models/Graph';

/** Keys that would reach `Object.prototype` rather than the entity. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface MergedEntityProblem {
  /** The field at fault, or `id` for a payload that tries to rename the entity. */
  field: string;
  /** What is wrong with it, in words a caller can act on. */
  message: string;
}

/** A value that survives a JSON round trip. */
function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (type === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

/**
 * The kind of a stored value, for comparing a payload's field against the
 * field it replaces. `null` is its own kind: a nullable field may become
 * non-null, and a non-null field may become null.
 */
function valueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const KIND_NAMES: Record<string, string> = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
  array: 'an array',
  object: 'an object',
};

/**
 * Check a blended payload against the entity it will be applied to.
 *
 * Returns an empty array when the payload is safe to apply.
 */
export function validateMergedEntity(
  entityType: EntityType,
  targetEntity: Record<string, unknown>,
  payload: Record<string, unknown>,
  /**
   * The source entity the payload was blended from. A field may be cleared to
   * null only where the data already allows a null -- that is, where either
   * side has null for it. Without this, a payload could clear a relationship's
   * `cause_event_id` and leave a link pointing at nothing.
   */
  sourceEntity?: Record<string, unknown>
): MergedEntityProblem[] {
  const problems: MergedEntityProblem[] = [];

  if ('id' in payload && payload.id !== targetEntity.id) {
    problems.push({
      field: 'id',
      message:
        `a merged ${entityType} keeps its own id ('${String(targetEntity.id)}'); ` +
        `the payload tried to set it to '${String(payload.id)}'`,
    });
  }

  for (const [field, value] of Object.entries(payload)) {
    if (field === 'id') continue;

    if (FORBIDDEN_KEYS.has(field)) {
      // `__proto__` in a spread writes the prototype rather than a field, and
      // `constructor` shadows the object's own constructor.
      problems.push({
        field,
        message: 'is not a field name an entity may carry',
      });
      continue;
    }

    if (value === undefined) {
      // `{ ...target, ...payload }` would leave the key present with an
      // undefined value, which is not the same as the field being absent: the
      // field is lost, and the entity is no longer readable.
      problems.push({
        field,
        message: 'must not be set to undefined; that would drop the field',
      });
      continue;
    }

    if (!isJsonValue(value)) {
      problems.push({
        field,
        message: `must be a JSON value`,
      });
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(targetEntity, field)) {
      // A field the target does not have is a new one. That is allowed (the
      // source side may have introduced it), and it is the payload's own
      // business what it contains.
      continue;
    }

    const targetValue = targetEntity[field];

    const targetKind = valueKind(targetValue);
    const payloadKind = valueKind(value);

    if (payloadKind === 'null') {
      // Clearing a field is only allowed where the data has a null to clear:
      // either side being null means the field is nullable here.
      const sourceValue = sourceEntity ? sourceEntity[field] : undefined;
      if (targetKind !== 'null' && valueKind(sourceValue) !== 'null') {
        problems.push({
          field,
          message: 'must not be cleared to null; the field has no null in the graph',
        });
      }
      continue;
    }

    // A field that is null in the graph may take any value.
    if (targetKind === 'null') continue;
    if (targetKind !== payloadKind) {
      problems.push({
        field,
        message:
          `must stay ${KIND_NAMES[targetKind] ?? targetKind} (the graph has ` +
          `${KIND_NAMES[targetKind] ?? targetKind} here, the payload has ` +
          `${KIND_NAMES[payloadKind] ?? payloadKind})`,
      });
    }
  }

  return problems;
}

/**
 * Format the problems of one conflict into a message naming the conflict and
 * every field at fault.
 */
export function describeMergedEntityProblems(
  entityType: EntityType,
  entityId: string,
  problems: MergedEntityProblem[]
): string {
  const details = problems
    .map((problem) => `${problem.field} ${problem.message}`)
    .join('; ');
  return `The merged ${entityType} '${entityId}' is not usable: ${details}`;
}
