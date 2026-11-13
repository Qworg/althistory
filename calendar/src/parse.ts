/**
 * Reading a calendar's fields as people type them: in the app's form, in the
 * CLI's flags, and in an MCP tool's arguments. One reader each, so the three
 * cannot disagree about what a list of month names or a year is.
 */

/**
 * An epoch year as typed ("1000", " +1000 ") or sent (1000): an integer, or
 * null when it is not one. Whether it is in range is `calendarIssues`'s job,
 * so "0" and "-5" are read (and then refused with the range in the message);
 * digits too many for a safe integer read as ±Number.MAX_SAFE_INTEGER, out of
 * range like the number typed. A number must already be an integer: 1000.5,
 * NaN and Infinity are null.
 */
export function parseEpochYear(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^[+-]?\d+$/.test(text)) return null
  const year = Number(text)
  // Digits are a whole number however many there are. Past what a double
  // holds exactly (or at all: 400 nines are Infinity) it is clamped, still an
  // integer and still out of range, so the message names the range rather
  // than saying it is not a whole number.
  return Number.isSafeInteger(year) ? year : year < 0 ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
}

/**
 * Month names written as text:
 * - a JSON list ('["Lowtide", …]'), as an MCP client may send the array or a
 *   person paste it;
 * - one name per line, a comma ending a line dropped (a separator typed out of
 *   habit, "Thaw,"), and blank lines around the list ignored;
 * - otherwise, on one line, separated by commas, a comma after the last name
 *   dropped (it is not a thirteenth, empty name).
 * Text with no names in it ("", "," or " ") has none. A blank line in the
 * middle of a list is kept, and refused as an empty name. Anything else that
 * is not a name (brackets, quotes) stays in it and is refused by
 * `calendarIssues`: a bracketed list that is not JSON split in the wrong
 * place, and saying so beats guessing.
 */
export function parseMonthNames(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  if (/^\[[\s\S]*\]$/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed) && parsed.every((name) => typeof name === 'string')) {
        return (parsed as string[]).map((name) => name.trim())
      }
    } catch {
      // Not JSON: read as text below, and the brackets are refused in the names.
    }
  }
  if (text.includes('\n')) {
    return text.split(/\r?\n/).map((line) => line.trim().replace(/,$/, '').trim())
  }
  const list = text.replace(/,\s*$/, '')
  return list.trim() === '' ? [] : list.split(',').map((name) => name.trim())
}
