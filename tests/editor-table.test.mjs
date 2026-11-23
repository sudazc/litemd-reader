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
  assert.deepEqual(table.alignments, ["left", "center", "right"]);
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
  assert.equal(updated.doc.toString(), "| 左 | 右 |\n| --- | --- |\n|  更新\\|说明 续写  | 保留 |\n\n正文");
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

test("leaves code blocks, nested tables, and uneven rows in the source editor", () => {
  const state = editorState([
    "```markdown\n| a | b |\n| --- | --- |\n| c | d |\n```",
    "> | a | b |\n> | --- | --- |\n> | c | d |",
    "| a | b |\n| --- | --- |\n| c |",
  ].join("\n\n"));

  assert.deepEqual(readEditorTables(state), []);
});
