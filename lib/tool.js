/**
 * The `system_notify` agent tool.
 *
 * The tool is deliberately thin: it validates the notification, parks it in the
 * hub, and reports whether a client was listening. Raising the OS banner is the
 * Client half's job, because the banner carries the identity of whatever posts
 * it and only the page rendering the Harness can make it say "DeepSeek Harness".
 */

function textOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

/**
 * Build the tool over a hub.
 *
 * @param {import('./hub.js').NotificationHub} hub
 */
export function createSystemNotifyTool(hub) {
  return {
    name: 'system_notify',
    description: [
      'Send the user a native desktop notification that appears even while the Harness window is in the background or minimized.',
      'Use it when a long task finishes, or when you are blocked and need the user to come back and answer.',
      'The banner carries the Harness name and icon.',
      'Keep the body to one short sentence: banners truncate long text, and the details remain in the conversation.',
      'It is one-way: it does not wait for the user, and it does not bring the window forward.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: {
          type: 'string',
          description: 'Banner headline, naming the task or the reason for the alert. Reads best under about 60 characters.',
        },
        body: {
          type: 'string',
          description: 'The message itself as one short sentence, roughly 120 characters or less.',
        },
        silent: {
          type: 'boolean',
          description: 'Deliver without the notification sound. Defaults to false.',
        },
      },
      required: ['title', 'body'],
    },
    output: textOutput(),
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      const title = typeof input.title === 'string' ? input.title.trim() : ''
      const body = typeof input.body === 'string' ? input.body.trim() : ''
      if (title === '' || body === '') {
        return { ok: false, code: 'invalid-notification', message: 'title and body must both be non-empty' }
      }
      const { id, delivered, surface } = hub.push({
        title,
        body,
        ...(input.silent === true ? { silent: true } : {}),
      })
      return {
        ok: true,
        id,
        delivery: delivered ? 'delivered' : 'queued',
        ...(delivered ? { surface } : { note: 'No Harness window is listening right now; the notification shows as soon as one connects.' }),
      }
    },
  }
}
