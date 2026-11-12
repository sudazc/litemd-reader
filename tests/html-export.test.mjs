import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStaticHtml } from "../src/lib/html-export.ts";

test("HTML export preserves every supported reader font size", () => {
  for (let fontSize = 15; fontSize <= 25; fontSize++) {
    const html = buildStaticHtml({ title: "<notes>", bodyHtml: "<p>test</p>", darkMode: false, fontSize, katexCss: "" });
    assert.ok(html.includes(`font-size: ${fontSize}px;`));
    assert.ok(html.includes("<title>&lt;notes&gt;</title>"));
  }
});

test("invalid font preferences never produce invalid export CSS", () => {
  for (const fontSize of [NaN, Infinity]) {
    const html = buildStaticHtml({ title: "notes", bodyHtml: "", darkMode: true, fontSize, katexCss: "" });
    assert.ok(html.includes("font-size: 20px;"));
    assert.ok(!html.includes("NaNpx"));
  }
});
