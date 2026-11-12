import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheImageLoader } from "../src/lib/image-loader.ts";

test("repeated images share one read, but new renders reload", async () => {
  let calls = 0;
  const load = async () => String(++calls);
  const cached = cacheImageLoader(load);
  assert.deepEqual(await Promise.all([cached("a"), cached("a"), cached("b")]), ["1", "1", "2"]);
  assert.equal(await cacheImageLoader(load)("a"), "3");
});

test("failed reads are shared and can be retried in a later render", async () => {
  let calls = 0;
  const load = async () => { calls++; throw new Error("missing"); };
  const cached = cacheImageLoader(load);
  const results = await Promise.allSettled([cached("a"), cached("a")]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(calls, 1);
  await assert.rejects(cacheImageLoader(load)("a"), /missing/);
  assert.equal(calls, 2);
});
