import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

type TableCell = {
  from: number;
  to: number;
  text: string;
  addOpeningPipe: boolean;
  addClosingPipe: boolean;
};

type EditorTable = {
  from: number;
  to: number;
  source: string;
  alignments: Array<"left" | "center" | "right">;
  rows: TableCell[][];
};

const maxPreviewCells = 2500;

function readRow(state: EditorState, node: SyntaxNode): TableCell[] | null {
  const rowSource = state.doc.sliceString(node.from, node.to);
  const separators = node.getChildren("TableDelimiter").map((separator) => separator.from);
  // 阅读器将紧接反斜杠的竖线视为转义，遇到两种解析结果可能不同的行时保留源码
  if (separators.some((position) => position > node.from && rowSource[position - node.from - 1] === "\\")) {
    return null;
  }
  const openingPipe = separators[0] === node.from + rowSource.length - rowSource.trimStart().length;
  const lastSeparator = separators.at(-1);
  const closingPipe = lastSeparator !== undefined && lastSeparator === node.from + rowSource.trimEnd().length - 1;
  if (openingPipe && closingPipe && separators.length === 1) return null;

  const ends = separators.slice(openingPipe ? 1 : 0, closingPipe ? -1 : undefined);
  ends.push(closingPipe ? lastSeparator : node.to);
  let from = openingPipe ? separators[0] + 1 : node.from;

  return ends.map((end, index) => {
    const raw = state.doc.sliceString(from, end);
    const text = raw.trim();
    // 空格占位的单元格从中间插入，保留两侧原有空白
    const start = from + (text ? raw.length - raw.trimStart().length : Math.floor(raw.length / 2));
    from = end + 1;
    return {
      from: start,
      to: start + text.length,
      text,
      addOpeningPipe: index === 0 && !openingPipe,
      addClosingPipe: index === ends.length - 1 && !closingPipe,
    };
  });
}

/** 读取可编辑的顶层表格，并保留单元格在原文中的位置 */
export function readEditorTables(state: EditorState): EditorTable[] {
  const tables: EditorTable[] = [];
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Table") continue;
    const header = node.getChild("TableHeader");
    const separator = node.getChild("TableDelimiter");
    if (!header || !separator) continue;
    const rowNodes = [header, ...node.getChildren("TableRow")];
    const columnRules = state.doc.sliceString(separator.from, separator.to)
      .trim().replace(/^\||\|$/g, "").split("|").map((column) => column.trim());
    if (columnRules.some((column) => !/^:?-+:?$/.test(column))) continue;
    if (columnRules.length * rowNodes.length > maxPreviewCells) continue;
    const rows = rowNodes.map((row) => readRow(state, row));
    if (!rows.every((row): row is TableCell[] => row?.length === columnRules.length)) continue;

    const from = state.doc.lineAt(node.from).from;
    const to = state.doc.lineAt(node.to).to;
    tables.push({
      from,
      to,
      source: state.doc.sliceString(from, to),
      rows,
      alignments: columnRules.map((column) =>
        column.endsWith(":") ? (column.startsWith(":") ? "center" : "right") : "left",
      ),
    });
  }
  return tables;
}

/** 只替换目标单元格，必要时补齐边缘分隔符 */
export function editTableCell(state: EditorState, cell: TableCell, value: string) {
  if (value === cell.text) return null;
  let insert = value.replace(/\r\n?|\n/g, " ").trim().replace(/(\\*)\|/g, (_, slashes: string) =>
    slashes.length % 2 === 0 ? `${slashes}\\|` : `${slashes}|`,
  );
  if (insert === cell.text) return null;
  if (cell.addOpeningPipe) insert = `| ${insert}`;
  if (cell.addClosingPipe) insert += " |";
  else if (insert.endsWith("\\") && state.doc.sliceString(cell.to, cell.to + 1) === "|") insert += " ";
  return { from: cell.from, to: cell.to, insert };
}

function createButton(document: Document, text: string, className: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function showCellEditor(view: EditorView, table: EditorTable, cell: TableCell, trigger: HTMLButtonElement) {
  const document = trigger.ownerDocument;
  const initialDoc = view.state.doc;
  const dialog = document.createElement("dialog");
  dialog.className = "ml-table-cell-dialog";
  dialog.setAttribute("aria-label", "编辑单元格");

  const title = document.createElement("h2");
  title.textContent = "编辑单元格";
  const form = document.createElement("form");
  const input = document.createElement("textarea");
  input.value = cell.text;
  input.rows = 5;
  input.spellcheck = false;
  input.setAttribute("aria-label", "单元格内容");
  const hint = document.createElement("p");
  hint.textContent = "支持 Markdown，换行会合并为空格";
  const actions = document.createElement("div");
  actions.className = "ml-table-cell-actions";
  const cancel = createButton(document, "取消", "ml-table-action");
  cancel.addEventListener("click", () => dialog.close());
  const confirm = createButton(document, "应用", "ml-table-action ml-table-apply");
  confirm.type = "submit";
  actions.append(cancel, confirm);
  form.append(input, hint, actions);
  dialog.append(title, form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("contextmenu", (event) => event.stopPropagation());
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing || !(event.ctrlKey || event.metaKey)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (initialDoc !== view.state.doc) {
      input.setCustomValidity("表格已更新，请取消后重新打开单元格");
      input.reportValidity();
      return;
    }
    const change = editTableCell(view.state, cell, input.value);
    const scroll = trigger.closest(".ml-table-scroll");
    const scrollLeft = scroll?.scrollLeft ?? 0;
    const scrollTop = scroll?.scrollTop ?? 0;
    dialog.close();
    if (!change) return;

    view.dispatch({ changes: change, userEvent: "input.table", annotations: isolateHistory.of("full") });
    const updated = view.dom.querySelector<HTMLElement>(`[data-table-start="${table.from}"] .ml-table-scroll`);
    updated?.scrollTo({ left: scrollLeft, top: scrollTop });
    view.focus();
  });

  trigger.closest(".ml-editor-table")?.append(dialog);
  dialog.showModal();
  input.focus();
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
    return this.sourceVisible === other.sourceVisible &&
      this.table.from === other.table.from && this.table.source === other.table.source;
  }

  toDOM(view: EditorView) {
    const { table, sourceVisible } = this;
    const document = view.dom.ownerDocument;
    const root = document.createElement("div");
    root.className = "ml-editor-table";
    root.dataset.tableStart = String(table.from);
    const toolbar = document.createElement("div");
    toolbar.className = "ml-table-toolbar";
    const toggle = createButton(document, sourceVisible ? "表格视图" : "编辑源码", "ml-table-action");
    toggle.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: table.from + (sourceVisible ? 0 : 1) }, scrollIntoView: true });
      view.focus();
    });
    toolbar.append(toggle);
    root.append(toolbar);
    if (sourceVisible) return root;

    const scroll = document.createElement("div");
    scroll.className = "ml-table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "可横向滚动的 Markdown 表格");
    const grid = document.createElement("table");
    const header = grid.createTHead();
    const body = grid.createTBody();
    for (const [rowIndex, cells] of table.rows.entries()) {
      const row = (rowIndex === 0 ? header : body).insertRow();
      for (const [column, cell] of cells.entries()) {
        const field = document.createElement(rowIndex === 0 ? "th" : "td");
        if (rowIndex === 0) field.setAttribute("scope", "col");
        field.style.textAlign = table.alignments[column];
        const button = createButton(document, cell.text.replace(/\\\|/g, "|"), "ml-table-cell");
        if (cell.text.length > 40) button.classList.add("ml-table-cell-long");
        else if (cell.text.length <= 8 || /^[\x20-\x7e]{1,24}$/.test(cell.text)) {
          button.classList.add("ml-table-cell-compact");
        }
        if (!cell.text) button.setAttribute("aria-label", "编辑空单元格");
        button.addEventListener("click", () => showCellEditor(view, table, cell, button));
        field.append(button);
        row.append(field);
      }
    }
    scroll.append(grid);
    root.append(scroll);
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
    const state = transaction.state;
    const parsed = transaction.docChanged || syntaxTree(state) !== syntaxTree(transaction.startState);
    if (!parsed && !transaction.selection) return previous;
    const tables = parsed ? readEditorTables(state) : previous.tables;
    return { tables, decorations: tableDecorations(state, tables) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
