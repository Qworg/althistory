import { describe, it, expect } from 'vitest'
import {
  PREFILLED_URL_BUDGET,
  buildIssueBody,
  buildPrefilledIssue,
  labelsFor,
  neutralizeGitHubReferences,
  type BodyParts,
} from './issueBody'
import type { FeedbackContext } from './captureContext'

const ZWSP = '​'

function context(overrides: Partial<FeedbackContext> = {}): FeedbackContext {
  return {
    capturedAt: '2026-11-21T10:00:00.000Z',
    page: { route: '/timeline?event=evt_1', view: 'timeline', title: 'althistory' },
    graph: { id: 'graph_1', name: 'The Engine Age' },
    mode: 'app',
    state: {
      selectedEvents: ['evt_1'],
      selectedArcs: [],
      filters: {},
      timeline: { zoomLevel: 1, centerTime: null },
      causalLayout: 'time',
      layoutMode: 'sidebar',
      theme: { preference: 'system', shown: 'dark' },
      sidebarCollapsed: false,
      filterPanelOpen: false,
    },
    environment: {
      app: { version: '0.0.0', commit: 'abc1234' },
      userAgent: 'TestBrowser/1.0',
      language: 'en-GB',
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
      online: true,
      queuedWrites: 0,
      queuedWritesWithoutGraph: 0,
    },
    errors: [],
    ...overrides,
  }
}

const parts = (overrides: Partial<BodyParts> = {}): BodyParts => ({
  kind: 'bug',
  description: 'The timeline goes blank.',
  context: context(),
  screenshot: 'paste',
  ...overrides,
})

describe('buildIssueBody', () => {
  it('puts the reporter’s words first, then where they were, then the state', () => {
    const body = buildIssueBody(parts())
    const order = ['### What went wrong', 'The timeline goes blank.', '### Screenshot', '### Where', '<details>']
    const positions = order.map((marker) => body.indexOf(marker))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(body).toContain('`/timeline?event=evt_1` (timeline view)')
    expect(body).toContain('The Engine Age `graph_1`')
    expect(body).toContain('"selectedEvents": [')
  })

  it('leaves the reporter’s own references alone but neutralises the captured ones', () => {
    const body = buildIssueBody(
      parts({ description: 'Like #45, cc @maintainer', context: context({ graph: { id: 'g', name: 'Ask @someone about #3' } }) })
    )
    expect(body).toContain('Like #45, cc @maintainer')
    expect(body).toContain(`Ask @${ZWSP}someone about #${ZWSP}3`)
  })

  it('cannot be broken out of: a backtick run in the state gets a longer fence, and captured text loses its markup', () => {
    const body = buildIssueBody(
      parts({ context: context({ graph: { id: 'g', name: '```</details><img src=x>' } }) })
    )
    expect(body).toMatch(/````json\n/)
    // The summary line carries no markup of the name's.
    const where = body.split('\n').find((line) => line.startsWith('- **Graph:**'))!
    expect(where).toBe('- **Graph:** \\`\\`\\`\\</details\\>\\<img src=x\\> `g`')
  })

  it('says when there is no description, and leaves the state out when asked', () => {
    const body = buildIssueBody(parts({ description: '  ', context: null, screenshot: 'none' }))
    expect(body).toContain('_No description given._')
    expect(body).not.toContain('### Where')
    expect(body).not.toContain('### Screenshot')
  })

  it('heads an idea as one', () => {
    expect(buildIssueBody(parts({ kind: 'idea' }))).toContain('### The idea')
  })
})

describe('labelsFor', () => {
  it('maps each kind to its label, with feedback on every report', () => {
    expect(labelsFor('bug')).toEqual(['bug', 'feedback'])
    expect(labelsFor('idea')).toEqual(['enhancement', 'feedback'])
    expect(labelsFor('other')).toEqual(['feedback'])
  })
})

describe('buildPrefilledIssue', () => {
  it('links to the repository’s new-issue form with the title, body and labels', () => {
    const issue = buildPrefilledIssue('owner/repo', '  Blank\n timeline ', parts())
    const url = new URL(issue.url)
    expect(url.origin + url.pathname).toBe('https://github.com/owner/repo/issues/new')
    expect(url.searchParams.get('title')).toBe('Blank timeline')
    expect(url.searchParams.get('labels')).toBe('bug,feedback')
    expect(url.searchParams.get('body')).toBe(buildIssueBody(parts()))
    expect(issue.bodyOnClipboard).toBe(false)
  })

  it('trims the captured state, never the description, to fit the link', () => {
    const errors = Array.from({ length: 15 }, (_, i) => ({
      kind: 'error' as const,
      at: '2026-11-21T10:00:00.000Z',
      message: `Error ${i}: ${'x'.repeat(280)}`,
      stack: 'at somewhere\n'.repeat(6),
    }))
    const description = 'Steps: '.padEnd(1500, 'y')
    const issue = buildPrefilledIssue('owner/repo', 'Title', parts({ description, context: context({ errors }) }))
    expect(issue.url.length).toBeLessThanOrEqual(PREFILLED_URL_BUDGET)
    expect(issue.bodyOnClipboard).toBe(false)
    const body = new URL(issue.url).searchParams.get('body')!
    expect(body).toContain(description)
    expect(body).toContain('### Where')
    // The full body still has every error, for the clipboard or the server.
    expect(issue.fullBody).toContain('Error 0:')
  })

  it('puts the report on the clipboard when the description alone is too long for a link', () => {
    const description = 'é'.repeat(3000)
    const issue = buildPrefilledIssue('owner/repo', 'Title', parts({ description }))
    expect(issue.url.length).toBeLessThanOrEqual(PREFILLED_URL_BUDGET)
    expect(issue.bodyOnClipboard).toBe(true)
    expect(issue.fullBody).toContain(description)
    expect(issue.fullBody).not.toContain('### Screenshot')
    expect(new URL(issue.url).searchParams.get('body')).toMatch(/on your clipboard/)
  })
})

describe('neutralizeGitHubReferences', () => {
  it('matches the server’s rule', () => {
    expect(neutralizeGitHubReferences('@a #1 o/r#2 GH-3 github.com/a/b/issues/4 me@example.com')).toBe(
      `@${ZWSP}a #${ZWSP}1 o/r#${ZWSP}2 GH-${ZWSP}3 github.com/a/b/issues/${ZWSP}4 me@example.com`
    )
  })
})

describe('neutralizeGitHubReferences, after the first review', () => {
  it.each([
    ['`x`@octocat', `\`x\`@${ZWSP}octocat`],
    ['&#x40;octocat', `@${ZWSP}octocat`],
    ['&commat;octocat', `@${ZWSP}octocat`],
    ['o/r&#x23;1', `o/r#${ZWSP}1`],
  ])('neutralises %s in captured text', (input, expected) => {
    expect(neutralizeGitHubReferences(input)).toBe(expected)
  })
})
