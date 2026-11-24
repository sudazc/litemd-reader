import assert from "node:assert/strict";
import test from "node:test";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { editTableCell, editorTables, readEditorTables } from "../src/lib/editor-table.ts";

const editorState = (doc) => EditorState.create({ doc, extensions: [markdownLanguage, editorTables] });

test("reads column alignment, empty cells, and escaped pipes without including surrounding Markdown", () => {
  const source = "| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n|   | A\\|B | C |";
  const state = editorState(`# 标题\n\n${source}\n\n正文`);
  const [table] = readEditorTables(state);

  assert.equal(table.source, source);
  assert.deepEqual([...table.html.matchAll(/<th[^>]+style="text-align:(\w+)"/g)].map((match) => match[1]),
    ["left", "center", "right"]);
  assert.deepEqual(table.rows.map((row) => row.map((cell) => cell.text)), [
    ["左", "中", "右"],
    ["", "A\\|B", "C"],
  ]);
});

test("replaces only the selected cell and keeps pasted pipes and line breaks inside it", () => {
  const state = editorState("| 左 | 右 |\n| --- | --- |\n|  原值  | 保留 |\n\n正文");
  const [table] = readEditorTables(state);
  const cell = table.rows[1][0];
  const change = editTableCell(state, cell, "更新|说明\r\n续写");
  assert.ok(change);

  const updated = state.update({ changes: change }).state;
  assert.equal(updated.doc.toString(), "| 左 | 右 |\n| --- | --- |\n|  更新\\|说明<br>续写  | 保留 |\n\n正文");
  assert.equal(readEditorTables(updated)[0].rows[1].length, 2);
  assert.equal(editTableCell(state, cell, "原值"), null);
});

test("clearing a cell at the edge of a row keeps the table columns intact", () => {
  const state = editorState("左 | 右\n--- | ---\n甲 | 乙");
  const [table] = readEditorTables(state);
  const first = editTableCell(state, table.rows[1][0], "");
  assert.ok(first);
  const updated = state.update({ changes: first }).state;
  const last = editTableCell(updated, readEditorTables(updated)[0].rows[1][1], "");
  assert.ok(last);

  const final = updated.update({ changes: last }).state;
  assert.deepEqual(readEditorTables(final)[0].rows[1].map((cell) => cell.text), ["", ""]);
});

test("leaves code blocks and nested tables in the source editor", () => {
  const state = editorState([
    "```markdown\n| a | b |\n| --- | --- |\n| c | d |\n```",
    "> | a | b |\n> | --- | --- |\n> | c | d |",
  ].join("\n\n"));

  assert.deepEqual(readEditorTables(state), []);
});

test("previews formatted cells, explicit line breaks, and links defined elsewhere in the document", () => {
  const state = editorState("| 左 | 右 |\n| --- | --- |\n| **粗体**<br>下一行 | [链接][ref] `A\\|B` |\n\n[ref]: https://example.com");
  const [table] = readEditorTables(state);

  assert.match(table.html, /<strong>粗体<\/strong><br[^>]*>\s*下一行/);
  assert.match(table.html, /<a href="https:\/\/example.com">链接<\/a> <code>A\|B<\/code>/);
});

test("keeps line break tags literal when they are escaped or inside inline code", () => {
  const state = editorState("| 名称 | 内容 |\n| --- | --- |\n| `x<br>y` | \\<br> 和 <span>文本</span> |");
  const [table] = readEditorTables(state);

  assert.match(table.html, /<code>x&lt;br&gt;y<\/code>/);
  assert.ok(table.html.includes("&lt;br&gt; 和 &lt;span&gt;文本&lt;/span&gt;"));
  assert.doesNotMatch(table.html, /<br\b/);
});

test("edits rendered cell breaks as newlines and preserves literal tags", () => {
  const raw = "甲\\|乙<BR />下一行\\<br>、`<br>`、[链<br/>接](https://example.com)";
  const state = editorState(`| 名称 | 内容 |\n| --- | --- |\n| ${raw} | 保留 |`);
  const [table] = readEditorTables(state);
  const cell = table.rows[1][0];
  assert.equal(cell.inputText, "甲\\|乙\n下一行\\<br>、`<br>`、[链\n接](https://example.com)");
  assert.equal(editTableCell(state, cell, cell.inputText), null);

  const change = editTableCell(state, cell, cell.inputText.replace("下一行", "修改"));
  assert.ok(change);
  const updated = state.update({ changes: change }).state;
  assert.equal(updated.doc.line(3).text, "| 甲\\|乙<br>修改\\<br>、`<br>`、[链<br>接](https://example.com) | 保留 |");
  assert.equal(readEditorTables(updated)[0].rows[1][0].inputText, cell.inputText.replace("下一行", "修改"));
});

test("fills a missing cell without touching extra columns or unrelated Markdown", () => {
  const state = editorState("| 左 | 右 |\n| --- | --- |\n| 甲 |\n| 乙 | 丙 | 原文保留 |\n\n正文");
  const [table] = readEditorTables(state);
  assert.deepEqual(table.rows.map((row) => row.map((cell) => cell.text)), [["左", "右"], ["甲", ""], ["乙", "丙"]]);
  const change = editTableCell(state, table.rows[1][1], "填入");
  assert.ok(change);
  assert.equal(state.update({ changes: change }).newDoc.toString(),
    "| 左 | 右 |\n| --- | --- |\n| 甲 | 填入 |\n| 乙 | 丙 | 原文保留 |\n\n正文");
});
