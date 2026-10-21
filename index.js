/**
 * dsh-plugin-system-notify — Host half.
 *
 * Registers the `system_notify` agent tool and the inbox route that the Client
 * half drains. The Host never raises the OS notification itself: a notification
 * carries the identity of the process that posts it, and only the page that
 * renders the Harness can make the banner say "DeepSeek Harness". So the Host
 * parks each request and the Client half turns it into a native notification.
 */
import { NotificationHub } from './lib/hub.js'
import { createSystemNotifyTool } from './lib/tool.js'

export const name = 'system-notify'

/** `tools` is the whole point; the rest are optional and probed in `apply`. */
export const inject = ['tools']

/** Route the Client half polls for queued notifications. */
const INBOX_PATH = '/api/system-notify/inbox'

export function apply(ctx) {
  const hub = new NotificationHub()

  ctx.effect(() => {
    const disposer = ctx.tools.register(createSystemNotifyTool(hub))
    return () => {
      try {
        disposer()
      } catch {
        // plugin unload must keep going
      }
    }
  }, 'dsh-plugin-system-notify: agent tool')

  ctx.effect(() => () => hub.dispose(), 'dsh-plugin-system-notify: inbox cleanup')

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (webServer !== undefined && typeof webServer.register === 'function') {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: INBOX_PATH,
          handler: (req, res) => handleInbox(hub, connection, req, res),
        }),
      'dsh-plugin-system-notify: inbox route',
    )
  }
}

/**
 * Serve one drain.
 *
 * Only the notification payload crosses this route, so the trust fence is the
 * same one every other browser route uses: when the connection service is
 * present its Host/Origin and browser-credential checks decide admission;
 * without it the route falls back to loopback-only, which is what the Harness
 * listens on anyway.
 */
async function handleInbox(hub, connection, req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' })
    res.end()
    return
  }
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    const rejection = connection.requestRejection({ headers: req.headers })
    if (rejection !== undefined) {
      res.writeHead(rejection)
      res.end()
      return
    }
  } else if (!isLoopbackRequest(req)) {
    res.writeHead(403)
    res.end()
    return
  }

  const lifetime = new AbortController()
  const onClose = () => lifetime.abort()
  res.on('close', onClose)

  let batch
  try {
    batch = await hub.drain({ signal: lifetime.signal, surface: readSurface(req) })
  } finally {
    res.removeListener('close', onClose)
  }

  if (res.writableEnded || lifetime.signal.aborted) return
  const body = JSON.stringify({ notifications: batch })
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** Accept only requests addressed to this machine. */
function isLoopbackRequest(req) {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

/** Which surface the calling page claims to be; unknown values fall back to browser. */
function readSurface(req) {
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('surface')
  return query === 'desktop' ? 'desktop' : 'browser'
}
