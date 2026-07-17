import {
	normalize,
	type AnyMiddleware,
	type LayerInfo,
	type NamedMiddleware,
	type Next,
} from "./types";

/**
 * Types of tracing events emitted during pipeline execution.
 *
 * - `"enter"` — a middleware is about to run.
 * - `"exit"` — a middleware (and everything it awaited via `next()`)
 *   completed successfully.
 * - `"error"` — a middleware threw, either synchronously or by
 *   rejecting.
 */
export type TraceEventType = "enter" | "exit" | "error";

/**
 * Information emitted for each tracing event.
 *
 * @example
 * ```ts
 * const onEvent = (event: TraceEvent) => {
 *   if (event.type === "exit") {
 *     console.log(`${event.layer.name} took ${event.durationMs}ms`);
 *   }
 * };
 * ```
 */
export interface TraceEvent {
	/**
	 * Kind of event.
	 */
	type: TraceEventType;

	/**
	 * Middleware layer associated with the event.
	 */
	layer: LayerInfo;

	/**
	 * Execution time in milliseconds.
	 *
	 * Present for `exit` and `error` events. Absent for `enter`, since
	 * timing only makes sense once the layer has finished (or failed).
	 */
	durationMs?: number;

	/**
	 * Error thrown by the middleware, when applicable.
	 *
	 * Only present on `error` events. Untyped (`unknown`) because a
	 * middleware may throw anything, not just `Error` instances.
	 */
	error?: unknown;
}

/**
 * Configuration options for tracing.
 */
export interface TraceOptions {
	/**
	 * Callback invoked whenever a trace event occurs.
	 *
	 * Called synchronously, once per event, in the order the events
	 * occur during execution (see {@link traceable} for the exact
	 * enter/exit/error sequence). Throwing inside this callback is not
	 * caught by the pipeline.
	 */
	onEvent?: (event: TraceEvent) => void;
}

/**
 * Wraps a middleware collection with tracing instrumentation.
 *
 * The returned middleware array can be passed directly to `compose()`.
 * Each wrapped middleware emits, in order:
 *
 * - `"enter"` before execution.
 * - `"exit"` after successful completion (including any awaited
 *   downstream middleware reached via `next()`).
 * - `"error"` if execution throws, instead of `"exit"`.
 *
 * Because each layer is wrapped individually, events nest in onion
 * order: outer middlewares emit `"enter"` before inner ones, and
 * `"exit"` after them — mirroring the before/after execution order
 * of `compose()` itself.
 *
 * @remarks
 * The original middleware array and its handlers are never modified —
 * `traceable()` returns a new array of wrapper middlewares that call
 * through to the originals. This means it can be combined with other
 * middleware-array decorators (e.g. a future `withRetry()`) by simply
 * composing the wrapping calls.
 *
 * @typeParam TContext - Shape of the context object passed through
 * the pipeline.
 * @param middlewares - Mixed array of plain functions and/or
 * {@link NamedMiddleware} objects to instrument.
 * @param traceOpts - Tracing configuration, including the event
 * listener.
 * @returns A new {@link NamedMiddleware} array, ready to pass to
 * `compose()`, that emits trace events around each original
 * middleware's execution.
 *
 * @example
 * ```ts
 * const events: TraceEvent[] = [];
 *
 * const pipeline = compose(
 *   traceable(middlewares, { onEvent: (e) => events.push(e) })
 * );
 *
 * await pipeline(ctx);
 * console.table(events);
 * ```
 */
export function traceable<TContext = unknown>(
	middlewares: AnyMiddleware<TContext>[],
	traceOpts: TraceOptions = {},
): NamedMiddleware<TContext>[] {
	return normalize(middlewares).map((layer, index) => ({
		name: layer.name,
		meta: layer.meta,
		handler: async (ctx: TContext, next: Next) => {
			const info: LayerInfo = { index, name: layer.name };
			const start = now();

			traceOpts.onEvent?.({
				type: "enter",
				layer: info,
			});

			try {
				await layer.handler(ctx, next);

				traceOpts.onEvent?.({
					type: "exit",
					layer: info,
					durationMs: now() - start,
				});
			} catch (err) {
				traceOpts.onEvent?.({
					type: "error",
					layer: info,
					durationMs: now() - start,
					error: err,
				});

				throw err;
			}
		},
	}));
}

/**
 * Returns a high-resolution timestamp when available.
 *
 * This helper intentionally avoids depending on a specific runtime API.
 *
 * - Uses `performance.now()` when available, providing a monotonic,
 *   high-resolution clock.
 * - Falls back to `Date.now()` in environments where the Performance API
 *   is unavailable.
 *
 * This makes the library portable across browsers, Node.js, Bun, Deno,
 * workers, and custom JavaScript runtimes.
 *
 * @returns A timestamp in milliseconds, suitable only for measuring
 * elapsed time between two calls — not for wall-clock/calendar use.
 */
function now(): number {
	if (
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
	) {
		return performance.now();
	}

	return Date.now();
}
