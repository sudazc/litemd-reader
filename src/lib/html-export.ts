type StaticHtmlOptions = {
  title: string;
  bodyHtml: string;
  darkMode: boolean;
  fontSize: number;
  lineHeight: number;
  katexCss: string;
};

const lightTheme = `
  color-scheme: light;
  --surface: #ffffff;
  --surface-muted: #f1f3f6;
  --text: #252830;
  --muted: #626875;
  --line: #e2e5ea;
  --line-strong: #818a99;
  --accent: #3d5bc3;
  --error: #b42332;
  --code-bg: #f1f3f6;
  --code-comment: #626875;
  --code-keyword: #7546a3;
  --code-string: #286345;
  --code-number: #8d4b24;
  --code-title: #285a94;
`;

const darkTheme = `
  color-scheme: dark;
  --surface: #1b1d23;
  --surface-muted: #252932;
  --text: #e6e8ee;
  --muted: #adb3c0;
  --line: #323640;
  --line-strong: #707989;
  --accent: #a7b8ff;
  --error: #ff9ca8;
  --code-bg: #252932;
  --code-comment: #a4adbd;
  --code-keyword: #ccaff2;
  --code-string: #92d3aa;
  --code-number: #eab48a;
  --code-title: #9ac5f0;
`;

const readerStyles = `
  :root { ${lightTheme} }
  :root[data-theme="dark"] { ${darkTheme} }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; margin: 0; background: var(--surface); color: var(--text); }
  body { font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  .reader-content {
    width: min(calc(100% - 64px), 720px);
    min-height: 100vh;
    margin: 0 auto;
    padding: 56px 0 96px;
    color: var(--text);
    font-size: 20px;
    font-weight: 400;
    line-height: 1.8;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .reader-content h1, .reader-content h2, .reader-content h3,
  .reader-content h4, .reader-content h5, .reader-content h6 {
    color: var(--text); font-weight: 600; line-height: 1.4;
    letter-spacing: 0;
    scroll-margin-top: 24px;
  }
  .reader-content h1:first-child, .reader-content h2:first-child,
  .reader-content h3:first-child, .reader-content h4:first-child,
  .reader-content h5:first-child, .reader-content h6:first-child { margin-top: 0; }
  .reader-content h1 { margin: 1.4em 0 0.78em; font-size: 1.8em; line-height: 1.3; font-weight: 650; }
  .reader-content h2 { margin: 1.43em 0 0.57em; font-size: 1.4em; line-height: 1.4; font-weight: 650; }
  .reader-content h3 { margin: 1.33em 0 0.5em; font-size: 1.2em; line-height: 1.45; font-weight: 650; }
  .reader-content h4 { margin: 1.09em 0 0.45em; font-size: 1.1em; line-height: 1.45; }
  .reader-content h5 { margin: 1.2em 0 0.4em; font-size: 1em; line-height: 1.5; }
  .reader-content h6 { margin: 1em 0 0.4em; color: var(--muted); font-size: 1em; line-height: 1.5; }
  .reader-content p { margin: 0 0 0.9em; }
  .reader-content a { color: var(--accent); text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); text-underline-offset: 3px; }
  .reader-content a:hover { text-decoration-color: currentColor; }
  .reader-content blockquote { margin: 1.25em 0; padding: 0.12em 0 0.12em 1.05em; border-left: 3px solid var(--line-strong); color: var(--muted); }
  .reader-content blockquote > :last-child { margin-bottom: 0; }
  .reader-content ul, .reader-content ol { margin: 0 0 1.2em; padding-left: 1.55em; }
  .reader-content li { padding-left: 0.2em; }
  .reader-content li + li { margin-top: 0.22em; }
  .reader-content hr { height: 1px; margin: 2.5em 0; border: 0; background: var(--line); }
  .reader-content code { padding: 0.15em 0.35em; border-radius: 4px; color: var(--text); background: var(--code-bg); font-family: "Cascadia Code", Consolas, monospace; font-size: 0.9em; }
  .reader-content pre { margin: 1.35em 0 1.6em; padding: 17px 19px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--code-bg); line-height: 1.65; }
  .reader-content pre code { display: block; padding: 0; color: inherit; background: transparent; font-size: 0.9em; white-space: pre; }
  .reader-content .reader-code-block { margin: 1.35em 0 1.6em; }
  .reader-content .reader-code-block pre { margin: 0; padding-top: 17px; }
  .reader-content .reader-code-copy { display: none; }
  .reader-content .reader-table-wrap { width: 100%; max-width: 100%; overflow-x: auto; margin: 1.4em 0 1.8em; overscroll-behavior-x: contain; }
  .reader-content .reader-table-wrap:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .reader-content table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  .reader-content th, .reader-content td { padding: 10px 14px; border: 1px solid var(--line); text-align: left; vertical-align: top; word-break: normal; }
  .reader-content th { background: var(--code-bg); font-weight: 600; }
  .reader-content img { display: block; max-width: 100%; height: auto; margin: 1.3em auto; border-radius: 5px; }
  .reader-content .katex-display { margin: 1.2em 0; overflow-x: auto; overflow-y: hidden; padding: 0.12em 0; }
  .reader-content .katex-error { color: var(--error); white-space: normal; }
  .reader-content .math-block { margin: 1.2em 0; }
  .reader-content .mermaid-block { min-width: 0; margin: 1.45em 0 1.7em; overflow-x: auto; text-align: center; }
  .reader-content .mermaid-block > svg { display: block; width: auto; max-width: 100%; max-height: 720px; height: auto; margin: 0 auto; }
  .reader-content .mermaid-source { margin-top: 0.65em; color: var(--muted); font-size: 14px; text-align: left; }
  .reader-content .mermaid-source summary { width: fit-content; cursor: pointer; font-weight: 550; }
  .reader-content .mermaid-source pre { margin-top: 0.6em; }
  .reader-content .hljs-comment, .reader-content .hljs-quote { color: var(--code-comment); font-style: italic; }
  .reader-content .hljs-keyword, .reader-content .hljs-selector-tag, .reader-content .hljs-literal, .reader-content .hljs-name { color: var(--code-keyword); }
  .reader-content .hljs-string, .reader-content .hljs-regexp, .reader-content .hljs-addition { color: var(--code-string); }
  .reader-content .hljs-number, .reader-content .hljs-attr, .reader-content .hljs-variable, .reader-content .hljs-template-variable { color: var(--code-number); }
  .reader-content .hljs-title, .reader-content .hljs-section, .reader-content .hljs-built_in { color: var(--code-title); }
  .reader-content mark.reader-search-hit { padding: 0 1px; border-radius: 2px; color: #493b16; background: #fff0b8; }
  .reader-content mark.reader-search-hit.current { background: #f3ce66; outline: 2px solid rgba(53, 40, 5, 0.72); }
  :root[data-theme="dark"] .reader-content mark.reader-search-hit { color: #fff1bb; background: #594a23; }
  :root[data-theme="dark"] .reader-content mark.reader-search-hit.current { background: #795b19; outline-color: rgba(255, 244, 204, 0.9); }
  .task-list-item { list-style: none; }
  .task-list-item-checkbox { margin: 0 0.55em 0 -1.5em; }
  @media (max-width: 820px) {
    .reader-content { padding: 40px 25px 76px; }
  }
  @media (max-width: 560px) {
    .reader-content { width: 100%; margin: 0; padding: 32px 19px 64px; }
  }
  @media print {
    @page { margin: 18mm; }
    :root, :root[data-theme="dark"] {
      color-scheme: light;
      --surface: #ffffff;
      --surface-muted: #f8f9fb;
      --text: #20242a;
      --muted: #424b57;
      --line: #d7dde5;
      --line-strong: #bdc5cf;
      --accent: #263f70;
      --error: #8e1720;
      --code-bg: #f3f5f8;
      --code-comment: #4d5866;
      --code-keyword: #63418e;
      --code-string: #205c3f;
      --code-number: #87411f;
      --code-title: #205984;
    }
    body { background: #ffffff !important; color: #20242a !important; }
    .reader-content { width: auto; min-height: 0; max-width: none; padding: 0; color: #20242a; }
    .reader-content a { color: #20242a; text-decoration: underline; }
    .reader-content pre { overflow: visible; white-space: pre-wrap; overflow-wrap: anywhere; }
    .reader-content pre, .reader-content .reader-table-wrap, .reader-content table, .reader-content img, .reader-content .mermaid-block { break-inside: avoid; }
    .reader-content h1, .reader-content h2, .reader-content h3, .reader-content h4 { break-after: avoid-page; }
    .reader-content p, .reader-content li { orphans: 3; widows: 3; }
  }
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function fontMimeType(url: URL): string {
  if (url.pathname.endsWith(".woff2")) return "font/woff2";
  if (url.pathname.endsWith(".woff")) return "font/woff";
  if (url.pathname.endsWith(".ttf")) return "font/ttf";
  if (url.pathname.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}

async function fetchFontDataUrl(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取公式字体文件");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${fontMimeType(url)};base64,${btoa(binary)}`;
}

/** 读取并内嵌 KaTeX 样式及字体，保证导出的公式离线可用 */
export async function loadKatexExportCss(): Promise<string> {
  const hasKatexFonts = (value: string) =>
    /@font-face\s*\{[^}]*font-family\s*:\s*["']?KaTeX_/i.test(value);
  let css = "";
  let stylesheetUrl = new URL(document.baseURI);

  for (const stylesheet of Array.from(document.styleSheets)) {
    let stylesheetCss: string;
    try {
      stylesheetCss = Array.from(stylesheet.cssRules, (rule) => rule.cssText).join("\n");
    } catch {
      continue;
    }
    if (!hasKatexFonts(stylesheetCss)) continue;

    const owner = stylesheet.ownerNode;
    css = owner instanceof HTMLStyleElement ? owner.textContent ?? stylesheetCss : stylesheetCss;
    if (stylesheet.href) stylesheetUrl = new URL(stylesheet.href);
    break;
  }

  if (!css) throw new Error("未找到公式样式文件，请重试导出");
  const fontFaces = Array.from(css.matchAll(/@font-face\s*\{[^}]*\}/gi));
  const fontReferences = fontFaces.map((fontFace) => {
    const srcMatch = /src\s*:\s*([^;}]+);?/i.exec(fontFace[0]);
    if (!srcMatch) throw new Error("公式字体声明无效");
    const sources = Array.from(
      srcMatch[1].matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)\s*format\(\s*(['"]?)(.*?)\3\s*\)/gi),
      (match) => ({ source: match[2].trim(), format: match[4].trim() }),
    );
    const selected =
      sources.find((source) => source.format.toLowerCase() === "woff2") ??
      sources.find((source) => source.format.toLowerCase() === "woff") ??
      sources[0];
    if (!selected) throw new Error("公式字体格式不受支持");
    return { fontFace, srcMatch, selected };
  });
  const urls = [
    ...new Set(
      fontReferences
        .map(({ selected }) => selected.source)
        .filter((source) => source && !source.startsWith("data:")),
    ),
  ];
  const embeddedFonts = new Map<string, string>();
  let nextUrl = 0;

  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (nextUrl < urls.length) {
      const source = urls[nextUrl++];
      const fontUrl = new URL(source, stylesheetUrl);
      if (fontUrl.origin !== stylesheetUrl.origin) {
        throw new Error("公式样式包含非本地字体，无法生成离线文件");
      }
      embeddedFonts.set(source, await fetchFontDataUrl(fontUrl));
    }
  }));

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const { fontFace, srcMatch, selected } of fontReferences) {
    const dataUrl = selected.source.startsWith("data:")
      ? selected.source
      : embeddedFonts.get(selected.source);
    if (!dataUrl) throw new Error("无法内嵌公式字体");
    const updatedFontFace = fontFace[0].replace(
      srcMatch[0],
      `src:url("${dataUrl}") format("${selected.format}");`,
    );
    const start = fontFace.index ?? 0;
    replacements.push({ start, end: start + fontFace[0].length, value: updatedFontFace });
  }
  let embeddedCss = css;
  for (const replacement of replacements.reverse()) {
    embeddedCss = embeddedCss.slice(0, replacement.start) + replacement.value + embeddedCss.slice(replacement.end);
  }
  return embeddedCss;
}

/** 构建可离线打开的单文件 HTML */
export function buildStaticHtml(options: StaticHtmlOptions): string {
  const title = escapeHtml(options.title);
  const theme = options.darkMode ? "dark" : "light";
  const size = Math.min(25, Math.max(15, Math.round(options.fontSize)));
  const lineHeight = [1.6, 1.8, 2].includes(options.lineHeight) ? options.lineHeight : 1.8;
  const styles = readerStyles
    .replace("font-size: 20px;", `font-size: ${size}px;`)
    .replace("line-height: 1.8;", `line-height: ${lineHeight};`);

  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="LiteMD">
  <title>${title}</title>
  <style>${styles}\n${options.katexCss}</style>
</head>
<body>
  <main class="reader-content">${options.bodyHtml}</main>
</body>
</html>`;
}
