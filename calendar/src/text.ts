/**
 * The rules a name or a label in a calendar follows: what it may not hold,
 * that it has something visible in it, that text-direction controls in it are
 * closed, and the key two names are compared by. Shared by month names, a
 * world's part, era and weekday names, and labels.
 */

/**
 * What no month name may hold: a comma, which separates the names in the
 * flags, the export and what a model is told ("Thaw, early" would read as two
 * months and shift the rest); a `|`, which splits a Markdown table cell; a
 * control character, such as a newline that would start a line of its own in
 * a model's instructions; and brackets and double quotes, which in a name
 * mean a list was pasted as text ('["Lowtide", …]', "[Lowtide, …]") and split
 * in the wrong place. An apostrophe is fine.
 */
export const FORBIDDEN_IN_MONTH_NAME = /[,|"[\]\p{Cc}\p{Zl}\p{Zp}]/u
/**
 * What the era label and the calendar's name may not hold, for the same
 * reasons: the label is in every date of an export's tables, and both go into
 * a model's instructions. A comma is fine in them; nothing lists them.
 */
export const FORBIDDEN_IN_LABEL = /[|\p{Cc}\p{Zl}\p{Zp}]/u

/**
 * Whether every text-direction control the text opens is closed, as Unicode's
 * bidi algorithm (UAX #9) closes them: an embedding or override
 * (\u202A, B, D, E) by \u202C (PDF), an isolate (\u2066-8) by
 * \u2069 (PDI), which also closes any embedding opened inside it. A PDF
 * never closes an isolate, and a closer with nothing open does nothing, so
 * neither is refused. Closed, the controls keep their effect inside the text,
 * which is how right-to-left text is set into a label; one left open would
 * reorder every date the label is written into.
 */
export function bidiClosed(text: string): boolean {
  const open: Array<'embedding' | 'isolate'> = []
  for (const char of text) {
    if (char === '\u202A' || char === '\u202B' || char === '\u202D' || char === '\u202E') open.push('embedding')
    else if (char === '\u2066' || char === '\u2067' || char === '\u2068') open.push('isolate')
    else if (char === '\u202C') {
      if (open[open.length - 1] === 'embedding') open.pop()
    } else if (char === '\u2069') {
      const at = open.lastIndexOf('isolate')
      if (at >= 0) open.length = at
    }
  }
  return open.length === 0
}

/**
 * What a reader cannot see: spaces, the characters Unicode says to render as
 * nothing (Default_Ignorable_Code_Point: zero-width spaces and joiners, soft
 * hyphens, variation selectors, the Hangul fillers), the blank braille
 * pattern and the interlinear annotation marks (U+FFF9 to U+FFFB). Text may
 * hold them (Persian writes a zero-width non-joiner inside words) but cannot
 * be made of them alone.
 */
export const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}\u2800\uFFF9-\uFFFB]/u

/** Whether text has a character a reader can see. */
export function hasVisible(text: string): boolean {
  return [...text].some((char) => !INVISIBLE.test(char))
}

/**
 * The key two month names are compared by: without what a reader cannot
 * see, composed alike, in lower case, so "Thaw", "THAW" and "Thaw\u200B"
 * are one name. The three subdivision flags Unicode recommends (England,
 * Scotland, Wales: a black flag, tag letters, a cancel tag) are kept whole,
 * since their tags are what tell one from another. Any other tag sequence is
 * drawn as the bare black flag, so its tags are padding like the rest.
 */
export const NOT_SEEN =
  /(\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F})|[\p{Default_Ignorable_Code_Point}\u2800\uFFF9-\uFFFB]/gu

export function sameNameKey(name: string): string {
  return name
    .replace(NOT_SEEN, (_char: string, flag: string | undefined) => flag ?? '')
    .normalize('NFC')
    .toLowerCase()
}
