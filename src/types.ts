/**
 * Function used to continue execution to the next middleware.
 *
 * @remarks
 * Calling `next()` more than once within the same middleware layer
 * throws a {@link MultipleNextCallError}.
 *
 * @example
 * ```ts
 * const logger: Middleware = async (ctx, next) => {
 *   console.log("before");
 *   await next();
 *   console.log("after");
 * };
 * ```
 */
export type Next = () => Promise<void>;

/**
 * A middleware function.
 *
 * It receives a context object and a `next` function that advances
 * the execution pipeline. A middleware may run logic before calling
 * `next()`, after it, or both — this is what produces the "onion"
 * execution order when several middlewares are composed together.
 *
 * @typeParam TContext - Shape of the context object passed through
 * the pipeline. Defaults to `unknown` when no specific shape is needed.
 *
 * @example
 * ```ts
 * const auth: Middleware<{ user?: User }> = async (ctx, next) => {
 *   ctx.user = await authenticate(ctx);
 *   await next();
 * };
 * ```
 */
export type Middleware<TContext = unknown> = (
	ctx: TContext,
	next: Next,
) => Promise<void> | void;

/**
 * A middleware enriched with metadata.
 *
 * This is useful for debugging, tracing, logging, and static
 * pipeline introspection (see `explain()` and `traceable()`). Use
 * this instead of a plain function whenever you want the middleware
 * to appear by name in traces, error messages, or pipeline diagrams.
 *
 * @typeParam TContext - Shape of the context object passed through
 * the pipeline.
 *
 * @example
 * ```ts
 * const authLayer: NamedMiddleware<AuthContext> = {
 *   name: "auth",
 *   handler: authMiddleware,
 *   meta: { critical: true },
 * };
 * ```
 */
export interface NamedMiddleware<TContext = unknown> {
	/**
	 * Human-readable middleware name.
	 *
	 * Shown in {@link LayerInfo}, error messages (e.g.
	 * {@link MultipleNextCallError}), trace events, and the output of
	 * `explain()`.
	 */
	name: string;

	/**
	 * Middleware implementation.
	 */
	handler: Middleware<TContext>;

	/**
	 * Optional user-defined metadata.
	 *
	 * Not used internally by `compose()` — free-form data for your own
	 * tooling, e.g. `{ tags: ["cache"], critical: true }`.
	 */
	meta?: Record<string, unknown>;
}

/**
 * A middleware can be either a plain function or a {@link NamedMiddleware}.
 *
 * `compose()`, `explain()`, and `traceable()` all accept mixed arrays
 * of both forms — plain functions are normalized internally via
 * {@link normalize}.
 *
 * @typeParam TContext - Shape of the context object passed through
 * the pipeline.
 */
export type AnyMiddleware<TContext = unknown> =
	| Middleware<TContext>
	| NamedMiddleware<TContext>;

/**
 * Runtime information about a middleware layer.
 *
 * Passed to {@link ComposeOptions.onError} and to trace event
 * listeners so consumers can identify which layer produced an event
 * without holding a reference to the original middleware array.
 */
export interface LayerInfo {
	/**
	 * Zero-based position in the pipeline.
	 */
	index: number;

	/**
	 * Middleware name, as resolved by {@link normalize}.
	 */
	name: string;
}

/**
 * Runtime-agnostic cancellation signal.
 *
 * Compatible with the standard `AbortSignal` — a real `AbortSignal`
 * satisfies this interface as-is — while also allowing custom
 * implementations in environments where `AbortSignal` is unavailable
 * or where you want a lighter-weight object (e.g. a plain
 * `{ aborted: boolean }`).
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * await pipeline(ctx, { signal: controller.signal });
 * ```
 *
 * @example
 * Minimal custom implementation without event support:
 * ```ts
 * const signal: CancellationSignal = { aborted: false };
 * // flip `signal.aborted = true` externally to cancel
 * ```
 */
export interface CancellationSignal {
	/**
	 * Indicates whether execution has been cancelled.
	 *
	 * `compose()` checks this before dispatching each middleware layer;
	 * once `true`, the pipeline rejects with an {@link AbortError}.
	 */
	readonly aborted: boolean;

	/**
	 * Registers a listener for cancellation.
	 *
	 * Optional — implementations that only support polling `aborted`
	 * (rather than push notifications) may omit this.
	 *
	 * @param type - Always `"abort"`.
	 * @param listener - Callback invoked when cancellation occurs.
	 */
	addEventListener?(type: "abort", listener: () => void): void;

	/**
	 * Removes a previously registered cancellation listener.
	 *
	 * @param type - Always `"abort"`.
	 * @param listener - The listener passed to {@link addEventListener}.
	 */
	removeEventListener?(type: "abort", listener: () => void): void;
}

/**
 * Options that control pipeline execution.
 *
 * Passed as the second argument to a pipeline returned by `compose()`.
 */
export interface ComposeOptions {
	/**
	 * Optional cancellation signal.
	 *
	 * If the signal is already aborted (or becomes aborted during
	 * execution), the pipeline will stop with an {@link AbortError}.
	 */
	signal?: CancellationSignal;

	/**
	 * Global error hook invoked before an error is propagated.
	 *
	 * Runs for errors thrown by any layer, whether synchronous or
	 * from a rejected promise. Throwing inside this hook is not
	 * caught — do error reporting here, not error handling.
	 *
	 * @param err - The error thrown by the middleware.
	 * @param layer - Identifies which layer threw.
	 */
	onError?: (err: unknown, layer: LayerInfo) => void;
}

/**
 * Error thrown when pipeline execution is cancelled.
 *
 * Rejected by a composed pipeline when its {@link CancellationSignal}
 * is aborted, either before execution starts or partway through.
 */
export class AbortError extends Error {
	constructor(message = "Pipeline execution aborted") {
		super(message);
		this.name = "AbortError";
	}
}

/**
 * Error thrown when a middleware calls `next()` more than once.
 *
 * Calling `next()` twice in the same layer would otherwise re-enter
 * the downstream pipeline and run it a second time — this error
 * makes that programming mistake fail loudly instead of silently.
 */
export class MultipleNextCallError extends Error {
	/**
	 * @param layerName - Name of the middleware that called `next()`
	 * more than once, used to build the error message.
	 */
	constructor(layerName: string) {
		super(`next() called multiple times in "${layerName}"`);
		this.name = "MultipleNextCallError";
	}
}

/**
 * Converts a mixed collection of middleware into a normalized array
 * of {@link NamedMiddleware}.
 *
 * Plain middleware functions receive an automatic name based on
 * their function name or their position in the pipeline (e.g.
 * `"anonymous_2"` for an unnamed function at index 2). Already-named
 * middlewares pass through unchanged.
 *
 * @typeParam TContext - Shape of the context object passed through
 * the pipeline.
 * @param middlewares - Mixed array of plain functions and/or
 * {@link NamedMiddleware} objects.
 * @returns A new array where every entry is a {@link NamedMiddleware}.
 *
 * @example
 * ```ts
 * normalize([
 *   async (ctx, next) => next(),      // -> { name: "anonymous_0", ... }
 *   { name: "auth", handler: authMw }, // -> passed through unchanged
 * ]);
 * ```
 */
export function normalize<TContext>(
	middlewares: AnyMiddleware<TContext>[],
): NamedMiddleware<TContext>[] {
	return middlewares.map((m, i) =>
		typeof m === "function"
			? {
					name: m.name || `anonymous_${i}`,
					handler: m,
				}
			: m,
	);
}
