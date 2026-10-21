/**
 * The JSON Schema of the CLI's own commands.
 *
 * The `althistory schema` command answers with a description of what the CLI
 * accepts: every command, the arguments it takes and the options it
 * understands. The description is derived from the commander program itself,
 * so it cannot drift away from the commands that are actually registered.
 *
 * The MCP tool schemas are a different thing -- they describe the tools the
 * `althistory mcp` server offers -- and are reported separately.
 */

import { Command, Option } from 'commander';

/** One argument of a command. */
export interface ArgumentSchema {
  name: string;
  required: boolean;
  variadic: boolean;
  description: string;
}

/** One option of a command. */
export interface OptionSchema {
  flags: string;
  attribute: string;
  description: string;
  required: boolean;
  takesValue: boolean;
  default?: string;
}

/** A command and everything under it. */
export interface CommandSchema {
  path: string;
  description: string;
  usage: string;
  arguments: ArgumentSchema[];
  options: OptionSchema[];
  subcommands: CommandSchema[];
}

function describeArguments(command: Command): ArgumentSchema[] {
  return command.registeredArguments.map((argument) => ({
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description || '',
  }));
}

function describeOptions(options: readonly Option[]): OptionSchema[] {
  return options
    .filter((option) => !option.hidden)
    .map((option) => ({
      flags: option.flags,
      attribute: option.attributeName(),
      description: option.description,
      required: option.mandatory,
      takesValue: Boolean(option.required || option.optional),
      default: option.defaultValue === undefined ? undefined : String(option.defaultValue),
    }));
}

/**
 * The schema of a command and its sub-commands.
 *
 * The path of a command is the path the user types after the name of the
 * program: `graph create`, not `althistory graph create`.
 */
function buildSchema(command: Command, prefix: string): CommandSchema {
  const path = prefix ? `${prefix} ${command.name()}` : command.name();
  return {
    path,
    description: command.description(),
    usage: command.usage(),
    arguments: describeArguments(command),
    options: describeOptions(command.options),
    subcommands: command.commands.map((sub) => buildSchema(sub, path)),
  };
}

/**
 * The schema of one command, as a definition of the document.
 */
function commandDefinition(schema: CommandSchema): Record<string, unknown> {
  const optionProperties: Record<string, unknown> = {};
  for (const option of schema.options) {
    optionProperties[option.attribute] = {
      description: option.description,
      // A value option takes a string, a number or a boolean: the root
      // schema says the same about every option, and the two have to agree.
      type: option.takesValue ? ['string', 'number', 'boolean'] : 'boolean',
      ...(option.default !== undefined ? { default: option.default } : {}),
    };
  }

  const requiredOptions = schema.options.filter((option) => option.required).map((option) => option.attribute);

  const optionsSchema: Record<string, unknown> = {
    type: 'object',
    description: 'The options of the command, keyed by their long name.',
    properties: optionProperties,
    additionalProperties: false,
  };
  if (requiredOptions.length > 0) {
    // The options the command cannot do without are required: a document
    // that leaves one of them out is not a document of that command.
    optionsSchema.required = requiredOptions;
  }

  const properties: Record<string, unknown> = { options: optionsSchema };

  if (schema.arguments.length > 0) {
    properties.arguments = {
      type: 'array',
      description: 'The positional arguments of the command, in order.',
      items: { type: 'string' },
      minItems: schema.arguments.filter((argument) => argument.required).length,
      maxItems: schema.arguments.length,
    };
  }

  const definition: Record<string, unknown> = {
    type: 'object',
    description: schema.description,
    properties,
  };
  if (requiredOptions.length > 0) {
    definition.required = ['options'];
  }
  return definition;
}

/**
 * The JSON Schema of every command the CLI accepts.
 */
export function buildCommandJsonSchema(program: Command): Record<string, unknown> {
  const defs: Record<string, unknown> = {};
  const commandPaths: string[] = [];

  const addDefs = (schema: CommandSchema): void => {
    defs[schema.path] = commandDefinition(schema);
    commandPaths.push(schema.path);
    for (const sub of schema.subcommands) {
      addDefs(sub);
    }
  };

  // The program itself is not a command the user types; its sub-commands are
  // the paths, and they are named without the name of the program.
  for (const sub of program.commands) {
    addDefs(buildSchema(sub, ''));
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://althistory.dev/schemas/cli-command.json',
    title: 'Althistory CLI command',
    description:
      'A command of the Althistory CLI, its positional arguments and its options. ' +
      'The command definitions are listed under $defs, keyed by the command path.',
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'The command, with its sub-command when it has one.',
        enum: commandPaths,
      },
      arguments: {
        type: 'array',
        description: 'The positional arguments of the command, in order.',
        items: { type: 'string' },
      },
      options: {
        type: 'object',
        description: 'The options of the command, keyed by their long name.',
        additionalProperties: { type: ['string', 'number', 'boolean'] },
      },
    },
    // The command names the definition that constrains it: the definition of
    // `arc assign` says which options it takes and which of them are
    // required, and that only holds for a document whose command is
    // `arc assign`.
    allOf: commandPaths.map((path) => ({
      if: {
        properties: { command: { const: path } },
        required: ['command'],
      },
      then: { $ref: `#/$defs/${encodeURIComponent(path)}` },
    })),
    $defs: defs,
  };
}
