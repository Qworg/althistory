import { CLIResponseEnvelope } from '../types';

/**
 * Formats a payload into an agent-friendly JSON envelope.
 */
export function formatSuccessJson<T>(
  data: T,
  mode: 'direct' | 'remote',
  options?: { durationMs?: number; graphId?: string; pretty?: boolean }
): string {
  const envelope: CLIResponseEnvelope<T> = {
    success: true,
    data,
    meta: {
      mode,
      timestamp: new Date().toISOString(),
      durationMs: options?.durationMs,
      graphId: options?.graphId,
    },
  };

  return JSON.stringify(envelope, null, options?.pretty !== false ? 2 : 0);
}

/**
 * Formats an error into a standardized JSON error envelope.
 */
export function formatErrorJson(
  message: string,
  code: string = 'GENERAL_ERROR',
  mode: 'direct' | 'remote' = 'direct',
  details?: unknown
): string {
  const envelope: CLIResponseEnvelope<never> = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      mode,
      timestamp: new Date().toISOString(),
    },
  };

  return JSON.stringify(envelope, null, 2);
}
