/**
 * The MCP prompts: the three ways of working with Althistory, written for an
 * agent. A client lists them (`prompts/list`) and offers them to its user;
 * Claude Code shows them as `/althistory:<name>` commands. The CLI prints
 * the same text with `althistory prompt <name>`.
 *
 * Each prompt names the tools it uses. `mcp.test.ts` checks that every tool a
 * prompt names is one the server offers, so a renamed tool cannot leave a
 * prompt pointing at nothing.
 */

import { ValidationErrorCLI } from '../utils/exitCodes';
import { calendarProblems } from '@/utils/worldCalendar';

/** A stored year as ISO 8601 writes it: four digits. */
function isoYear(year: number): string {
  return String(year).padStart(4, '0');
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface McpPromptDefinition {
  name: string;
  /** One line, shown in the client's list of prompts. */
  description: string;
  arguments: McpPromptArgument[];
}

interface PromptSpec extends McpPromptDefinition {
  render(args: Record<string, string>): string;
}

const MIN_STORED_YEAR = 1000;

/** The epoch an invented world uses when the author does not choose one. */
const DEFAULT_EPOCH_YEAR = 1000;

/**
 * Every argument is optional, and the agent asks for what is missing. Claude
 * Code passes a prompt's arguments as whitespace-separated words in the order
 * they are declared, so a world described in a sentence cannot be one of them
 * there; the one-word arguments come first, and the author can describe the
 * world in their next message instead.
 */
function worldbuild(args: Record<string, string>): string {
  // A slash command's first word lands in eraLabel; a lone number there with no
  // epochYear (`/althistory:worldbuild 1200`) is the epoch the author meant.
  if (args.eraLabel && /^\d+$/.test(args.eraLabel) && !args.epochYear) {
    args = { ...args, epochYear: args.eraLabel, eraLabel: '' };
  }
  const world = args.world;
  const worldSection = world
    ? `The world:\n\n${world}`
    : 'The author has not described the world yet. Before calling any tool, ask them for it in a few sentences: its peoples, its land, and what is at stake.';
  const label = args.eraLabel?.trim();
  const epochText = args.epochYear?.trim();
  const epoch = epochText ? Number(epochText) : DEFAULT_EPOCH_YEAR;
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 9999) {
    throw new ValidationErrorCLI(`Invalid epochYear "${epochText}": expected a whole year between 1 and 9999`);
  }
  // The calendar the prompt tells the agent to create has to be one the tools accept.
  const problems = calendarProblems({ epochYear: epoch, ...(label ? { eraLabel: label } : {}) });
  if (problems.length > 0) {
    throw new ValidationErrorCLI(problems.join('; '));
  }
  const offset = epoch - 1;
  // A later year to show the arithmetic with, kept within the four-digit years.
  const example = 312 + offset <= 9999 ? 312 : 2;
  const year = (n: number): string => (label ? `${n} ${label}` : `Year ${n}`);
  const calendarArgs = `epochYear ${epoch}${label ? `, eraLabel "${label}"` : ''}`;
  const lowWarning =
    epoch < MIN_STORED_YEAR
      ? ` Stored years below ${MIN_STORED_YEAR} work, but some date libraries treat years below 100 as 19xx; an epoch of ${MIN_STORED_YEAR} or later avoids that.`
      : '';

  return `You are helping an author build the history of an invented world, using the althistory tools. ${worldSection}

Althistory keeps the history as a graph: events (who did what to whom, and when), arcs (the ages and periods that hold them) and causal links (which events brought about which). It checks the graph for contradictions and lets the author branch it at any event. You write the history; the tools keep it straight. Work in this order.

1. Create the graph with its calendar. Call althistory_create_graph with a name for the world and ${calendarArgs}. The calendar makes the app and the exports show the world's own years (and months, if you name them). Every timestamp a tool takes or returns is a stored ISO-8601 date, and the world's year N is stored as year N + ${offset}: ${year(1)} is ${isoYear(epoch)}-01-01T00:00:00Z, and ${year(example)} is ${isoYear(example + offset)}-01-01T00:00:00Z.${lowWarning} If the world has its own names for the months, add monthNames: twelve names, the first for January. The months keep their stored lengths, so the world's fourth month is stored as April.

2. Lay out the ages. Decide the three to six great ages of the world's history, and create each with althistory_create_arc. An arc inside another (a reign inside an age) takes the outer arc's id as parentArcId.

3. Write the events. Add the moments that matter, such as foundings, wars, discoveries, deaths, betrayals and treaties, with althistory_create_event. Give each an actor and a target, and the arcId of the age it belongs to. A dozen events is enough to start; write them before you link anything.

4. Link the causes. For each event, link the earlier events that brought it about with althistory_link_events: "direct", "indirect" or "contributory", with a sentence of reasoning. A cause cannot come after its effect, and the tool refuses one that does. Treat that refusal as a question about the history, not just a typo.

5. Check it. Run althistory_validate_graph and fix what it reports: an event outside its age, a cause after its effect, a cycle.

6. Read it back. althistory_export_context returns the whole history as Markdown, dated in the world's calendar. Read it as a reader would, and look for ages with nothing in them, threads that go nowhere and actors who appear once and vanish.

7. Offer branches. Name two or three moments where the world could have gone another way, and offer to branch at one with althistory_branch_timeline.

Names, places and dates are canon once written, so keep the world consistent with itself. Do not borrow real-world history unless the author asks for it. If the author wants a rough draft first, althistory_generate_timeline with world set drafts a skeleton to revise. Its result says who wrote it: "source": "model" when the althistory server has its own model key, and "template" otherwise, which is a generic skeleton you should rewrite rather than present as the world's history.`;
}

function alternateHistory(args: Record<string, string>): string {
  const premise =
    args.premise ??
    'Not given yet. Before calling any tool, ask the author for the what-if, in a sentence.';
  const divergence = args.divergencePoint?.trim();
  const divergenceLine = divergence
    ? `The point of divergence: ${divergence}`
    : 'The point of divergence is not given yet. Settle it with the author first: the last moment that went as it really did, and the first that did not.';

  return `You are helping an author explore an alternate history, using the althistory tools. The premise:

${premise}

${divergenceLine}

Althistory keeps the history as a graph of events, arcs (periods) and causal links, checks it for contradictions, and branches it at any event. Timestamps are real ISO-8601 dates. Work in this order.

1. Draft. althistory_generate_timeline with premise and divergencePoint creates a graph with a first draft. Its result says who wrote it: "source": "model" when the althistory server has its own model key, or "template", a generic skeleton. With a template, build the draft yourself instead: althistory_create_graph, then althistory_create_arc, althistory_create_event and althistory_link_events.

2. Ground it. Before the divergence, the history is real. Where the draft gets real events wrong, correct them with althistory_create_event, or ingest a summary of what actually happened with althistory_ingest_text.

3. Make the consequences earn their place. For each event after the divergence, ask what real constraints apply, such as geography, logistics, the people alive at the time and what they wanted. Link each consequence to its causes with althistory_link_events and a sentence of reasoning, and cut what nothing caused.

4. Check it. Run althistory_validate_graph and fix what it reports.

5. Read it back with althistory_export_context, and tell the author where the history is weakest.

6. Branch at the most contested moment with althistory_branch_timeline, so the author can compare two outcomes side by side.`;
}

function growHistory(args: Record<string, string>): string {
  const graphId = args.graphId;
  const which = graphId
    ? `graph ${graphId}`
    : 'a graph they will name. Call althistory_list_graphs and ask which one, unless they have already said';
  return `You are helping an author extend a history they already have in althistory: ${which}.

1. Read it. althistory_export_context with ${graphId ? `graphId ${graphId}` : 'its graphId'} returns the whole history as Markdown, with event ids and causal links. Summarise it for the author in a few lines, and name the threads that are still open.

2. Choose where to grow. Ask the author which thread to follow, or propose one. To write what happens next yourself, use althistory_create_event and althistory_link_events. To let the engine propose it, use althistory_simulate_timeline with dryRun true first, show the author what it would add, and run it again without dryRun only if they want it. The simulation is a mechanical model of pressures between actors, not a writer: its events are terse and repetitive, so treat them as prompts for what to write, not as finished history.

3. Check it. Run althistory_validate_graph after every change, and fix what it reports.

4. Branch instead of overwriting. When the author is torn between two courses, branch at the event where they part with althistory_branch_timeline, and keep both.`;
}

const PROMPTS: PromptSpec[] = [
  {
    name: 'worldbuild',
    description: 'Build the history of an invented world: its calendar, ages, events and causes, checked as you go',
    arguments: [
      { name: 'eraLabel', description: 'Written after a year, as in "312 AR"; without one, years read "Year 312"', required: false },
      { name: 'epochYear', description: "The stored year that is the world's year 1 (default 1000)", required: false },
      {
        name: 'world',
        description: 'The world in a few sentences: its peoples, its land, what is at stake. Leave it out to describe the world in your next message.',
        required: false,
      },
    ],
    render: worldbuild,
  },
  {
    name: 'alternate_history',
    description: 'Explore an alternate history: draft it from a premise, ground it in what really happened, and branch it',
    arguments: [
      {
        name: 'premise',
        description: 'The what-if, e.g. "Byzantium wins at Manzikert". Leave it out to give it in your next message.',
        required: false,
      },
      { name: 'divergencePoint', description: 'Where real history turns, e.g. "1071-08-26: the Seljuk flank breaks"', required: false },
    ],
    render: alternateHistory,
  },
  {
    name: 'grow_history',
    description: 'Extend a history you already have: read it, grow one thread, validate, and branch where it forks',
    arguments: [
      {
        name: 'graphId',
        description: 'The graph to extend (althistory graph list shows the ids); without it, the agent lists them and asks',
        required: false,
      },
    ],
    render: growHistory,
  },
];

/** The prompts, as `prompts/list` describes them. */
export const MCP_PROMPTS: McpPromptDefinition[] = PROMPTS.map(({ name, description, arguments: args }) => ({
  name,
  description,
  arguments: args,
}));

/**
 * One prompt with its arguments filled in. Throws a validation error for an
 * unknown prompt or a missing required argument.
 */
export function renderPrompt(name: string, rawArgs: Record<string, unknown> = {}): { description: string; text: string } {
  const spec = PROMPTS.find((prompt) => prompt.name === name);
  if (!spec) {
    throw new ValidationErrorCLI(
      `Unknown prompt "${name}". The prompts are: ${PROMPTS.map((prompt) => prompt.name).join(', ')}`
    );
  }
  const args: Record<string, string> = {};
  for (const argument of spec.arguments) {
    const value = rawArgs[argument.name];
    if (value === undefined || value === null || String(value).trim() === '') {
      if (argument.required) {
        throw new ValidationErrorCLI(`The ${name} prompt needs the argument "${argument.name}": ${argument.description}`);
      }
      continue;
    }
    args[argument.name] = String(value).trim();
  }
  const known = new Set(spec.arguments.map((argument) => argument.name));
  const unknown = Object.keys(rawArgs).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new ValidationErrorCLI(
      `The ${name} prompt does not take ${unknown.map((key) => `"${key}"`).join(', ')}. It takes: ${spec.arguments
        .map((argument) => argument.name)
        .join(', ')}`
    );
  }
  return { description: spec.description, text: spec.render(args) };
}
