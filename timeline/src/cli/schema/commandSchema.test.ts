/**
 * The JSON Schema of the CLI's own commands.
 *
 * The schema is what an agent reads to know what a command takes, so the
 * options a command cannot do without have to be marked as required, and the
 * definition of a command has to be tied to the command it describes.
 */

import { describe, it, expect } from 'vitest';
import { createProgram } from '../index';
import { buildCommandJsonSchema } from './commandSchema';

function definitionOf(schema: Record<string, unknown>, path: string): Record<string, unknown> {
  const defs = schema.$defs as Record<string, Record<string, unknown>>;
  const definition = defs[path];
  expect(definition).toBeDefined();
  return definition;
}

function optionsOf(definition: Record<string, unknown>): Record<string, unknown> {
  const properties = definition.properties as Record<string, Record<string, unknown>>;
  return properties.options;
}

describe('the JSON Schema of the commands', () => {
  const schema = buildCommandJsonSchema(createProgram());

  it('names every command it accepts', () => {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const command = properties.command;
    expect(command.enum).toContain('arc assign');
    expect(command.enum).toContain('event add');
    expect(command.enum).toContain('validate');
  });

  it('marks the options a command cannot do without as required', () => {
    const definition = definitionOf(schema, 'arc assign');
    const options = optionsOf(definition);

    expect(options.required).toEqual(['graphId', 'arc']);
    // The options object itself is required when it holds required options,
    // and so are the arguments: `minItems` inside an optional property is
    // inert, so the array has to be required for it to constrain anything.
    expect(definition.required).toEqual(['options', 'arguments']);
  });

  it('requires the arguments of a command that has a required argument', () => {
    // `arc assign <event-id> --graph-id … --arc …` cannot run without its
    // event id. `minItems` inside an optional `arguments` property is inert,
    // so the array itself has to be required for the count to constrain
    // anything: a document with no `arguments` at all must not validate.
    const definition = definitionOf(schema, 'arc assign');
    const properties = definition.properties as Record<string, Record<string, unknown>>;
    const args = properties.arguments;

    expect(definition.required).toContain('arguments');
    expect(args.minItems).toBe(1);
  });

  it('does not require the arguments of a command that takes none', () => {
    // The other direction: a command whose arguments are all optional must not
    // be made to carry an `arguments` array.
    const definition = definitionOf(schema, 'graph list');
    const required = (definition.required as string[] | undefined) ?? [];

    expect(required).not.toContain('arguments');
  });

  it('ties every command to its own definition', () => {
    // The `command` enum alone would let any command name any shape; the
    // `allOf`/`if`/`then` wiring is what makes the definition apply.
    const branches = schema.allOf as Array<Record<string, unknown>>;
    expect(branches).toHaveLength((schema.$defs as Record<string, unknown>) ? branches.length : 0);

    for (const branch of branches) {
      const condition = branch.if as { properties: { command: { const: string } } };
      const then = branch.then as { $ref: string };
      const path = condition.properties.command.const;
      expect(then.$ref).toBe(`#/$defs/${encodeURIComponent(path)}`);
      expect(definitionOf(schema, path)).toBeDefined();
    }
  });

  it('leaves the options of a command that needs none alone', () => {
    const definition = definitionOf(schema, 'status');
    const options = optionsOf(definition);

    expect(options.required).toBeUndefined();
    expect(definition.required).toBeUndefined();
  });

  it('ties every command to the definition that describes it', () => {
    const allOf = schema.allOf as Array<{ if: { properties: { command: { const: string } } }; then: { $ref: string } }>;
    expect(Array.isArray(allOf)).toBe(true);

    const refFor = (path: string): string | undefined =>
      allOf.find((entry) => entry.if.properties.command.const === path)?.then.$ref;

    // The reference points at the definition of that very command.
    expect(refFor('arc assign')).toBe(`#/$defs/${encodeURIComponent('arc assign')}`);
    expect(refFor('event add')).toBe(`#/$defs/${encodeURIComponent('event add')}`);

    // And every command of the enum has one.
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const commands = properties.command.enum as string[];
    for (const command of commands) {
      expect(refFor(command)).toBeDefined();
    }
  });

  it('refuses an option the command does not know', () => {
    const definition = definitionOf(schema, 'arc assign');
    const options = optionsOf(definition);
    expect(options.additionalProperties).toBe(false);
  });
});
