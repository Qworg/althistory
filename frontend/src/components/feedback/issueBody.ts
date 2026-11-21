/**
 * The GitHub issue a feedback report becomes (issue #49): its body, and the
 * prefilled new-issue link used when the server does not file reports.
 *
 * The same body goes both ways. The captured state is neutralised here, so it
 * can never mention anyone or cross-reference an issue. The reporter's own
 * words are left as written: on GitHub's form they post as themselves, and a
 * "see #45" is theirs to make. The server, which files with its own token,
 * neutralises the whole report again, because it cannot trust what it is sent.
 */

import type { FeedbackContext } from './captureContext'

export type FeedbackKind = 'bug' | 'idea' | 'other'

export const KIND_LABELS: Record<FeedbackKind, string | null> = {
  bug: 'bug',
  idea: 'enhancement',
  other: null,
}

export const DEFAULT_FEEDBACK_REPO = 'Qworg/althistory'
export const FEEDBACK_LABEL = 'feedback'

/**
 * GitHub answers a new-issue link longer than about 8 KB with an error page,
 * so the whole URL is kept under this.
 */
export const PREFILLED_URL_BUDGET = 7500

const ZWSP = '​'

/**
 * See the server's `neutralizeGitHubReferences`: the same rule, which is
 * deliberately blunt (every narrower one leaked). A zero-width space follows
 * every `&` (so no character reference is decoded), every `@` before a name
 * character, every `#` or `GH-` before a digit, and the start of an issue,
 * pull or commit number in a URL. It is idempotent, and the text reads the same.
 */
export function neutralizeGitHubReferences(text: string): string {
  return text
    .replace(/&(?!\u200B)/g, `&${ZWSP}`)
    .replace(/@(?=[A-Za-z0-9_-])/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/GH-(?=\d)/gi, (match) => `${match}${ZWSP}`)
    .replace(/\/(issues|pull|pulls|discussions|commit|commits)\/(?=[0-9a-f])/gi, `/$1/${ZWSP}`)
}

/** A code fence longer than any run of backticks in the text, so the text cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Captured text for a code span on one line: no backticks to close it, no line breaks. */
function code(text: string): string {
  return `\`${text.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").trim()}\``
}

/** Captured text as plain words on one Markdown line: every markup character escaped. */
function plain(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>#|~]/g, '\\$&').trim()
}

function jsonBlock(value: unknown): string {
  const json = JSON.stringify(value, null, 2)
  const fence = fenceFor(json)
  return `${fence}json\n${json}\n${fence}`
}

export interface BodyParts {
  kind: FeedbackKind
  description: string
  context: FeedbackContext | null
  /** How the screenshot reaches the issue: pasted by the reporter, added by the server, or not at all. */
  screenshot: 'paste' | 'server' | 'none'
}

/** How much of the captured state to keep, from all of it down to none. */
type Trim = 0 | 1 | 2 | 3

function trimmed(context: FeedbackContext, level: Trim): Partial<FeedbackContext> | null {
  if (level === 0) return context
  if (level === 1) return { ...context, errors: context.errors.slice(-3) }
  if (level === 2) {
    return {
      capturedAt: context.capturedAt,
      page: context.page,
      graph: context.graph,
      mode: context.mode,
      environment: context.environment,
      state: { ...context.state, selectedEvents: context.state.selectedEvents.slice(0, 3), selectedArcs: context.state.selectedArcs.slice(0, 3) },
    }
  }
  return null
}

const KIND_HEADINGS: Record<FeedbackKind, string> = {
  bug: 'What went wrong',
  idea: 'The idea',
  other: 'Feedback',
}

function render(parts: BodyParts, level: Trim): string {
  const description = parts.description.trim()
  const head = `### ${KIND_HEADINGS[parts.kind]}\n\n${description || '_No description given._'}`
  const sections: string[] = []

  if (parts.screenshot === 'paste') {
    sections.push(
      '### Screenshot\n\n<!-- The screenshot is on your clipboard: paste it on the line below (Ctrl+V or ⌘V). ' +
        'If it is not, use the Download button in the app and drag the file here. -->\n'
    )
  }

  if (parts.context) {
    const where = parts.context
    const kept = trimmed(where, level)
    const summary = [
      `- **Page:** ${code(where.page.route)} (${where.page.view} view)`,
      `- **Graph:** ${where.graph.name ? `${plain(where.graph.name)} ` : ''}${code(where.graph.id ?? 'none')}`,
      `- **App:** ${where.mode === 'demo' ? 'the Pages demo' : 'the app'}, ${where.environment.app.version} (${where.environment.app.commit})`,
      `- **Browser:** ${code(where.environment.userAgent)}`,
      `- **Window:** ${where.environment.viewport.width}×${where.environment.viewport.height} at ${where.environment.viewport.devicePixelRatio}×, ${where.state.theme.shown} theme`,
    ]
    if (where.errors.length > 0) summary.push(`- **Recent errors:** ${where.errors.length}`)
    sections.push(`### Where\n\n${summary.join('\n')}`)
    if (kept) {
      sections.push(`<details><summary>App state when the report was opened</summary>\n\n${jsonBlock(kept)}\n\n</details>`)
    } else {
      sections.push('_The full app state was left out to fit GitHub\'s link; the summary above is what was captured._')
    }
  }

  sections.push(`<sub>Sent from the in-app feedback button.</sub>`)
  return [head, neutralizeGitHubReferences(sections.join('\n\n'))].join('\n\n')
}

/** The issue body, with all of the captured state. */
export function buildIssueBody(parts: BodyParts): string {
  return render(parts, 0)
}

export function labelsFor(kind: FeedbackKind): string[] {
  const label = KIND_LABELS[kind]
  return label ? [label, FEEDBACK_LABEL] : [FEEDBACK_LABEL]
}

function prefilledUrl(repo: string, title: string, body: string, labels: string[]): string {
  const query = new URLSearchParams({ title, body, labels: labels.join(',') })
  return `https://github.com/${repo}/issues/new?${query.toString()}`
}

export interface PrefilledIssue {
  url: string
  /**
   * True when even the reporter's own words did not fit the link: the body in
   * the link then asks them to paste the report, and `fullBody` is what the
   * app copies for them.
   */
  bodyOnClipboard: boolean
  fullBody: string
}

/**
 * The new-issue link. The captured state is trimmed until the link fits; the
 * reporter's own words never are. If they alone are too long, the link says
 * to paste the report and the app copies it (`bodyOnClipboard`).
 */
export function buildPrefilledIssue(repo: string, title: string, parts: BodyParts): PrefilledIssue {
  const labels = labelsFor(parts.kind)
  const safeTitle = title.replace(/\s+/g, ' ').trim()
  const fullBody = render(parts, 0)
  for (const level of [0, 1, 2, 3] as const) {
    const url = prefilledUrl(repo, safeTitle, render(parts, level), labels)
    if (url.length <= PREFILLED_URL_BUDGET) return { url, bodyOnClipboard: false, fullBody }
  }
  // The pasted body has no room for a pasted screenshot as well: the app offers the download.
  const textOnly = render({ ...parts, screenshot: 'none' }, 0)
  const placeholder =
    '<!-- The report was too long for a link. It is on your clipboard: paste it here (Ctrl+V or ⌘V). -->\n'
  return { url: prefilledUrl(repo, safeTitle, placeholder, labels), bodyOnClipboard: true, fullBody: textOnly }
}
