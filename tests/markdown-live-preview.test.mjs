import assert from "node:assert/strict";
import test from "node:test";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownPreviewDecorations } from "../src/lib/markdown-live-preview.ts";

function preview(doc, positions) {
  const initialState = EditorState.create({
    doc,
    selection: EditorSelection.create(positions.map((position) => EditorSelection.cursor(position))),
    extensions: [markdownLanguage, EditorState.allowMultipleSelections.of(true)],
  });
  const parsed = ensureSyntaxTree(initialState, doc.length, 1000);
  assert.ok(parsed, "the fixture has a complete Markdown syntax tree");
  const state = initialState.update({}).state;
  assert.equal(syntaxTree(state), parsed, "the editor state exposes the completed parse");
  const spans = [];
  markdownPreviewDecorations(state, 0, doc.length).between(0, doc.length, (from, to, decoration) => {
    spans.push({ from, to, text: doc.slice(from, to), style: decoration.spec.class ?? decoration.spec.attributes?.class });
  });
  return spans;
}

test("formats inactive headings, emphasis, inline code, links, lists and quotes", () => {
  const doc = [
    "# Heading #", "", "**bold** and _italic_ plus `code`. [Example](https://example.com)",
    "", "- Bullet", "", "3. Numbered", "", "> Quote", "", "Active paragraph",
  ].join("\n");
  const spans = preview(doc, [doc.length]);
  for (const [style, text] of [
    ["ml-preview-heading-1", ""], ["ml-preview-bold", "bold"], ["ml-preview-italic", "italic"],
    ["ml-preview-code", "code"], ["ml-preview-link", "Example"], ["ml-preview-bullet", "-"],
    ["ml-preview-number", "3."], ["ml-preview-quote", ">"],
  ]) {
    assert.ok(spans.some((span) => span.style === style && span.text === text), style);
  }
  assert.deepEqual(spans.filter((span) => !span.style).map((span) => span.text).sort(),
    ["# ", " #", "**", "**", "_", "_", "`", "`", "[", "](https://example.com)"].sort());
});

test("keeps the source visible across active paragraphs, multiple cursors, and table cells", () => {
  const doc = [
    "A **first line**", "_continuation_", "", "Second **paragraph**", "", "Third **paragraph**", "",
    "| Name | Value |", "| --- | --- |", "| **table content** | `code` |", "", "[unresolved]",
  ].join("\n");
  const spans = preview(doc, [doc.indexOf("continuation"), doc.indexOf("Second")]);
  assert.deepEqual(spans.filter((span) => span.style === "ml-preview-bold").map((span) => span.from),
    [doc.indexOf("paragraph", doc.indexOf("Third"))]);
  assert.deepEqual(spans.filter((span) => !span.style).map((span) => span.text), ["**", "**"]);
});
