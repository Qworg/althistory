/** A statement that can change data. Over-matching is safe: it only picks the transactional path. */
const WRITES = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|LOAD\s+CSV|FOREACH)\b|apoc\.(create|merge|refactor|periodic|do|cypher\.(doIt|run))/i;

/** Whether a Cypher statement can change data. */
export const isWriteQuery = (query: string): boolean => WRITES.test(query);
