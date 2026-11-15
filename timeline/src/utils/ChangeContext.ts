/**
 * Who is making a change, carried down the call chain.
 *
 * The services that write (the versioning bridge, the graph service) do not
 * see the request that asked them to, and they should not: a write is a write
 * whoever asked. But the live change feed tells watchers WHO changed what ("An
 * agent added 3 events to The Tide War"), so the request's author has to reach
 * the place the change is announced. An `AsyncLocalStorage` carries it there
 * without threading a parameter through every service.
 *
 * The API router opens a context for every request (`api/changeAttribution`),
 * a generation job opens one for the whole run, and a change announced with no
 * context is attributed to `system`.
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * What kind of writer made a change.
 *
 *  - `person`: the web app.
 *  - `agent`: an MCP server (an agent working through the app).
 *  - `cli`: the `althistory` command line.
 *  - `api`: any other client of the HTTP API.
 *  - `generation`: a generation job the app is running.
 *  - `system`: the app itself, or a writer that named no one.
 */
export type ActorKind = 'person' | 'agent' | 'cli' | 'api' | 'generation' | 'system';

export interface ChangeActor {
  kind: ActorKind;
  /** The API key's name, or the generation job's label. Never the key's secret. */
  name?: string;
  /** The id of the API key that made the change. */
  keyId?: string;
}

export interface ChangeContext {
  actor: ChangeActor;
  /**
   * The id of the browser tab that made the change, when it said (the
   * `X-Client-Id` header), so that tab can tell its own edits from other
   * writers' and not announce them to itself.
   */
  origin?: string;
}

const storage = new AsyncLocalStorage<ChangeContext>();

/** Run `fn` with `context` as the author of every change made inside it. */
export function runWithChangeContext<T>(context: ChangeContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The author of the change being made, if a context is open. */
export function currentChangeContext(): ChangeContext | undefined {
  return storage.getStore();
}

/** The header that names the kind of client making a request. */
export const CLIENT_KIND_HEADER = 'X-Althistory-Client';

/** The header a browser tab sends to recognise its own edits in the feed. */
export const CLIENT_ID_HEADER = 'X-Client-Id';

const ORIGIN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A client id as the header may carry it; anything else is no id. */
export function readOriginId(value: string | undefined): string | undefined {
  return value !== undefined && ORIGIN_PATTERN.test(value) ? value : undefined;
}

/** The kind of writer a `X-Althistory-Client` value names; `api` when it names none. */
export function readActorKind(value: string | undefined): ActorKind {
  switch (value?.trim().toLowerCase()) {
    case 'web':
      return 'person';
    case 'mcp':
      return 'agent';
    case 'cli':
      return 'cli';
    default:
      return 'api';
  }
}
