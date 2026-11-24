import { isolateHistory } from "@codemirror/commands";
import { StateField, type EditorState, type Line, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import DOMPurify from "dompurify";
import type { Token } from "markdown-it";
import { createMarkdownParser } from "./markdown-parser.js";

type TableCell = {
  from: number;
  to: number;
  text: string;
  inputText: string;
  prefix: string;
  suffix: string;
};

type EditorTable = {
  from: number;
  to: number;
  source: string;
  rows: TableCell[][];
  html: string;
};

const parser = createMarkdownParser();
const maxPreviewCells = 2500;
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index].content);

function readCellInputText(source: string, children: Token[]) {
  if (!source.includes("<")) return source;

  // 表格解析会移除竖线前的转义斜杠，将换行标签的位置映射回原文
  const pipeEscapes = [...source.matchAll(/\\(?=\|)/g)].map((match) => match.index);
  let offset = 0;
  let previous = 0;
  let input = "";
  for (const token of children) {
    const tag = token.meta?.lineBreakTag as { from: number; to: number } | undefined;
    if (!tag) continue;
    while (offset < pipeEscapes.length && pipeEscapes[offset] - offset < tag.from) offset += 1;
    input += source.slice(previous, tag.from + offset) + "\n";
    previous = tag.to + offset;
  }
  return input + source.slice(previous);
}

function readRow(line: Line, cellTokens: Token[]): TableCell[] {
  const columnCount = cellTokens.length;
  const text = line.text.trim();
  const start = line.from + line.length - line.text.trimStart().length;
  const separators = [...text.matchAll(/(?<!\\)\|/g)].map((match) => match.index);
  const openingPipe = separators[0] === 0;
  const closingPipe = separators.at(-1) === text.length - 1;
  const rowEnd = start + text.length - (closingPipe ? 1 : 0);
  const ends = separators.slice(openingPipe ? 1 : 0, closingPipe ? -1 : undefined);
  if (!openingPipe || !closingPipe || separators.length > 1) ends.push(rowEnd - start);
  let from = openingPipe ? 1 : 0;

  const cells = ends.slice(0, columnCount).map((end, index) => {
    const raw = text.slice(from, end);
    const value = raw.trim();
    const position = start + from + (value ? raw.length - raw.trimStart().length : Math.floor(raw.length / 2));
    from = end + 1;
    return {
      from: position,
      to: position + value.length,
      text: value,
      inputText: readCellInputText(value, cellTokens[index].children ?? []),
      prefix: index === 0 && !openingPipe ? "| " : "",
      suffix: index === ends.length - 1 && !closingPipe ? " |" : "",
    };
  });

  // Markdown 表格用空格子补齐缺列，只有实际输入时才在原文中加入分隔符
  const existingCells = cells.length;
  for (let index = existingCells; index < columnCount; index += 1) {
    cells.push({
      from: rowEnd,
      to: rowEnd,
      text: "",
      inputText: "",
      prefix: (closingPipe ? "| " : " | ").repeat(index - existingCells + 1),
      suffix: closingPipe ? " " : " |",
    });
  }
  return cells;
}

/** 根据阅读器识别的表格定位单元格源码 */
export function readEditorTables(state: EditorState): EditorTable[] {
  const source = state.doc.toString();
  if (!source.includes("|")) return [];
  const env = {};
  const tokens = parser.parse(source, env);
  const tables: EditorTable[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const opening = tokens[index];
    if (opening.type !== "table_open" || opening.level !== 0 || !opening.map) continue;
    const start = index;
    while (index + 1 < tokens.length && tokens[index].type !== "table_close") index += 1;
    const tableTokens = tokens.slice(start, index + 1);
    const columns = tableTokens.filter((token) => token.type === "th_open").length;
    const rowTokens = tableTokens.filter((token) => token.type === "tr_open");
    if (columns === 0 || rowTokens.some((token) => !token.map) || columns * rowTokens.length > maxPreviewCells) continue;

    const cellTokens = tableTokens.filter((token) => token.type === "inline");
    const from = state.doc.line(opening.map[0] + 1).from;
    const to = state.doc.line(opening.map[1]).to;
    const rows = rowTokens.map((row, rowIndex) => {
      const line = state.doc.line(row.map![0] + 1);
      const firstCell = rowIndex * columns;
      return readRow(line, cellTokens.slice(firstCell, firstCell + columns));
    });
    tables.push({
      from,
      to,
      source: state.doc.sliceString(from, to),
      rows,
      html: parser.renderer.render(tableTokens, parser.options, env),
    });
  }
  return tables;
}

/** 写回一个格子的源文并保护 Markdown 行列分隔符 */
export function editTableCell(state: EditorState, cell: TableCell, value: string) {
  if (value === cell.inputText) return null;
  const content = value.replace(/\r\n?|\n/g, "<br>").trim().replace(/(?<!\\)\|/g, "\\|");
  if (content === cell.text) return null;
  let insert = cell.prefix + content + cell.suffix;
  if (insert.endsWith("\\") && state.doc.sliceString(cell.to, cell.to + 1) === "|") insert += " ";
  return { from: cell.from, to: cell.to, insert };
}

function findTable(view: EditorView, from: number) {
  return view.contentDOM.querySelector<HTMLElement>(`[data-table-start="${from}"]`);
}

function focusCell(view: EditorView, from: number, index: number) {
  const target = findTable(view, from)?.querySelector<HTMLElement>(`[data-editable-cell="${index}"]`);
  if (target) target.focus();
  else view.focus();
}

function appendRow(view: EditorView, from: number) {
  const table = view.state.field(editorTables).tables.find((candidate) => candidate.from === from);
  if (!table) return;
  const columns = table.rows[0].length;
  view.dispatch({
    changes: { from: table.to, insert: `${view.state.lineBreak}|${"   |".repeat(columns)}` },
    userEvent: "input.table",
    annotations: isolateHistory.of("full"),
  });
}

function beginCellEdit(view: EditorView, table: EditorTable, field: HTMLElement, index: number) {
  if (field.querySelector("textarea")) return;
  const columns = table.rows[0].length;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const cell = table.rows[row][column];
  const preview = [...field.childNodes];
  const initialDoc = view.state.doc;
  const input = field.ownerDocument.createElement("textarea");
  input.className = "ml-table-cell-input";
  input.setAttribute("aria-label", `表格第 ${row + 1} 行第 ${column + 1} 列`);
  input.rows = 1;
  input.spellcheck = false;
  input.value = cell.inputText;
  let finished = false;

  function finish(save: boolean) {
    if (finished) return;
    finished = true;
    const scrollLeft = field.closest(".reader-table-wrap")?.scrollLeft ?? 0;
    field.replaceChildren(...preview);
    const change = save && view.state.doc === initialDoc ? editTableCell(view.state, cell, input.value) : null;
    if (change) {
      view.dispatch({ changes: change, userEvent: "input.table", annotations: isolateHistory.of("full") });
      findTable(view, table.from)?.querySelector(".reader-table-wrap")?.scrollTo({ left: scrollLeft });
    }
    view.requestMeasure();
  }

  input.addEventListener("input", () => view.requestMeasure());
  input.addEventListener("blur", () => finish(true), { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.ctrlKey || event.metaKey) {
      if (["s", "w", "tab", "f", "p", "o", "n"].includes(event.key.toLowerCase())) input.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      view.focus();
    } else if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      const target = index + (event.key === "Tab" ? (event.shiftKey ? -1 : 1) : columns);
      finish(true);
      if (event.key === "Tab" && target === columns * table.rows.length) appendRow(view, table.from);
      focusCell(view, table.from, target);
    }
  });

  field.replaceChildren(input);
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  view.requestMeasure();
}

class TableWidget extends WidgetType {
  readonly table: EditorTable;
  readonly sourceVisible: boolean;

  constructor(table: EditorTable, sourceVisible: boolean) {
    super();
    this.table = table;
    this.sourceVisible = sourceVisible;
  }

  eq(other: TableWidget) {
    return this.sourceVisible === other.sourceVisible && this.table.from === other.table.from &&
      this.table.source === other.table.source && this.table.html === other.table.html;
  }

  toDOM(view: EditorView) {
    const { table, sourceVisible } = this;
    const document = view.dom.ownerDocument;
    const root = document.createElement("div");
    root.className = "ml-editor-table";
    root.dataset.tableStart = String(table.from);
    const toolbar = document.createElement("div");
    toolbar.className = "ml-table-toolbar";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ml-table-action";
    toggle.textContent = sourceVisible ? "表格视图" : "编辑源码";
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      root.querySelector("textarea")?.blur();
      view.dispatch({ selection: { anchor: table.from + (sourceVisible ? 0 : 1) }, scrollIntoView: true });
      view.focus();
    });
    toolbar.append(toggle);
    root.append(toolbar);
    if (sourceVisible) return root;

    const preview = DOMPurify.sanitize(table.html, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true } });
    root.append(preview);
    for (const link of root.querySelectorAll("table a")) link.removeAttribute("href");
    for (const [index, cell] of [...root.querySelectorAll<HTMLElement>("th, td")].entries()) {
      cell.dataset.editableCell = String(index);
      cell.tabIndex = 0;
      cell.addEventListener("focus", () => beginCellEdit(view, table, cell, index));
    }
    root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("textarea")) return;
      const cell = event.target.closest<HTMLElement>("[data-editable-cell]");
      if (!cell) return;
      event.preventDefault();
      root.querySelector("textarea")?.blur();
      focusCell(view, table.from, Number(cell.dataset.editableCell));
    });
    root.addEventListener("contextmenu", (event) => event.stopPropagation());
    return root;
  }
}

function tableDecorations(state: EditorState, tables: EditorTable[]) {
  const ranges: Range<Decoration>[] = [];
  for (const table of tables) {
    const sourceVisible = state.selection.ranges.some((range) => range.to > table.from && range.from < table.to);
    const widget = new TableWidget(table, sourceVisible);
    ranges.push(sourceVisible
      ? Decoration.widget({ widget, block: true, side: -1 }).range(table.from)
      : Decoration.replace({ widget, block: true, inclusive: false }).range(table.from, table.to));
  }
  return Decoration.set(ranges);
}

export const editorTables = StateField.define<{ tables: EditorTable[]; decorations: DecorationSet }>({
  create(state) {
    const tables = readEditorTables(state);
    return { tables, decorations: tableDecorations(state, tables) };
  },
  update(previous, transaction) {
    if (!transaction.docChanged && !transaction.selection) return previous;
    const tables = transaction.docChanged ? readEditorTables(transaction.state) : previous.tables;
    return { tables, decorations: tableDecorations(transaction.state, tables) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
