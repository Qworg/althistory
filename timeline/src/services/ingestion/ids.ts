/**
 * Temporary-ID helper shared by extractors. IDs are prefixed by source so a
 * review UI can tell where an entity came from, and are unique per extraction.
 */
import { randomUUID } from 'crypto';

export function newTempId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
