import MarkdownIt from "markdown-it";

/** 配置阅读与编辑共用的 Markdown 语法和表格标记
 * @param {import("markdown-it").MarkdownItOptions} [options]
 */
export function createMarkdownParser(options = {}) {
  const parser = new MarkdownIt({ linkify: true, typographer: false, ...options, html: false });
  parser.inline.ruler.before("html_inline", "line_break_tag", (state, silent) => {
    if (state.src[state.pos] !== "<") return false;
    const match = /^<br[ \t]*\/?>/i.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) {
      const token = state.push("hardbreak", "br", 0);
      token.meta = { lineBreakTag: { from: state.pos, to: state.pos + match[0].length } };
    }
    state.pos += match[0].length;
    return true;
  });

  parser.renderer.rules.table_open = (tokens, index, options, _env, self) => {
    tokens[index].attrSet("class", "markdown-table");
    return `<div class="reader-table-block"><div class="reader-table-wrap" role="region" aria-label="表格，可使用方向键滚动" tabindex="0">${self.renderToken(tokens, index, options)}`;
  };
  parser.renderer.rules.table_close = (tokens, index, options, _env, self) =>
    `${self.renderToken(tokens, index, options)}</div></div>`;

  parser.renderer.rules.th_open = parser.renderer.rules.td_open = (tokens, index, options, _env, self) => {
    const children = tokens[index + 1]?.children ?? [];
    const text = children.map((child) => child.content).join("");
    if (text.length > 40) {
      tokens[index].attrSet("class", "markdown-table-cell-long");
    } else if (!children.some((child) => child.type === "hardbreak") && (text.length <= 8 || /^[\x20-\x7e]{1,24}$/.test(text))) {
      tokens[index].attrSet("class", "markdown-table-cell-compact");
    }
    return self.renderToken(tokens, index, options);
  };
  return parser;
}
