/**
 * Reading the text an ingestion command works on.
 *
 * The text can come from three places: the argument, a file, or the standard
 * input -- which is what a pipe gives (`cat notes.txt | althistory ingest
 * text`). The order is the one the command has always used: a file wins over
 * an inline argument, and the standard input is only read when there is
 * nothing else.
 */

import * as fs from 'fs';

/** Where the text may come from. */
export interface InputTextOptions {
  /** The text given as an argument. */
  inlineText?: string;
  /** The path of a file holding the text. */
  file?: string;
  /** The stream to read when there is nothing else. */
  stdin?: NodeJS.ReadableStream;
  /** Whether the standard input is a terminal; a terminal is never read. */
  stdinIsTerminal?: boolean;
}

/**
 * Read the text of an ingestion command.
 *
 * Returns an empty string when there is nothing to read; the caller decides
 * whether that is an error, because only the caller knows whether the
 * command was asked to do anything.
 */
export async function readInputText(options: InputTextOptions): Promise<string> {
  if (options.file) {
    return fs.readFileSync(options.file, 'utf-8');
  }

  if (options.inlineText) {
    return options.inlineText;
  }

  const stdin = options.stdin;
  if (!stdin || options.stdinIsTerminal) {
    return '';
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}
