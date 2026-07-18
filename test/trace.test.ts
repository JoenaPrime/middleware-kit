import { describe, expect, it } from "vitest";
import { compose } from "../src/compose";
import { explain } from "../src/explain";
import { type TraceEvent, traceable } from "../src/trace";

describe("explain", () => {
	it("describes an empty pipeline", () => {
		const result = explain([]);
		expect(result.size).toBe(0);
		expect(result.layers).toEqual([]);
		expect(result.asText).toBe("");
	});

	it("lists named and anonymous middlewares in order", () => {
		const result = explain([
			{ name: "auth", handler: async () => {} },
			async function cache() {},
			async () => {}, // truly anonymous
		]);

		expect(result.size).toBe(3);
		expect(result.layers[0]).toMatchObject({ index: 0, name: "auth" });
		expect(result.layers[1]).toMatchObject({ index: 1, name: "cache" });
		expect(result.layers[2].name).toMatch(/^anonymous_/);
	});

	it("includes meta in the text output when present", () => {
		const result = explain([
			{ name: "auth", handler: async () => {}, meta: { critical: true } },
		]);

		expect(result.asText).toContain("auth");
		expect(result.asText).toContain("critical");
	});

	it("renders a numbered, human-readable listing", () => {
		const result = explain([
			{ name: "logger", handler: async () => {} },
			{ name: "auth", handler: async () => {} },
		]);

		expect(result.asText).toBe("1. logger\n2. auth");
	});
});

describe("traceable", () => {
	it("emits enter and exit events in onion order", async () => {
		const events: TraceEvent[] = [];

		const middlewares = [
			{
				name: "outer",
				handler: async (_ctx: unknown, next: () => Promise<void>) => next(),
			},
			{ name: "inner", handler: async () => {} },
		];

		const pipeline = compose(
			traceable(middlewares, { onEvent: (e) => events.push(e) }),
		);
		await pipeline({});

		const shape = events.map((e) => `${e.type}:${e.layer.name}`);
		expect(shape).toEqual([
			"enter:outer",
			"enter:inner",
			"exit:inner",
			"exit:outer",
		]);
	});

	it("includes a durationMs on exit events", async () => {
		const events: TraceEvent[] = [];

		const middlewares = [{ name: "work", handler: async () => {} }];
		const pipeline = compose(
			traceable(middlewares, { onEvent: (e) => events.push(e) }),
		);
		await pipeline({});

		const exitEvent = events.find((e) => e.type === "exit");
		expect(exitEvent?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("emits an error event and rethrows when a middleware fails", async () => {
		const events: TraceEvent[] = [];

		const middlewares = [
			{
				name: "failing",
				handler: async () => {
					throw new Error("boom");
				},
			},
		];

		const pipeline = compose(
			traceable(middlewares, { onEvent: (e) => events.push(e) }),
		);

		await expect(pipeline({})).rejects.toThrow("boom");

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		if (!errorEvent) throw new Error("expected an error event to be recorded");
		expect(errorEvent.layer.name).toBe("failing");
		expect((errorEvent.error as Error).message).toBe("boom");
	});

	it("preserves original middleware behavior (functional transparency)", async () => {
		type Ctx = { count: number };
		const middlewares = [
			{
				name: "increment",
				handler: async (ctx: Ctx, next: () => Promise<void>) => {
					ctx.count += 1;
					await next();
				},
			},
		];

		const pipeline = compose<Ctx>(traceable(middlewares));
		const ctx: Ctx = { count: 0 };
		await pipeline(ctx);

		expect(ctx.count).toBe(1);
	});

	it("works with zero-arg onEvent (tracing disabled by default)", async () => {
		const middlewares = [{ name: "noop", handler: async () => {} }];
		const pipeline = compose(traceable(middlewares));
		await expect(pipeline({})).resolves.toBeUndefined();
	});
});
