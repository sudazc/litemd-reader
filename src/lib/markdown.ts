import MarkdownIt, { type Token } from "markdown-it";
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import { cacheImageLoader } from "./image-loader";

export type DocumentHeading = {
  id: string;
  title: string;
  level: number;
  line: number;
};

export type RenderedDocument = {
  html: string;
  headings: DocumentHeading[];
};

type ImageLoader = (source: string) => Promise<string>;
type KatexPlugin = (typeof import("@mdit/plugin-katex"))["katex"];
type MermaidRenderer = (typeof import("mermaid"))["default"];

const maxMermaidDiagrams = 10;
const maxMermaidDiagramChars = 20_000;
const markdownOptions = { html: false, linkify: true, typographer: false };
const headingParser = new MarkdownIt(markdownOptions);
const { escapeHtml } = headingParser.utils;

const mermaidThemeCss = `
  svg { background: transparent; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  .node rect, .node circle, .node ellipse, .node polygon, .node path,
  .actor, .actor-top, .actor-bottom, .classGroup rect, .stateGroup rect,
  .er.entityBox {
    fill: var(--surface-muted, #f1f3f6) !important;
    stroke: var(--line-strong, #818a99) !important;
  }
  text, .nodeLabel, .labelText, .messageText {
    fill: var(--text, #252830) !important;
    color: var(--text, #252830) !important;
  }
  .edgePath .path, .flowchart-link, .messageLine0, .messageLine1, .loopLine {
    stroke: var(--muted, #626875) !important;
  }
  .edgeLabel rect, .labelBkg { fill: var(--surface, #ffffff) !important; }
`;

let katexPluginPromise: Promise<KatexPlugin> | undefined;
let mermaidRendererPromise: Promise<MermaidRenderer> | undefined;
let nextMermaidRenderId = 0;

type MermaidRenderBlock = {
  marker: string;
  source: string;
  lineStart: number;
  lineEnd: number;
};

function loadKatexPlugin(): Promise<KatexPlugin> {
  if (!katexPluginPromise) {
    const loading = Promise.all([
      import("@mdit/plugin-katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([plugin]) => plugin.katex);
    katexPluginPromise = loading;
    void loading.catch(() => {
      if (katexPluginPromise === loading) katexPluginPromise = undefined;
    });
  }
  return katexPluginPromise;
}

function loadMermaidRenderer(): Promise<MermaidRenderer> {
  if (!mermaidRendererPromise) {
    const loading = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        maxTextSize: maxMermaidDiagramChars,
        secure: ["securityLevel", "startOnLoad", "suppressErrorRendering", "maxTextSize", "themeCSS", "htmlLabels"],
        theme: "base",
        themeCSS: mermaidThemeCss,
        htmlLabels: false,
        themeVariables: {
          background: "transparent",
          primaryColor: "#f1f3f6",
          primaryTextColor: "#252830",
          primaryBorderColor: "#818a99",
          lineColor: "#626875",
          textColor: "#252830",
          mainBkg: "#f1f3f6",
          nodeBorder: "#818a99",
          clusterBkg: "#f1f3f6",
          clusterBorder: "#818a99",
          titleColor: "#252830",
          edgeLabelBackground: "#ffffff",
          fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
        },
      });
      return mermaid;
    });
    mermaidRendererPromise = loading;
    void loading.catch(() => {
      if (mermaidRendererPromise === loading) mermaidRendererPromise = undefined;
    });
  }
  return mermaidRendererPromise;
}

function containsMathDelimiter(text: string): boolean {
  return (
    /(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$/.test(text) ||
    /(?<!\\)\$(?!\$)[^$\n]+?(?<!\\)\$(?!\$)/.test(text) ||
    /(?<!\\)\\\([\s\S]+?(?<!\\)\\\)/.test(text) ||
    /(?<!\\)\\\[[\s\S]+?(?<!\\)\\\]/.test(text)
  );
}

function isMathFence(token: Token): boolean {
  return token.type === "fence" && token.info.trim().toLowerCase() === "math";
}

function hasMathContent(tokens: Token[], source: string): boolean {
  if (tokens.some(isMathFence)) return true;
  if (!source.includes("$") && !source.includes("\\")) return false;

  // Markdown-it 会去掉已解析文本中公式分隔符前的反斜杠
  const inlineSource = tokens
    .filter((token) => token.type === "inline")
    .map((token) => token.content)
    .join("\n");
  return containsMathDelimiter(inlineSource);
}

function isMermaidFence(token: Token): boolean {
  return token.type === "fence" && token.info.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}

function mermaidFallback(
  source: string,
  lineStart: number,
  lineEnd: number,
  escapeHtml: (value: string) => string,
): string {
  return `<pre class="mermaid-fallback" data-source-line-start="${lineStart}" data-source-line-end="${lineEnd}"><code class="language-mermaid">${escapeHtml(source)}</code></pre>\n`;
}

function renderMermaidBlock(
  block: MermaidRenderBlock,
  svg: string,
  escapeHtml: (value: string) => string,
): string {
  return `<div class="mermaid-block" data-source-line-start="${block.lineStart}" data-source-line-end="${block.lineEnd}">${svg}<details class="mermaid-source"><summary>查看 Mermaid 源码</summary><pre><code class="language-mermaid">${escapeHtml(block.source)}</code></pre></details></div>\n`;
}

function slugify(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function collectHeadings(tokens: Token[]): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  const slugCounts = new Map<string, number>();
  const usedHeadingIds = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;

    const inline = tokens[index + 1];
    const title = inline?.children
      ?.filter((child) => ["text", "code_inline", "image", "math_inline"].includes(child.type))
      .map((child) => child.content)
      .join("")
      .trim() || inline?.content || "未命名标题";
    const base = slugify(title);
    let count = slugCounts.get(base) ?? 0;
    let id = count === 0 ? base : `${base}-${count}`;
    while (usedHeadingIds.has(id)) {
      count += 1;
      id = `${base}-${count}`;
    }
    slugCounts.set(base, count + 1);
    usedHeadingIds.add(id);

    token.attrSet("id", id);
    headings.push({
      id,
      title,
      level: Number(token.tag.slice(1)) || 1,
      line: token.map?.[0] ?? 0,
    });
  }

  return headings;
}

export function extractDocumentHeadings(source: string): DocumentHeading[] {
  return collectHeadings(headingParser.parse(source, {}));
}

function replaceWithText(token: Token, text: string) {
  token.type = "text";
  token.tag = "";
  token.nesting = 0;
  token.attrs = null;
  token.content = text;
  token.children = null;
  token.markup = "";
  token.info = "";
}

export async function renderMarkdown(
  source: string,
  loadImage: ImageLoader,
): Promise<RenderedDocument> {
  type Highlighter = (typeof import("highlight.js/lib/common"))["default"];
  let highlighter: Highlighter | undefined;

  const parser = new MarkdownIt({
    ...markdownOptions,
    highlight(code: string, language: string) {
      if (highlighter && language && highlighter.getLanguage(language)) {
        try {
          return highlighter.highlight(code, { language, ignoreIllegals: true }).value;
        } catch {
          // Fall through to escaped plain text for incomplete or unknown syntax.
        }
      }
      return escapeHtml(code);
    },
  }).use(taskLists, { enabled: false });

  parser.renderer.rules.table_open = (tokens, index, options, _env, self) =>
    `<div class="reader-table-block"><div class="reader-table-wrap" role="region" aria-label="表格，可使用方向键滚动" tabindex="0">${self.renderToken(tokens, index, options)}`;
  parser.renderer.rules.table_close = (tokens, index, options, _env, self) =>
    `${self.renderToken(tokens, index, options)}</div></div>`;
  parser.renderer.rules.th_open = parser.renderer.rules.td_open = (tokens, index, options, _env, self) => {
    const text = tokens[index + 1]?.children?.map((child) => child.content).join("") ?? "";
    if (text.length > 40) {
      tokens[index].attrJoin("class", "reader-table-cell-long");
    } else if (text.length <= 8 || /^[\x20-\x7e]{1,24}$/.test(text)) {
      tokens[index].attrJoin("class", "reader-table-cell-compact");
    }
    return self.renderToken(tokens, index, options);
  };

  let tokens = parser.parse(source, {});
  if (hasMathContent(tokens, source)) {
    try {
      const katex = await loadKatexPlugin();
      parser.use(katex, {
        delimiters: "all",
        throwOnError: false,
        trust: false,
        maxExpand: 500,
        maxSize: 100,
        errorColor: "var(--error)",
        logger: () => "ignore" as const,
      });
      tokens = parser.parse(source, {});
      for (const token of tokens) {
        if (isMathFence(token)) token.type = "math_block";
      }
      const defaultMathBlockRenderer = parser.renderer.rules.math_block;
      if (defaultMathBlockRenderer) {
        parser.renderer.rules.math_block = (renderTokens, index, options, env, self) => {
          const token = renderTokens[index];
          const rendered = defaultMathBlockRenderer(renderTokens, index, options, env, self);
          const lineStart = (token.map?.[0] ?? 0) + 1;
          const lineEnd = Math.max(token.map?.[1] ?? lineStart, lineStart);
          return `<div class="math-block" data-source-line-start="${lineStart}" data-source-line-end="${lineEnd}">${rendered}</div>\n`;
        };
      }
    } catch {
      // 数学扩展不可用时保留原始公式文本
    }
  }

  const shouldRenderMermaid = tokens.some(
    (token) => isMermaidFence(token) && token.content.length <= maxMermaidDiagramChars,
  );
  const mermaidRendererLoading = shouldRenderMermaid
    ? loadMermaidRenderer().catch(() => null)
    : Promise.resolve(null);

  if (tokens.some((token) => token.type === "fence" && token.info.trim() && !isMermaidFence(token))) {
    highlighter = await import("highlight.js/lib/common")
      .then((module) => module.default)
      .catch(() => undefined);
  }

  const mermaidBlocks: MermaidRenderBlock[] = [];
  let mermaidCount = 0;
  const defaultFenceRenderer = parser.renderer.rules.fence;
  parser.renderer.rules.fence = (renderTokens, index, options, env, self) => {
    const token = renderTokens[index];
    if (!isMermaidFence(token)) {
      const rendered = defaultFenceRenderer
        ? defaultFenceRenderer(renderTokens, index, options, env, self)
        : self.renderToken(renderTokens, index, options);
      return `<div class="reader-code-block">${rendered}<button class="reader-code-copy" type="button" data-copy-code aria-label="复制代码">复制</button></div>\n`;
    }
    if (mermaidCount >= maxMermaidDiagrams || token.content.length > maxMermaidDiagramChars) {
      const lineStart = (token.map?.[0] ?? 0) + 1;
      const lineEnd = Math.max(token.map?.[1] ?? lineStart, lineStart);
      return mermaidFallback(token.content, lineStart, lineEnd, escapeHtml);
    }

    mermaidCount += 1;
    const lineStart = (token.map?.[0] ?? 0) + 1;
    const lineEnd = Math.max(token.map?.[1] ?? lineStart, lineStart);
    const marker = `<!--md-reader-mermaid-${nextMermaidRenderId++}-->`;
    mermaidBlocks.push({ marker, source: token.content, lineStart, lineEnd });
    return `${marker}\n`;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.map &&
      (token.nesting === 1 || token.type === "fence" || token.type === "math_block" || token.type === "hr")
    ) {
      token.attrSet("data-source-line-start", String(token.map[0] + 1));
      token.attrSet("data-source-line-end", String(Math.max(token.map[1], token.map[0] + 1)));
    }
  }

  const headings = collectHeadings(tokens);

  const imageTokens = tokens
    .flatMap((token) => token.children ?? [])
    .filter((child) => child.type === "image");
  let nextImageIndex = 0;
  const workerCount = Math.min(3, imageTokens.length);
  const loadCachedImage = cacheImageLoader(loadImage);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextImageIndex < imageTokens.length) {
        const child = imageTokens[nextImageIndex++];
        const sourcePath = String(child.attrGet("src") ?? "");
        const alt = child.content || sourcePath;
        if (/^(?:https?:)?\/\//i.test(sourcePath)) {
          replaceWithText(child, `[外部图片已隐藏：${alt}]`);
          continue;
        }

        try {
          const localPath = decodeURIComponent(sourcePath.split(/[?#]/, 1)[0]);
          child.attrSet("src", await loadCachedImage(localPath));
        } catch {
          replaceWithText(child, `[图片无法加载：${alt}]`);
        }
      }
    }),
  );

  let html = parser.renderer.render(tokens, parser.options, {});
  if (mermaidBlocks.length) {
    const mermaid = await mermaidRendererLoading;
    for (const block of mermaidBlocks) {
      let replacement = "";
      if (mermaid) {
        try {
          const { svg } = await mermaid.render(`md-reader-diagram-${nextMermaidRenderId++}`, block.source);
          replacement = renderMermaidBlock(block, svg, escapeHtml);
        } catch {
          // Mermaid 语法无效时回退到可复制的源码
        }
      }
      if (!replacement) {
        replacement = mermaidFallback(block.source, block.lineStart, block.lineEnd, escapeHtml);
      }
      html = html.replace(block.marker, () => replacement);
    }
  }

  return {
    html: DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
      ADD_ATTR: ["target", "rel", "data-source-line-start", "data-source-line-end", "data-copy-code"],
    }),
    headings,
  };
}
