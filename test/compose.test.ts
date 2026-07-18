import { describe, it, expect, vi } from "vitest";
import { compose } from "../src/compose";
import { AbortError, MultipleNextCallError } from "../src/types";

describe("compose", () => {
	it("runs middlewares in onion order (before/after)", async () => {
		const calls: string[] = [];

		const pipeline = compose([
			async (_ctx, next) => {
				calls.push("before A");
				await next();
				calls.push("after A");
			},
			async (_ctx, next) => {
				calls.push("before B");
				await next();
				calls.push("after B");
			},
		]);

		await pipeline({});

		expect(calls).toEqual(["before A", "before B", "after B", "after A"]);
	});

	it("resolves immediately for an empty pipeline", async () => {
		const pipeline = compose([]);
		await expect(pipeline({})).resolves.toBeUndefined();
	});

	it("resolves when the last middleware does not call next()", async () => {
		const calls: string[] = [];
		const pipeline = compose([
			async (_ctx, next) => {
				calls.push("A");
				await next();
			},
			async () => {
				calls.push("B");
				// no next() call — pipeline should still resolve
			},
		]);

		await pipeline({});
		expect(calls).toEqual(["A", "B"]);
	});

	it("passes context through to every middleware", async () => {
		type Ctx = { count: number };
		const pipeline = compose<Ctx>([
			async (ctx, next) => {
				ctx.count += 1;
				await next();
			},
			async (ctx, next) => {
				ctx.count += 10;
				await next();
			},
		]);

		const ctx: Ctx = { count: 0 };
		await pipeline(ctx);
		expect(ctx.count).toBe(11);
	});

	it("rejects when next() is called more than once", async () => {
		const pipeline = compose([
			async (_ctx, next) => {
				await next();
				await next(); // second call — should reject
			},
			async () => {},
		]);

		await expect(pipeline({})).rejects.toBeInstanceOf(MultipleNextCallError);
	});

	it("propagates asynchronous errors thrown by a middleware", async () => {
		const pipeline = compose([
			async (_ctx, next) => {
				await next();
			},
			async () => {
				throw new Error("boom");
			},
		]);

		await expect(pipeline({})).rejects.toThrow("boom");
	});

	it("propagates synchronous errors thrown by a middleware", async () => {
		const pipeline = compose([
			(_ctx, next) => {
				// synchronous throw, not inside a promise
				throw new Error("sync boom");
			},
		]);

		await expect(pipeline({})).rejects.toThrow("sync boom");
	});

	it("lets outer middlewares catch errors from inner middlewares", async () => {
		const calls: string[] = [];

		const pipeline = compose([
			async (_ctx, next) => {
				try {
					await next();
				} catch (err) {
					calls.push(`caught: ${(err as Error).message}`);
				}
			},
			async () => {
				throw new Error("inner failure");
			},
		]);

		await pipeline({});
		expect(calls).toEqual(["caught: inner failure"]);
	});

	it("calls the onError hook with layer info before rejecting", async () => {
		const onError = vi.fn();

		const pipeline = compose([
			async () => {
				throw new Error("boom");
			},
		]);

		await expect(pipeline({}, { onError })).rejects.toThrow("boom");

		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][1]).toMatchObject({ index: 0 });
	});

	it("rejects with AbortError when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const pipeline = compose([async () => {}]);

		await expect(
			pipeline({}, { signal: controller.signal }),
		).rejects.toBeInstanceOf(AbortError);
	});

	it("rejects with AbortError when aborted mid-pipeline", async () => {
		const controller = new AbortController();

		const pipeline = compose([
			async (_ctx, next) => {
				controller.abort();
				await next();
			},
			async () => {},
		]);

		await expect(
			pipeline({}, { signal: controller.signal }),
		).rejects.toBeInstanceOf(AbortError);
	});

	it("accepts NamedMiddleware objects alongside plain functions", async () => {
		const calls: string[] = [];

		const pipeline = compose([
			{
				name: "auth",
				handler: async (_ctx, next) => {
					calls.push("auth");
					await next();
				},
			},
			async (_ctx, next) => {
				calls.push("anonymous");
				await next();
			},
		]);

		await pipeline({});
		expect(calls).toEqual(["auth", "anonymous"]);
	});
});
