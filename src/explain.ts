import { type AnyMiddleware, normalize } from "./types";

/**
 * Static description of a single middleware layer.
 *
 * Distinct from {@link LayerInfo} (in `types.ts`): that one is
 * emitted at runtime for a layer that actually executed, while this
 * one describes a layer's position in the pipeline before anything
 * has run.
 */
export interface ExplainedLayer {
	/**
	 * Zero-based position in the pipeline.
	 */
	index: number;

	/**
	 * Middleware name, as resolved by `normalize()`.
	 */
	name: string;

	/**
	 * User-defined metadata, if the middleware provided any.
	 */
	meta?: Record<string, unknown>;
}

/**
 * Result of calling {@link explain}: a full static description of a
 * composed pipeline's shape.
 *
 * @example
 * ```ts
 * const result = explain(middlewares);
 * result.size;       // 3
 * result.layers[0];   // { index: 0, name: "auth", meta: undefined }
 * result.asText;      // "1. auth\n2. cache\n3. controller"
 * ```
 */
export interface PipelineExplanation {
	/**
	 * Total number of layers in the pipeline.
	 */
	size: number;

	/**
	 * Ordered description of every layer, matching execution order.
	 */
	layers: ExplainedLayer[];

	/** Human-readable, numbered listing of the pipeline. */
	asText: string;
}

/**
 * Describes a pipeline's shape without executing it.
 *
 * Unlike {@link traceable}, `explain()` never calls any middleware —
 * it only inspects names, order, and metadata. Use it to print or
 * log a pipeline's composition, validate its shape in a test or CI
 * step (e.g. "auth must run before cache"), or feed a diagram
 * generator.
 *
 * @typeParam TContext - Shape of the context object the pipeline
 * would receive. Unused by `explain()` itself, but kept so the same
 * middleware array can be passed to `explain()` and `compose()`
 * without a type mismatch.
 * @param middlewares - Mixed array of plain functions and/or
 * `NamedMiddleware` objects, in the order they would be composed.
 * @returns A {@link PipelineExplanation} describing the pipeline.
 *
 * @example
 * ```ts
 * const middlewares = [
 *   { name: "logger", handler: loggerMw },
 *   { name: "auth", handler: authMw },
 *   { name: "controller", handler: controllerMw },
 * ];
 *
 * console.log(explain(middlewares).asText);
 * // 1. logger
 * // 2. auth
 * // 3. controller
 * ```
 */
export function explain<TContext = unknown>(
	middlewares: AnyMiddleware<TContext>[],
): PipelineExplanation {
	const layers: ExplainedLayer[] = normalize(middlewares).map((l, i) => ({
		index: i,
		name: l.name,
		meta: l.meta,
	}));

	const asText = layers
		.map((l) => {
			const metaStr = l.meta ? ` (${JSON.stringify(l.meta)})` : "";
			return `${l.index + 1}. ${l.name}${metaStr}`;
		})
		.join("\n");

	return { size: layers.length, layers, asText };
}
