import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmDocumentReload } from "../src/lib/reload-confirmation.ts";

test("editing while confirmation is pending cancels reload", async () => {
  let source = "original";
  let respond;
  const result = confirmDocumentReload(() => source, () => new Promise(resolve => { respond = resolve; }));
  source = "new unsaved edit";
  respond(true);
  assert.equal(await result, "changed");
});

test("unchanged confirmed content can reload", async () => {
  assert.equal(await confirmDocumentReload(() => "content", async () => true), "confirmed");
});

test("declining confirmation cancels reload", async () => {
  assert.equal(await confirmDocumentReload(() => "content", async () => false), "cancelled");
});
