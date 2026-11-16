import { test, expect, type Page, type WebSocketRoute } from '@playwright/test'
import { feedToken, installApiStub, type StreamTokenAnswer } from './support/api'

/**
 * Flow 5: the live sync badge, against a real browser WebSocket.
 *
 * The feed's socket (`/api/ws/stream`) is answered by `page.routeWebSocket`, a
 * stand-in for the server that speaks the stream protocol, so the app's own
 * client runs end to end: the token request, the socket, the handshake, the
 * subscriptions and the badge they drive.
 */

interface FakeStream {
  sockets: WebSocketRoute[]
  /** What the page sent on each socket, parsed. */
  received: Array<Array<Record<string, unknown>>>
}

/**
 * Stand in for the stream server. `accept(n)` decides whether the n-th socket
 * (from 1) is let in; one that is confirms every subscribe it is sent.
 */
async function fakeStream(page: Page, accept: (n: number) => boolean): Promise<FakeStream> {
  const stream: FakeStream = { sockets: [], received: [] }
  await page.routeWebSocket(/\/api\/ws\/stream/, (ws) => {
    stream.sockets.push(ws)
    const n = stream.sockets.length
    const received: Array<Record<string, unknown>> = []
    stream.received.push(received)
    if (!accept(n)) {
      ws.send(JSON.stringify({ type: 'auth_result', success: false, error: 'The API key this token was issued to is missing, inactive or expired' }))
      return
    }
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>
      received.push(message)
      if (message.type === 'subscribe') {
        ws.send(JSON.stringify({ type: 'subscribed', graphId: message.graphId, epoch: 'E1', seq: 0, replayed: 0 }))
      }
    })
    ws.send(JSON.stringify({ type: 'auth_result', success: true, sessionId: `s${n}`, mode: 'feed' }))
  })
  return stream
}

const badge = (page: Page, name: string) => page.getByRole('status', { name, exact: true })

test.describe('live sync badge', () => {
  test('offers Retry when the feed is refused, and reconnects when it is clicked', async ({ page }) => {
    const streamToken: StreamTokenAnswer = (_request, attempt) => feedToken(`token-${attempt}`, 'graph-main')
    const api = await installApiStub(page, { streamToken })
    // The first socket is refused, as a revoked key's would be; the next is let in.
    const stream = await fakeStream(page, (n) => n > 1)

    await page.goto('/')
    await expect(page.locator('svg[data-timeline-canvas]')).toBeVisible()

    const refused = badge(page, "Couldn't start live sync")
    await expect(refused).toBeVisible()
    // Refused for good: it does not try again by itself.
    await page.waitForTimeout(1500)
    expect(stream.sockets).toHaveLength(1)

    await refused.getByRole('button', { name: 'Retry' }).click()
    await expect(badge(page, 'Live sync on')).toBeVisible()
    expect(stream.sockets).toHaveLength(2)
    expect(stream.sockets[1]!.url()).toContain('token=token-2')
    expect(api.streamTokenRequests.map((request) => request.graphId)).toEqual(['graph-main', 'graph-main'])
    expect(stream.received[1]).toEqual(
      expect.arrayContaining([
        { type: 'subscribe', graphId: 'graph-main' },
        { type: 'subscribe', graphId: '*' },
      ])
    )
    expect(api.unhandled).toEqual([])
  })

  test('keeps watching the graph list after the open graph is revoked, and says the graph is not watched', async ({ page }) => {
    // Once access is revoked a token for the graph is refused; one for the
    // graph list alone is still issued.
    let revoked = false
    const streamToken: StreamTokenAnswer = (request, attempt) => {
      if (request.body.channel === '*') return feedToken(`list-${attempt}`, '*')
      if (revoked) return { status: 403, body: { error: { message: "Access to graph 'graph-main' is not allowed" } } }
      return feedToken(`token-${attempt}`, 'graph-main')
    }
    const api = await installApiStub(page, { streamToken })
    const stream = await fakeStream(page, () => true)

    await page.goto('/')
    await expect(badge(page, 'Live sync on')).toBeVisible()

    // The server stops sending the open graph, then the session ends.
    revoked = true
    stream.sockets[0]!.send(JSON.stringify({ type: 'unsubscribed', graphId: 'graph-main', reason: 'access_revoked' }))
    await expect(badge(page, 'Live sync: not watching this graph')).toBeVisible()
    await expect(page.getByText('Live sync stopped for this graph: this key may no longer read it.')).toBeVisible()
    await stream.sockets[0]!.close()

    // It reconnects, for the graph list alone.
    await expect.poll(() => stream.sockets.length).toBe(2)
    await expect.poll(() => stream.received[1]!.filter((message) => message.type === 'subscribe')).toEqual([{ type: 'subscribe', graphId: '*' }])
    expect(api.streamTokenRequests.at(-1)).toEqual({ graphId: null, body: { mode: 'feed', channel: '*' } })
    await expect(badge(page, 'Live sync: not watching this graph')).toBeVisible()

    // Retry asks for the graph again; refused, it settles on the list once more.
    await badge(page, 'Live sync: not watching this graph').getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => stream.sockets.length).toBe(3)
    await expect.poll(() => stream.received[2]!.filter((message) => message.type === 'subscribe')).toEqual([{ type: 'subscribe', graphId: '*' }])
    expect(api.streamTokenRequests.slice(-2).map((request) => request.graphId)).toEqual(['graph-main', null])
    await expect(badge(page, 'Live sync: not watching this graph')).toBeVisible()
    expect(api.unhandled).toEqual([])
  })
})
