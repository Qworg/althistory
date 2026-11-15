/**
 * The WebSocket URL of the stream endpoint (`/api/ws/stream?token=<token>`),
 * on the API's host: the page's own, or the one `VITE_API_URL` (or
 * `VITE_API_BASE_URL`) names.
 */
export function getWebSocketStreamUrl(token: string): string {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const wsProtocol = isHttps ? 'wss:' : 'ws:'

  let host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000'
  const customApiUrl = import.meta.env?.VITE_API_URL || import.meta.env?.VITE_API_BASE_URL
  if (customApiUrl) {
    try {
      host = new URL(customApiUrl).host
    } catch {
      // Not a URL: the page's own host.
    }
  }

  return `${wsProtocol}//${host}/api/ws/stream?token=${encodeURIComponent(token)}`
}
