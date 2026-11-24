import { syntaxTree } from "@codemirror/language";
import { Compartment, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

const hidden = Decoration.replace({});
const headings = Array.from({ length: 6 }, (_, index) =>
  Decoration.line({ attributes: { class: `ml-preview-heading-${index + 1}` } }));
const codeLine = Decoration.line({ attributes: { class: "ml-preview-code-line" } });
const bold = Decoration.mark({ class: "ml-preview-bold" });
const italic = Decoration.mark({ class: "ml-preview-italic" });
const strike = Decoration.mark({ class: "ml-preview-strike" });
const code = Decoration.mark({ class: "ml-preview-code" });
const link = Decoration.mark({ class: "ml-preview-link" });
const bullet = Decoration.mark({ class: "ml-preview-bullet" });
const number = Decoration.mark({ class: "ml-preview-number" });
const quote = Decoration.mark({ class: "ml-preview-quote" });

function headingLevel(name: string) {
  return name.startsWith("ATXHeading") || name.startsWith("SetextHeading") ? Number(name.at(-1)) : 0;
}

function paragraphAt(tree: Tree, pos: number, side: -1 | 1) {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
    if (node.name === "Paragraph" || node.name === "Task" || headingLevel(node.name)) return node;
  }
  return null;
}

/** 仅折叠未选中段落的 Markdown 标记，保留文档及选区的原始坐标 */
export function markdownPreviewDecorations(state: EditorState, from: number, to: number) {
  const tree = syntaxTree(state);
  const selected = state.selection.ranges.map((range) => {
    const start = paragraphAt(tree, range.from, 1) ?? paragraphAt(tree, range.from, -1);
    const end = paragraphAt(tree, range.to, -1) ?? paragraphAt(tree, range.to, 1);
    return {
      from: state.doc.lineAt(start?.from ?? range.from).from,
      to: state.doc.lineAt(end?.to ?? range.to).to,
    };
  });

  const decorations: Range<Decoration>[] = [];
  const isSelected = (start: number, end: number) =>
    selected.some((range) => range.from <= end && range.to >= start);
  const hide = (start: number, end: number) => {
    if (start < end) decorations.push(hidden.range(start, end));
  };

  tree.iterate({
    from,
    to,
    enter(ref) {
      const { name, node } = ref;
      if (name === "Table") return false;
      if (name === "CodeBlock" || name === "FencedCode") {
        const first = state.doc.lineAt(Math.max(from, node.from)).number;
        const last = state.doc.lineAt(Math.min(to, node.to)).number;
        for (let line = first; line <= last; line += 1) {
          decorations.push(codeLine.range(state.doc.line(line).from));
        }
        return false;
      }

      const level = headingLevel(name);
      if (level) {
        const setext = name.startsWith("SetextHeading");
        const first = state.doc.lineAt(Math.max(from, node.from)).number;
        const last = state.doc.lineAt(Math.min(to, node.to)).number;
        const markLine = setext ? state.doc.lineAt(node.to).number : -1;
        for (let line = first; line <= last; line += 1) {
          if (line !== markLine) decorations.push(headings[level - 1].range(state.doc.line(line).from));
        }
        if (!isSelected(node.from, node.to)) {
          let openingEnd = node.from;
          for (const mark of node.getChildren("HeaderMark")) {
            const line = state.doc.lineAt(mark.from);
            if (setext) hide(mark.from, mark.to);
            else if (mark.from === node.from) {
              const spacing = /^[ \t]*/.exec(state.doc.sliceString(mark.to, line.to))![0].length;
              openingEnd = mark.to + spacing;
              hide(mark.from, openingEnd);
            } else {
              const spacing = /[ \t]*$/.exec(state.doc.sliceString(line.from, mark.from))![0].length;
              hide(Math.max(openingEnd, mark.from - spacing), mark.to);
            }
          }
        }
        return;
      }

      if (isSelected(node.from, node.to)) return;
      if (name === "StrongEmphasis" || name === "Emphasis" || name === "InlineCode" || name === "Strikethrough") {
        const markType = name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
        const marks = node.getChildren(markType);
        if (marks.length !== 2) return;
        const [start, end] = marks;
        hide(start.from, start.to);
        hide(end.from, end.to);
        const style = name === "StrongEmphasis" ? bold : name === "Emphasis" ? italic : name === "InlineCode" ? code : strike;
        if (start.to < end.from) decorations.push(style.range(start.to, end.from));
        return;
      }

      if (name === "Link" || name === "Autolink") {
        const [opening, closing, destination] = node.getChildren("LinkMark");
        // 引用链接要等定义解析后才知道是否有效，保留其 Markdown 文本
        if (!opening || !closing || opening.to >= closing.from || (name === "Link" &&
          (!destination || state.doc.sliceString(destination.from, destination.to) !== "("))) return;
        // 行内替换不能跨换行符，保留跨行目标的链接源码
        if (state.doc.lineAt(closing.from).number !== state.doc.lineAt(node.to).number) return;
        hide(opening.from, opening.to);
        hide(closing.from, node.to);
        decorations.push(link.range(opening.to, closing.from));
        return;
      }

      if (name === "ListMark") {
        const style = state.doc.sliceString(node.from, node.to).length === 1 ? bullet : number;
        decorations.push(style.range(node.from, node.to));
      } else if (name === "QuoteMark") {
        decorations.push(quote.range(node.from, node.to));
      }
    },
  });

  return Decoration.set(decorations, true);
}

export const livePreviewCompartment = new Compartment();

export const markdownLivePreview = [
  EditorView.editorAttributes.of({ class: "ml-live-preview" }),
  ViewPlugin.fromClass(class {
    decorations: ReturnType<typeof markdownPreviewDecorations>;
    private composing = false;

    constructor(view: EditorView) {
      this.decorations = markdownPreviewDecorations(view.state, view.viewport.from, view.viewport.to);
    }

    update(update: ViewUpdate) {
      const view = update.view;
      if (view.compositionStarted) {
        this.composing = true;
        if (update.docChanged) this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (this.composing || update.docChanged || update.selectionSet || update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.composing = false;
        this.decorations = markdownPreviewDecorations(view.state, view.viewport.from, view.viewport.to);
      }
    }
  }, { decorations: (plugin) => plugin.decorations }),
];
