window.__ModuleLoader__.load({
	id: "dsh-plugin-system-notify",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * dsh-plugin-system-notify — Client half.
		 *
		 * This half exists for one reason: identity. A desktop notification is
		 * posted by whichever process raises it, and only the page rendering the
		 * Harness can make the banner read "DeepSeek Harness" with the Harness
		 * icon. So the Host tool parks a request and this half turns it into a
		 * native notification through the page's Notification API.
		 *
		 * The page is a long-poll client of the inbox route: one request stays in
		 * flight and resolves as soon as the Host has something to show. Nothing
		 * runs on a timer except the retry backoff after a failed request.
		 */

		const INBOX_PATH = "/api/system-notify/inbox";

		/** Reconnect delay bounds, in milliseconds, after a failed drain. */
		const RETRY_MIN_MS = 1_000;
		const RETRY_MAX_MS = 30_000;

		/** How often a client that cannot raise notifications re-checks permission. */
		const PERMISSION_POLL_MS = 5_000;

		/**
		 * Which surface this page is. Only the Harness desktop window produces a
		 * banner carrying the Harness identity; a page opened in a browser cannot,
		 * so it announces itself and yields to the desktop window.
		 */
		function surface() {
			try {
				return typeof location === "object" && location !== null && location.protocol === "dsh-app:" ? "desktop" : "browser";
			} catch {
				return "browser";
			}
		}

		/**
		 * Whether this page can actually raise a notification.
		 *
		 * A client that cannot must not take a batch: the notification would be
		 * consumed and never shown, and the Host would report it as delivered.
		 * So the drain stays closed until permission is granted.
		 */
		async function canNotify() {
			if (typeof Notification === "undefined") return false;
			if (Notification.permission === "granted") return true;
			if (Notification.permission === "denied") return false;
			try {
				await Notification.requestPermission();
			} catch {
				return false;
			}
			return Notification.permission === "granted";
		}

		/** Raise one native notification, tolerating platforms that reject it. */
		function show(notification) {
			if (typeof Notification === "undefined") return;
			if (Notification.permission !== "granted") return;
			try {
				const banner = new Notification(notification.title, {
					body: notification.body,
					silent: notification.silent === true,
					// The page's own icon is the Harness icon in the desktop app, so
					// the banner matches the window it came from.
					icon: "/favicon.svg",
					tag: `dsh-system-notify-${String(notification.id)}`,
				});
				banner.onerror = () => {};
			} catch {
				// A renderer without notification support must not break the loop.
			}
		}

		/** Resolve after `ms`. A pending backoff never delays teardown past its own bound. */
		function sleep(ms) {
			return new Promise((resolve) => {
				setTimeout(resolve, ms);
			});
		}

		/**
		 * Keep exactly one drain in flight and show every batch it returns.
		 *
		 * A failed drain backs off before retrying so a Harness that cannot serve
		 * the route is not hammered.
		 */
		function startDraining() {
			let stopped = false;
			let backoff = RETRY_MIN_MS;
			let lifetime;
			const here = surface();

			const loop = async () => {
				while (!stopped) {
					if (!(await canNotify())) {
						if (stopped) return;
						await sleep(PERMISSION_POLL_MS);
						continue;
					}
					lifetime = new AbortController();
					let batch = [];
					let failed = false;
					try {
						const response = await fetch(`${INBOX_PATH}?surface=${here}`, {
							method: "GET",
							headers: { Accept: "application/json" },
							signal: lifetime.signal,
							cache: "no-store",
						});
						if (response.ok) {
							const payload = await response.json();
							if (Array.isArray(payload?.notifications)) batch = payload.notifications;
							backoff = RETRY_MIN_MS;
						} else {
							failed = true;
						}
					} catch {
						if (stopped) return;
						failed = true;
					}
					if (stopped) return;
					for (const notification of batch) show(notification);
					if (failed) {
						await sleep(backoff);
						backoff = Math.min(backoff * 2, RETRY_MAX_MS);
					}
				}
			};

			void loop();

			return () => {
				stopped = true;
				lifetime?.abort();
			};
		}

		function apply(ctx) {
			ctx.effect(() => startDraining(), "dsh-plugin-system-notify: inbox drain");
		}

		exports.inject = [];
		exports.apply = apply;
		return module.exports;
	},
});
