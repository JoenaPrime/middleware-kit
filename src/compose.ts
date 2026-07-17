import {
	AbortError,
	type AnyMiddleware,
	type ComposeOptions,
	MultipleNextCallError,
	type Next,
	normalize,
} from "./types";

/**
 * An executable pipeline produced by {@link compose}.
 *
 * Call it with a context object (and optional {@link ComposeOptions})
 * to run every middleware in onion order.
 *
 * @typeParam TContext - Shape of the context object the pipeline
 * expects.
 */
export type ComposedPipeline<TContext> = (
	ctx: TContext,
	options?: ComposeOptions,
) => Promise<void>;

/**
 * Builds an executable pipeline from an array of middleware.
 *
 * Middlewares run in **onion order**: each one may run code before
 * calling `next()`, after it, or both. Calling `next()` advances to
 * the following middleware; if there is none, the pipeline resolves.
 * Middlewares are normalized once, up front, via `normalize()` — the
 * returned pipeline can be called (and re-called) with different
 * contexts without re-normalizing.
 *
 * @remarks
 * `compose()` intentionally does nothing beyond dispatch: no
 * priorities, retries, or logging. Those are implemented as
 * decorators over the middleware array (see `traceable()` in
 * `trace.ts`) so the core dispatch loop stays small and auditable.
 *
 * Errors — whether thrown synchronously or via a rejected promise —
 * propagate up through every `await next()` an outer middleware used
 * to call the failing one, so a `try/catch` around `next()` behaves
 * exactly like it would in synchronous, nested function calls.
 *
 * @typeParam TContext - Shape of the context object passed through
 * the pipeline.
 * @param middlewares - Mixed array of plain functions and/or
 * `NamedMiddleware` objects, in execution order.
 * @returns A {@link ComposedPipeline} ready to be invoked with a
 * context.
 *
 * @example
 * ```ts
 * const pipeline = compose([
 *   async (ctx, next) => {
 *     console.log("before A");
 *     await next();
 *     console.log("after A");
 *   },
 *   async (ctx, next) => {
 *     console.log("before B");
 *     await next();
 *     console.log("after B");
 *   },
 * ]);
 *
 * await pipeline({});
 * // before A
 * // before B
 * // after B
 * // after A
 * ```
 *
 * @example
 * Catching an inner error from an outer middleware:
 * ```ts
 * compose([
 *   async (ctx, next) => {
 *     try {
 *       await next();
 *     } catch (err) {
 *       console.error("caught:", err);
 *     }
 *   },
 *   async () => {
 *     throw new Error("inner failure");
 *   },
 * ]);
 * ```
 *
 * @example
 * Cancelling a pipeline mid-flight:
 * ```ts
 * const controller = new AbortController();
 * const pipeline = compose([longRunningMiddleware]);
 *
 * await pipeline(ctx, { signal: controller.signal });
 * // rejects with AbortError if controller.abort() is called
 * // before or during execution
 * ```
 */
export function compose<TContext = unknown>(
	middlewares: AnyMiddleware<TContext>[],
): ComposedPipeline<TContext> {
	const layers = normalize(middlewares);

	return (ctx: TContext, options: ComposeOptions = {}): Promise<void> => {
		// Tracks the highest layer index dispatched so far, so a
		// middleware calling next() twice is caught rather than
		// silently re-running the downstream pipeline.
		let index = -1;

		/**
		 * Runs the middleware at index `i`, then recurses into `i + 1`
		 * when (and if) that middleware calls `next()`.
		 *
		 * Declared as `async` so that both synchronous throws and
		 * rejected promises from `layer.handler` are uniformly turned
		 * into a rejected promise — no manual `try/catch` +
		 * `Promise.resolve().catch()` juggling required.
		 */
		const dispatch = async (i: number): Promise<void> => {
			if (options.signal?.aborted) {
				throw new AbortError();
			}

			if (i <= index) {
				const prevName = layers[i - 1]?.name ?? "middleware";
				throw new MultipleNextCallError(prevName);
			}

			index = i;

			const layer = layers[i];
			if (!layer) {
				return;
			}

			const next: Next = () => dispatch(i + 1);

			try {
				await layer.handler(ctx, next);
			} catch (err) {
				options.onError?.(err, {
					index: i,
					name: layer.name,
				});
				throw err;
			}
		};

		return dispatch(0);
	};
}
