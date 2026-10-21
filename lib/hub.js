/**
 * Host-side notification hub.
 *
 * The tool the agent calls lives in the Host process, but a notification carries
 * the identity of whatever posts it, and only the page rendering the Harness can
 * make the banner say "DeepSeek Harness". So the Host never talks to the OS: it
 * parks each request here and the Client half drains it.
 *
 * Delivery is a long poll, not a timer: the Client half keeps one request in
 * flight and the Host answers it the instant work arrives, so a notification
 * surfaces immediately without a request per second.
 *
 * Clients announce which surface they are (`desktop` for the Harness window,
 * `browser` for a page opened elsewhere) because the two do not produce the same
 * banner: only the desktop window carries the Harness identity. A desktop window
 * that is listening therefore wins, and a browser tab only receives work when no
 * Harness window is there to take it.
 */

/** Longest a held drain waits before the Client half simply asks again. */
const HOLD_MS = 25_000

/**
 * A request no client ever collected would otherwise replay the moment a window
 * opens hours later, so stale entries are dropped instead.
 */
const MAX_AGE_MS = 120_000

/** Cap the backlog so a stalled client cannot grow Host memory without bound. */
const MAX_PENDING = 32

/** Surfaces a client may claim, most capable first. */
const SURFACES = ['desktop', 'browser']

/**
 * Collects notification requests and hands them to the Client half.
 *
 * An entry goes to the first drain that sees it. A drain arriving while the
 * inbox is empty is held open until work appears, the caller goes away, or the
 * hold expires.
 */
export class NotificationHub {
  #pending = []
  #waiters = new Set()
  #sequence = 0

  /** Number of requests waiting for a client. */
  get pending() {
    return this.#pending.length
  }

  /** Surfaces of the clients currently holding a drain open. */
  get listeners() {
    return [...new Set([...this.#waiters].map((waiter) => waiter.surface))]
  }

  /**
   * Park one notification for the next drain.
   *
   * @param {{title: string, body: string, silent?: boolean}} notification
   * @returns {{id: number, delivered: boolean, surface?: 'desktop' | 'browser'}}
   */
  push(notification) {
    this.#prune()
    const entry = {
      id: ++this.#sequence,
      title: notification.title,
      body: notification.body,
      ...(notification.silent === true ? { silent: true } : {}),
      queuedAt: Date.now(),
    }
    this.#pending.push(entry)
    if (this.#pending.length > MAX_PENDING) {
      this.#pending.splice(0, this.#pending.length - MAX_PENDING)
    }
    return { id: entry.id, ...this.#release() }
  }

  /** Drop entries that have waited too long to be worth showing. */
  #prune() {
    const cutoff = Date.now() - MAX_AGE_MS
    this.#pending = this.#pending.filter((entry) => entry.queuedAt >= cutoff)
  }

  /**
   * Hand the parked entries to the best available client.
   *
   * Every client of the winning surface takes the batch: two windows of the same
   * kind are two views of one session, and showing the banner once per view beats
   * dropping it for the one the user happens to be looking at.
   */
  #release() {
    if (this.#waiters.size === 0) return { delivered: false }
    this.#prune()
    if (this.#pending.length === 0) return { delivered: false }
    const surface = SURFACES.find((candidate) => [...this.#waiters].some((waiter) => waiter.surface === candidate))
    if (surface === undefined) return { delivered: false }
    const targets = [...this.#waiters].filter((waiter) => waiter.surface === surface)
    const batch = this.#pending
    this.#pending = []
    for (const waiter of targets) waiter.settle(batch)
    return { delivered: true, surface }
  }

  /**
   * Wait for work, then take everything waiting.
   *
   * Resolves with the batch, or with an empty array once `HOLD_MS` passes so the
   * caller can refresh its own liveness. An aborted `signal` resolves early with
   * whatever is parked, normally nothing, when the request is torn down.
   *
   * @param {{signal?: AbortSignal, surface?: 'desktop' | 'browser'}} [options]
   * @returns {Promise<Array<{id: number, title: string, body: string, silent?: boolean}>>}
   */
  drain(options = {}) {
    this.#prune()
    if (this.#pending.length > 0) {
      const batch = this.#pending
      this.#pending = []
      return Promise.resolve(batch)
    }
    if (options.signal?.aborted === true) return Promise.resolve([])

    const surface = SURFACES.includes(options.surface) ? options.surface : 'browser'
    return new Promise((resolve) => {
      const waiter = {
        surface,
        settle: (batch) => {
          cleanup()
          resolve(batch)
        },
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.#waiters.delete(waiter)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        resolve([])
      }
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter)
        options.signal?.removeEventListener('abort', onAbort)
        resolve([])
      }, HOLD_MS)
      this.#waiters.add(waiter)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Release every held drain; used when the plugin row unloads. */
  dispose() {
    for (const waiter of this.#waiters) waiter.settle([])
    this.#waiters.clear()
    this.#pending = []
  }
}
