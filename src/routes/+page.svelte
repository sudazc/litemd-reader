<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import "$lib/markdown-table.css";
  import MarkdownEditor from "$lib/MarkdownEditor.svelte";
  import { bindReaderTableScrollbars } from "$lib/reader-table-scroll";
  import { confirmDocumentReload } from "$lib/reload-confirmation";
  import {
    fadeTransition,
    panelTransition,
    popupTransition,
    shiftTransition,
  } from "$lib/popup-transition";
  import { tooltipLayer } from "$lib/tooltip";
  import {
    BookOpen,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    FileText,
    FolderOpen,
    History,
    House,
    LogOut,
    Minus,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Plus,
    Printer,
    Search,
    Save,
    Settings,
    Square,
    Sun,
    Trash2,
    X,
  } from "lucide-svelte";
  import type { DocumentHeading, RenderedDocument } from "$lib/markdown";
  import type { Compartment, EditorState } from "@codemirror/state";

  type MarkdownDocument = {
    path: string;
    name: string;
    content: string;
    encoding: string;
    version: FileVersion;
  };

  type FileVersion = {
    size: number;
    modifiedNs: string;
  };

  type MarkdownFileStatus = {
    path: string;
    version: FileVersion | null;
  };

  type MarkdownWriteResult = {
    path: string;
    name: string;
    encoding: string;
    version: FileVersion;
  };

  type ReaderTab = {
    id: string;
    editorInstanceId: string;
    editorState: EditorState | null;
    editorCompartments: EditorCompartments | null;
    savedEditorDoc: EditorState["doc"] | null;
    path: string;
    name: string;
    source: string;
    savedSource: string;
    renderedSource: string;
    renderedPath: string;
    html: string;
    headings: DocumentHeading[];
    scrollTop: number;
    editorScrollTop: number;
    editorScrollProgress: number;
    draftUpdatedAt: number;
    cursor: number;
    encoding: string;
    lineEnding: string;
    version: FileVersion | null;
    externalChange: "modified" | "missing" | null;
    editing: boolean;
    renderGeneration: number;
    loadRequestId: string | null;
    loading: boolean;
    loadStarted: boolean;
    error: string | null;
    pendingFragment?: string;
  };

  type RecentFile = {
    path: string;
    name: string;
    openedAt: number;
  };

  type SessionTab = {
    path: string;
    scrollTop: number;
  };

  type ReaderSession = {
    tabs: SessionTab[];
    activePath: string | null;
  };

  type ConfirmationRequest = {
    title: string;
    message: string;
    confirmLabel: string;
    tone: "primary" | "danger";
  };

  type DraftRecoveryRecord = {
    name: string;
    source: string;
    cursor: number;
    editorScrollProgress: number;
    lineEnding: string;
    updatedAt: number;
  };

  type MarkdownModule = typeof import("$lib/markdown");
  type MarkdownImageLoader = (source: string) => Promise<string>;
  type WindowResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
  type EditorCompartments = {
    lineWrapping: Compartment;
    indentation: Compartment;
  };

  const recentStorageKey = "markdown-reader:recent-files";
  const preferenceStorageKey = "markdown-reader:preferences";
  const sessionStorageKey = "markdown-reader:session";
  const draftRecoveryStorageKey = "markdown-reader:recovery-drafts";
  const maxRecentFiles = 8;
  const defaultFontSize = 20;
  const minFontSize = 15;
  const maxFontSize = 25;
  const defaultLineHeight = 1.8;
  const lineHeightOptions = [1.6, 1.8, 2] as const;
  const defaultTocVisible = false;
  const windowResizeCursorByDirection: Record<WindowResizeDirection, string> = {
    East: "ew-resize",
    North: "ns-resize",
    NorthEast: "nesw-resize",
    NorthWest: "nwse-resize",
    South: "ns-resize",
    SouthEast: "nwse-resize",
    SouthWest: "nesw-resize",
    West: "ew-resize",
  };
  const windowResizeEdgeSize = 6;
  const defaultEditorIndentWidth = 2;
  const editorIndentWidths = [2, 4, 8] as const;
  const defaultOutlineWidth = 240;
  const minOutlineWidth = 200;
  const maxOutlineWidth = 340;
  let tabs = $state<ReaderTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let settingsOpen = $state(false);
  let activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) ?? null);
  let focusableTabId = $derived(activeTabId ?? tabs[0]?.id ?? null);
  let recentFiles = $state<RecentFile[]>([]);
  let hoveredRecentPath = $state<string | null>(null);
  let focusedRecentPath = $state<string | null>(null);
  let pointerCanHover = $state(true);
  let darkMode = $state(false);
  let themeSwitching = $state(false);
  let tocVisible = $state(defaultTocVisible);
  let outlineWidth = $state(defaultOutlineWidth);
  let fontSize = $state(defaultFontSize);
  let lineHeight = $state<(typeof lineHeightOptions)[number]>(defaultLineHeight);
  let restoreLastSession = $state(true);
  let defaultOpenDirectory = $state("");
  let appVersion = $state("0.1.0");
  let windowMaximized = $state(false);
  let windowFocused = $state(true);
  let resizeDirection = $state<WindowResizeDirection | null>(null);
  let settingsCategory = $state<"appearance" | "behavior" | "files" | "about">("appearance");
  let editorWordWrap = $state(true);
  let editorIndentWidth = $state(defaultEditorIndentWidth);
  const visibleOutlineWidth = $derived(Math.min(outlineWidth, maxOutlineWidth));
  let openMenu = $state<"file" | "recent" | "tabs" | null>(null);
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let searchCount = $state(0);
  let activeSearchIndex = $state(0);
  let activeHeadingId = $state<string | null>(null);
  let readerHeadingSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let headingScrollPending = false;
  let notice = $state("");
  let tabContextMenu = $state<{ tabId: string; x: number; y: number } | null>(null);
  let tabContextMenuElement = $state<HTMLDivElement>();
  let zoomedImage = $state<{ src: string; alt: string } | null>(null);
  let pendingCloseIds = $state<string[]>([]);
  let closeAfterConfirmation = $state(false);
  let closeSaveInProgress = $state(false);
  let pendingConfirmation = $state<ConfirmationRequest | null>(null);
  let confirmationResolver: ((confirmed: boolean) => void) | undefined;
  let confirmationReturnFocus: HTMLElement | null = null;
  let closePromptReturnFocus: HTMLElement | null = null;
  let confirmationDialog = $state<HTMLElement>();
  let allowConfirmedWindowClose = false;
  let windowClosePending = false;
  let closePromptGeneration = 0;
  let startupOpenReady = $state(false);
  let nativeOpenSignaled = $state(false);
  let forwardedPaths = $state.raw<string[]>([]);
  let drainingNativeOpenRequests = false;
  const documentInteractionBlocked = $derived(
    Boolean(pendingConfirmation || pendingCloseIds.length || closeAfterConfirmation || zoomedImage),
  );
  let editorComponent:
    | {
        scrollToLine(line: number): void;
        scrollToProgress(progress: number): void;
        focusEditor(): void;
        commitTableCell(): void;
        openSearch(): void;
        closeSearch(): void;
        toggleSearch(): void;
      }
    | undefined = $state();
  let tabStripContainerElement = $state<HTMLDivElement>();
  let tabStripElement = $state<HTMLDivElement>();
  let tabListElement = $state<HTMLDivElement>();
  let hasTabOverflow = $state(false);
  let readerViewport = $state<HTMLDivElement>();
  let readerContent = $state<HTMLElement>();
  let outlineList = $state<HTMLElement>();
  let outlineResizeBounds: { left: number; splitterWidth: number } | null = null;
  let searchInput = $state<HTMLInputElement>();
  let settingsWorkspace = $state<HTMLElement>();
  let lastFontZoomAt = Number.NEGATIVE_INFINITY;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let themeSwitchTimer: ReturnType<typeof setTimeout> | undefined;
  let noticePersistent = $state(false);
  let noticeRemainingMs = 3000;
  let noticeDeadline = 0;
  let noticePointerInside = false;
  let noticeFocusInside = false;
  let imageZoomClose = $state<HTMLButtonElement>();
  let imageZoomTrigger: HTMLImageElement | null = null;
  let draggingFiles = $state(false);
  let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let draftRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let externalCheckTimer: ReturnType<typeof setInterval> | undefined;
  const editorOutlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const readerCodeCopyTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  const externalChecksInFlight = new Set<string>();
  let restoringSession = false;
  let draggedTabId = $state<string | null>(null);
  let dropTargetTabId = $state<string | null>(null);
  let dropTargetSide = $state<"before" | "after" | null>(null);
  let unlistenNativeEvents: Array<() => void> = [];
  // 同一标签的保存操作串行执行，避免并发写入造成误报冲突
  const saveOperations = new WeakMap<ReaderTab, Promise<boolean>>();
  let markdownModulePromise: Promise<MarkdownModule> | undefined;

  $effect(() => {
    const container = tabStripContainerElement;
    const list = tabListElement;
    tabs.length;
    if (!container || !list) {
      hasTabOverflow = false;
      if (openMenu === "tabs") openMenu = null;
      return;
    }

    const updateOverflow = () => {
      const overflows = list.scrollWidth > container.clientWidth - 8;
      hasTabOverflow = overflows;
      if (!overflows && openMenu === "tabs") openMenu = null;
    };
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(container);
    observer.observe(list);
    void tick().then(updateOverflow);
    return () => observer.disconnect();
  });

  function loadMarkdownModule(): Promise<MarkdownModule> {
    if (markdownModulePromise) return markdownModulePromise;

    const loading = import("$lib/markdown");
    markdownModulePromise = loading;
    void loading.catch(() => {
      if (markdownModulePromise === loading) markdownModulePromise = undefined;
    });
    return loading;
  }

  async function renderMarkdown(
    source: string,
    loadImage: MarkdownImageLoader,
  ): Promise<RenderedDocument> {
    const markdown = await loadMarkdownModule();
    return markdown.renderMarkdown(source, loadImage);
  }

  function loadDocumentImage(documentPath: string): MarkdownImageLoader {
    return (source) => invoke<string>("read_local_image", { documentPath, source });
  }

  async function printActiveDocument() {
    const tab = activeTab;
    if (!tab || tab.loading || tab.error) return;
    openMenu = null;

    const source = sourceForTab(tab);
    let rendered = { html: tab.html, headings: tab.headings };
    if (
      tab.editing &&
      (source !== tab.renderedSource || pathKey(tab.path) !== pathKey(tab.renderedPath))
    ) {
      try {
        rendered = await renderMarkdown(source, loadDocumentImage(tab.path));
      } catch (error) {
        showNotice("准备打印失败：" + displayError(error, "请稍后重试。"));
        return;
      }
    }

    const currentTab = tabs.find((item) => item.id === tab.id);
    if (!currentTab || activeTabId !== tab.id || sourceForTab(currentTab) !== source) {
      showNotice("文档内容已变化，请重新打印。", true);
      return;
    }
    currentTab.html = rendered.html;
    currentTab.headings = rendered.headings;
    currentTab.renderedSource = source;
    currentTab.renderedPath = currentTab.path;
    tabs = [...tabs];
    await tick();
    if (activeTabId === tab.id) window.print();
  }

  async function exportActiveDocument() {
    const tab = activeTab;
    if (!tab || tab.loading || tab.error) return;
    openMenu = null;

    try {
      const source = sourceForTab(tab);
      const rendered = await renderMarkdown(source, loadDocumentImage(tab.path));
      const htmlExport = await import("$lib/html-export");
      const containsKatex = /class=["'][^"']*\bkatex\b/.test(rendered.html);
      const katexCss = containsKatex ? await htmlExport.loadKatexExportCss() : "";
      const html = htmlExport.buildStaticHtml({
        title: tab.name.replace(/\.(?:md|markdown)$/i, ""),
        bodyHtml: rendered.html,
        darkMode,
        fontSize,
        lineHeight,
        katexCss,
      });
      const defaultPath = tab.path
        ? tab.path.replace(/\.(?:md|markdown)$/i, ".html")
        : `${tab.name.replace(/\.(?:md|markdown)$/i, "")}.html`;
      const targetPath = await save({
        defaultPath,
        filters: [{ name: "HTML 文档", extensions: ["html"] }],
      });
      if (!targetPath) return;

      await invoke("write_export_html", { path: targetPath, content: html });
      showNotice("HTML 已导出");
    } catch (error) {
      showNotice("HTML 导出失败：" + displayError(error, "请检查文件夹访问权限和磁盘空间。"));
    }
  }

  function pathKey(path: string): string {
    let normalized = path.replaceAll("/", "\\").replace(/\\+$/, "");
    const extendedPrefix = "\\\\?\\";
    if (normalized.toLowerCase().startsWith(extendedPrefix)) {
      normalized = normalized.slice(extendedPrefix.length);
      if (/^unc\\/i.test(normalized)) normalized = "\\\\" + normalized.slice(4);
    }
    return normalized.toLowerCase();
  }

  function displayPath(path: string): string {
    const extendedPrefix = "\\\\?\\";
    if (!path.toLowerCase().startsWith(extendedPrefix)) return path;

    const standardPath = path.slice(extendedPrefix.length);
    if (/^unc[\\/]/i.test(standardPath)) return "\\\\" + standardPath.slice(4);
    if (/^[a-z]:[\\/]/i.test(standardPath)) return standardPath;
    return path;
  }

  function recentDirectoryLabel(file: RecentFile): string {
    const directorySegments = (path: string) => {
      const normalized = displayPath(path).replaceAll("/", "\\");
      const separatorIndex = normalized.lastIndexOf("\\");
      const directory = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized;
      return directory.split("\\").filter(Boolean);
    };
    const segments = directorySegments(file.path);
    const sameNameDirectories = recentFiles
      .filter(
        (item) =>
          item.name.toLowerCase() === file.name.toLowerCase() &&
          pathKey(item.path) !== pathKey(file.path),
      )
      .map((item) => directorySegments(item.path));

    let visibleSegments = Math.min(2, segments.length);
    while (
      visibleSegments < segments.length &&
      sameNameDirectories.some((other) =>
        other.slice(-visibleSegments).join("\\").toLowerCase() ===
        segments.slice(-visibleSegments).join("\\").toLowerCase(),
      )
    ) {
      visibleSegments += 1;
    }

    const suffix = segments.slice(-visibleSegments).join("\\");
    return visibleSegments < segments.length ? "…\\" + suffix : suffix;
  }

  function tabDirectoryHint(tab: ReaderTab): string | null {
    if (!tab.path) return null;

    const directorySegments = (path: string) => {
      const normalized = displayPath(path).replaceAll("/", "\\");
      const separatorIndex = normalized.lastIndexOf("\\");
      if (separatorIndex < 0) return [];
      return normalized.slice(0, separatorIndex).split("\\").filter(Boolean);
    };
    const segments = directorySegments(tab.path);
    const sameNameDirectories = tabs
      .filter(
        (other) =>
          other.id !== tab.id &&
          !!other.path &&
          other.name.toLowerCase() === tab.name.toLowerCase() &&
          pathKey(other.path) !== pathKey(tab.path!),
      )
      .map((other) => directorySegments(other.path));

    if (sameNameDirectories.length === 0) return null;

    for (let depth = 1; depth <= segments.length; depth += 1) {
      const segment = segments[segments.length - depth];
      const isUnique = sameNameDirectories.every(
        (other) =>
          other.length < depth ||
          other[other.length - depth].toLowerCase() !== segment.toLowerCase(),
      );
      if (isUnique) return segment;
    }

    return segments.at(-1) ?? null;
  }

  function nameFromPath(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) || "Markdown 文档";
  }

  function scrollBehavior(): ScrollBehavior {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
  }

  function scheduleNoticeDismissal() {
    if (!notice || noticePersistent || noticePointerInside || noticeFocusInside || noticeTimer) return;
    noticeDeadline = performance.now() + noticeRemainingMs;
    noticeTimer = setTimeout(() => {
      notice = "";
      noticeTimer = undefined;
      noticeRemainingMs = 3000;
      noticeDeadline = 0;
    }, noticeRemainingMs);
  }

  function pauseNoticeDismissal() {
    if (!noticeTimer) return;
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
    noticeRemainingMs = Math.max(0, noticeDeadline - performance.now());
    noticeDeadline = 0;
  }

  function resumeNoticeDismissal() {
    if (noticePointerInside || noticeFocusInside) return;
    scheduleNoticeDismissal();
  }

  function handleNoticePointerEnter() {
    noticePointerInside = true;
    pauseNoticeDismissal();
  }

  function handleNoticePointerLeave() {
    noticePointerInside = false;
    resumeNoticeDismissal();
  }

  function handleNoticeFocusIn() {
    noticeFocusInside = true;
    pauseNoticeDismissal();
  }

  function handleNoticeFocusOut(event: FocusEvent) {
    const noticeElement = event.currentTarget as HTMLElement;
    const nextTarget = event.relatedTarget;
    noticeFocusInside = nextTarget instanceof Node && noticeElement.contains(nextTarget);
    resumeNoticeDismissal();
  }

  function showNotice(message: string, persistent = /(?:失败|无法|冲突|未能|不能)/.test(message)) {
    notice = message;
    noticePersistent = persistent;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    noticeRemainingMs = 3000;
    noticeDeadline = 0;
    scheduleNoticeDismissal();
  }

  function dismissNotice(shouldRestoreFocus = true) {
    const restoreFocus =
      shouldRestoreFocus &&
      document.activeElement instanceof Element &&
      !!document.activeElement.closest(".notice");
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    noticeRemainingMs = 3000;
    noticeDeadline = 0;
    noticePointerInside = false;
    noticeFocusInside = false;
    notice = "";
    noticePersistent = false;
    if (restoreFocus) restoreWorkspaceFocus();
  }

  function focusToolbarEntry() {
    const entry =
      document.querySelector<HTMLButtonElement>('[data-menu-trigger="file"]') ??
      document.querySelector<HTMLButtonElement>(".settings-toggle");
    entry?.focus();
  }

  function focusConfirmation(): boolean {
    if ((!pendingConfirmation && !pendingCloseIds.length) || !confirmationDialog) return false;
    const selector = pendingConfirmation ? "[data-cancel-confirm]:enabled" : "[data-cancel-close]:enabled";
    const target = confirmationDialog.querySelector<HTMLButtonElement>(selector) ?? confirmationDialog;
    target.focus({ preventScroll: true });
    return true;
  }

  /** 弹层关闭后把键盘焦点交还给可用的入口 */
  function restoreWorkspaceFocus(trigger: HTMLElement | null = null) {
    void tick().then(() => {
      if (focusConfirmation()) return;
      if (zoomedImage) {
        imageZoomClose?.focus({ preventScroll: true });
      } else if (trigger?.isConnected && trigger !== document.body && !trigger.matches(":disabled") && !trigger.closest("[inert]")) {
        trigger.focus({ preventScroll: true });
      } else if (settingsOpen) {
        focusSettingsCategory();
      } else if (activeTab) {
        tabStripElement?.querySelector<HTMLElement>(".tab-shell.selected .tab-button")?.focus({ preventScroll: true });
      } else {
        focusToolbarEntry();
      }
    });
  }

  function displayError(error: unknown, fallback: string) {
    return typeof error === "string" && error.trim() ? error : fallback;
  }

  function saveRecentFiles(): boolean {
    try {
      localStorage.setItem(recentStorageKey, JSON.stringify(recentFiles));
      return true;
    } catch {
      showNotice("无法保存最近打开记录");
      return false;
    }
  }

  function rememberFile(path: string, name: string) {
    const key = pathKey(path);
    recentFiles = [
      { path, name, openedAt: Date.now() },
      ...recentFiles.filter((file) => pathKey(file.path) !== key),
    ].slice(0, maxRecentFiles);
    saveRecentFiles();
  }

  function clearRecentFiles() {
    recentFiles = [];
    hoveredRecentPath = null;
    focusedRecentPath = null;
    const saved = saveRecentFiles();
    openMenu = null;
    if (saved) showNotice("已清空最近记录");
    void tick().then(focusToolbarEntry);
  }

  function isRecentRemoveVisible(path: string): boolean {
    return !pointerCanHover || hoveredRecentPath === path || focusedRecentPath === path;
  }

  function clearRecentRowFocus(path: string, event: FocusEvent) {
    const row = event.currentTarget as HTMLElement;
    if (!row.contains(event.relatedTarget as Node | null) && focusedRecentPath === path) {
      focusedRecentPath = null;
    }
  }

  function removeRecentFile(path: string, index: number) {
    const key = pathKey(path);
    recentFiles = recentFiles.filter((file) => pathKey(file.path) !== key);
    hoveredRecentPath = null;
    focusedRecentPath = null;
    const saved = saveRecentFiles();
    if (saved) showNotice("已从最近记录移除");

    const nextIndex = Math.min(index, recentFiles.length - 1);
    void tick().then(() => {
      if (nextIndex >= 0 && (openMenu === "file" || openMenu === "recent")) {
        document
          .querySelector<HTMLButtonElement>(`.dropdown-menu [data-recent-open-index="${nextIndex}"]`)
          ?.focus();
        return;
      }

      if (openMenu === "file") {
        document
          .querySelector<HTMLElement>(
            ".dropdown-menu [role^='menuitem']:not([disabled]):not([aria-hidden='true'])",
          )
          ?.focus();
        return;
      }

      if (openMenu === "recent") openMenu = null;
      focusToolbarEntry();
    });
  }

  function restorePreferences() {
    outlineWidth = defaultOutlineWidth;
    try {
      const stored = localStorage.getItem(preferenceStorageKey);
      if (!stored) return;
      const preferences = JSON.parse(stored) as {
        darkMode?: boolean;
        tocVisible?: boolean;
        fontSize?: number;
        lineHeight?: number;
        restoreLastSession?: boolean;
        defaultOpenDirectory?: string;
        editorWordWrap?: boolean;
        editorIndentWidth?: number;
        outlineWidth?: number;
      };
      darkMode = typeof preferences.darkMode === "boolean" ? preferences.darkMode : false;
      tocVisible =
        typeof preferences.tocVisible === "boolean" ? preferences.tocVisible : defaultTocVisible;
      const savedOutlineWidth = preferences.outlineWidth;
      outlineWidth =
        typeof savedOutlineWidth === "number" && Number.isFinite(savedOutlineWidth)
          ? Math.min(maxOutlineWidth, Math.max(minOutlineWidth, savedOutlineWidth))
          : defaultOutlineWidth;
      const savedFontSize = preferences.fontSize;
      fontSize =
        typeof savedFontSize === "number" && Number.isFinite(savedFontSize)
          ? Math.min(maxFontSize, Math.max(minFontSize, savedFontSize))
          : defaultFontSize;
      const savedLineHeight = preferences.lineHeight;
      lineHeight = lineHeightOptions.includes(savedLineHeight as (typeof lineHeightOptions)[number])
        ? (savedLineHeight as (typeof lineHeightOptions)[number])
        : defaultLineHeight;
      restoreLastSession =
        typeof preferences.restoreLastSession === "boolean" ? preferences.restoreLastSession : true;
      defaultOpenDirectory =
        typeof preferences.defaultOpenDirectory === "string" ? preferences.defaultOpenDirectory : "";
      editorWordWrap =
        typeof preferences.editorWordWrap === "boolean" ? preferences.editorWordWrap : true;
      const savedIndentWidth = preferences.editorIndentWidth;
      editorIndentWidth =
        typeof savedIndentWidth === "number" &&
        editorIndentWidths.some((width) => width === savedIndentWidth)
          ? savedIndentWidth
          : defaultEditorIndentWidth;
    } catch {
      try {
        localStorage.removeItem(preferenceStorageKey);
      } catch {
        // 存储不可用时继续使用默认设置
      }
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(
        preferenceStorageKey,
        JSON.stringify({
          darkMode,
          tocVisible,
          outlineWidth,
          fontSize,
          lineHeight,
          restoreLastSession,
          defaultOpenDirectory,
          editorWordWrap,
          editorIndentWidth,
        }),
      );
    } catch {
      showNotice("无法保存阅读设置");
    }
  }

  function lineEndingOf(source: string): string {
    let crlf = 0;
    let lf = 0;
    let cr = 0;
    for (let index = 0; index < source.length; index += 1) {
      const character = source.charCodeAt(index);
      if (character === 13) {
        if (source.charCodeAt(index + 1) === 10) {
          crlf += 1;
          index += 1;
        } else {
          cr += 1;
        }
      } else if (character === 10) {
        lf += 1;
      }
    }
    if (crlf >= lf && crlf >= cr && crlf > 0) return "\r\n";
    if (cr > lf && cr > 0) return "\r";
    return "\n";
  }

  function isDirty(tab: ReaderTab | null | undefined): boolean {
    if (!tab) return false;
    if (!tab.path) return sourceForTab(tab) !== tab.savedSource;
    if (tab.editorState && tab.savedEditorDoc) {
      return !tab.editorState.doc.eq(tab.savedEditorDoc);
    }
    return tab.source !== tab.savedSource;
  }

  function sourceForTab(tab: ReaderTab): string {
    const source = tab.editorState?.doc.toString();
    if (source === undefined || tab.lineEnding === "\n") return source ?? tab.source;
    return source.replace(/\n/g, tab.lineEnding);
  }

  function sameVersion(left: FileVersion | null, right: FileVersion | null): boolean {
    return !!left && !!right && left.size === right.size && left.modifiedNs === right.modifiedNs;
  }

  function isFileVersionConflict(message: string): boolean {
    return message.includes("文件已被删除或移动") || message.includes("其他程序");
  }

  function showWriteConflict(tab: ReaderTab, targetPath: string, message: string) {
    if (pathKey(targetPath) !== pathKey(tab.path)) {
      showNotice("另存为目标文件已变化，未覆盖。请重新选择位置后重试。", true);
    } else if (message.includes("删除或移动")) {
      tab.externalChange = "missing";
      showNotice("原文件已移动或删除，未覆盖。请另存为。", true);
    } else {
      tab.externalChange = "modified";
      showNotice("文件已被外部修改，未覆盖。请重新载入或另存为。", true);
    }
  }

  function persistSession() {
    try {
      const current = tabs.filter((tab) => !!tab.path).map((tab) => ({
        path: tab.path,
        scrollTop: Math.max(0, tab.scrollTop),
      }));
      localStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          tabs: current,
          activePath: tabs.find((tab) => tab.id === activeTabId && tab.path)?.path ?? null,
        } satisfies ReaderSession),
      );
    } catch {
      showNotice("无法保存阅读会话");
    }
  }

  function persistDraftRecovery(openTabs: ReaderTab[] = tabs) {
    const drafts = openTabs.flatMap((tab): DraftRecoveryRecord[] => {
      if (tab.path || tab.loading || tab.error) return [];
      const source = sourceForTab(tab);
      if (!source) return [];
      return [{
        name: tab.name,
        source,
        cursor: tab.cursor,
        editorScrollProgress: tab.editorScrollProgress,
        lineEnding: tab.lineEnding,
        updatedAt: tab.draftUpdatedAt || Date.now(),
      }];
    });

    try {
      if (drafts.length) {
        localStorage.setItem(draftRecoveryStorageKey, JSON.stringify(drafts));
      } else {
        localStorage.removeItem(draftRecoveryStorageKey);
      }
    } catch {
      showNotice("未命名文档暂存失败，建议另存为。");
    }
  }

  function scheduleDraftRecovery() {
    if (draftRecoveryTimer) clearTimeout(draftRecoveryTimer);
    draftRecoveryTimer = setTimeout(() => {
      draftRecoveryTimer = undefined;
      persistDraftRecovery();
    }, 800);
  }

  async function restoreDraftRecovery() {
    let records: DraftRecoveryRecord[] = [];
    try {
      const stored = localStorage.getItem(draftRecoveryStorageKey);
      if (!stored) return;
      const value: unknown = JSON.parse(stored);
      if (Array.isArray(value)) {
        records = value.filter(
          (record): record is DraftRecoveryRecord =>
            typeof record?.name === "string" &&
            typeof record?.source === "string" &&
            !!record.source &&
            typeof record?.cursor === "number" &&
            Number.isFinite(record.cursor) &&
            typeof record?.editorScrollProgress === "number" &&
            Number.isFinite(record.editorScrollProgress) &&
            typeof record?.lineEnding === "string" &&
            typeof record?.updatedAt === "number" &&
            Number.isFinite(record.updatedAt),
        );
      }
    } catch {
      try {
        localStorage.removeItem(draftRecoveryStorageKey);
      } catch {
        // 本地存储不可用时跳过草稿恢复
      }
      return;
    }

    if (!records.length) {
      try {
        localStorage.removeItem(draftRecoveryStorageKey);
      } catch {
        // 本地存储不可用时继续启动
      }
      return;
    }

    const restoredTabs = records
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map((record) => {
        const tab = createLoadingTab("", 0, true, false);
        tab.id = `recovered:${crypto.randomUUID()}`;
        tab.name = record.name || "未命名.md";
        tab.source = record.source;
        tab.savedSource = "";
        tab.editing = true;
        tab.cursor = Math.min(record.source.length, Math.max(0, Math.trunc(record.cursor)));
        tab.editorScrollProgress = Math.min(1, Math.max(0, record.editorScrollProgress));
        tab.lineEnding = ["\n", "\r\n", "\r"].includes(record.lineEnding)
          ? record.lineEnding
          : "\n";
        tab.draftUpdatedAt = record.updatedAt;
        return tab;
      });
    tabs = [...tabs, ...restoredTabs];
    if (!activeTabId) activeTabId = restoredTabs.at(-1)?.id ?? null;

    try {
      const markdown = await loadMarkdownModule();
      await Promise.all(restoredTabs.map(async ({ editorInstanceId }) => {
        const tab = tabs.find((candidate) => candidate.editorInstanceId === editorInstanceId);
        if (!tab) return;
        const source = sourceForTab(tab);
        const path = tab.path;
        const rendered = await markdown.renderMarkdown(source, loadDocumentImage(path));
        if (!tabs.includes(tab) || tab.path !== path || sourceForTab(tab) !== source) return;
        tab.html = rendered.html;
        tab.headings = rendered.headings;
        tab.renderedSource = source;
        tab.renderedPath = path;
      }));
      showNotice(`已恢复 ${restoredTabs.length} 份未保存文档`);
    } catch {
      showNotice("未保存文档已恢复，阅读内容暂时无法生成。");
    }
  }

  function scheduleSessionSave() {
    if (restoringSession) return;
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(persistSession, 250);
  }

  async function restoreSession() {
    let session: ReaderSession | null = null;
    try {
      const stored = localStorage.getItem(sessionStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ReaderSession>;
        if (Array.isArray(parsed.tabs)) {
          const seen = new Set<string>();
          session = {
            tabs: parsed.tabs
              .filter(
                (tab): tab is SessionTab =>
                  typeof tab?.path === "string" &&
                  typeof tab?.scrollTop === "number" &&
                  Number.isFinite(tab.scrollTop),
              )
              .filter((tab) => {
                const key = pathKey(tab.path);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              })
              .map((tab) => ({ path: tab.path, scrollTop: Math.max(0, tab.scrollTop) })),
            activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
          };
        }
      }
    } catch {
      try {
        localStorage.removeItem(sessionStorageKey);
      } catch {
        // 存储不可用时跳过会话恢复
      }
    }

    if (!session?.tabs.length) return;
    const activeSessionTab = session.activePath
      ? session.tabs.find((tab) => pathKey(tab.path) === pathKey(session.activePath!))
      : undefined;
    const firstTab = activeSessionTab ?? session.tabs.at(-1);
    if (!firstTab) return;

    restoringSession = true;
    try {
      for (const tab of session.tabs) {
        if (tabs.some((current) => pathKey(current.path) === pathKey(tab.path))) continue;
        tabs = [...tabs, createLoadingTab(tab.path, tab.scrollTop, false, false)];
      }

      await openPath(firstTab.path, { restoredScrollTop: firstTab.scrollTop });
    } finally {
      restoringSession = false;
      persistSession();
    }
  }

  async function restoreStartupFiles() {
    try {
      const startupFiles = await invoke<string[]>("startup_markdown_files");
      if (startupFiles.length) {
        void openFiles(startupFiles);
        return;
      }
    } catch {
      // 浏览器预览中没有 Tauri 启动参数
    }

    if (restoreLastSession) void restoreSession();
  }

  $effect(() => {
    if (startupOpenReady && !documentInteractionBlocked && (nativeOpenSignaled || forwardedPaths.length)) {
      void untrack(openPendingMarkdownFiles);
    }
  });

  onMount(() => {
    let disposed = false;
    pointerCanHover = window.matchMedia("(hover: hover)").matches;
    const handleWindowFocus = () => {
      windowFocused = true;
    };
    const handleWindowBlur = () => {
      windowFocused = false;
    };
    windowFocused = document.hasFocus();
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);

    try {
      const stored = localStorage.getItem(recentStorageKey);
      if (stored) {
        const value = JSON.parse(stored);
        if (Array.isArray(value)) {
          recentFiles = value
            .filter(
              (item): item is RecentFile =>
                typeof item?.path === "string" && typeof item?.name === "string",
            )
            .slice(0, maxRecentFiles);
        }
      }
    } catch {
      try {
        localStorage.removeItem(recentStorageKey);
      } catch {
        // 存储不可用时跳过最近文件恢复
      }
    }

    restorePreferences();
    if (isTauri()) void getVersion().then((version) => (appVersion = version)).catch(() => {});
    void restoreDraftRecovery();
    if (isTauri()) {
      void listen("single-instance-open-files", () => {
        nativeOpenSignaled = true;
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenNativeEvents.push(unlisten);
          nativeOpenSignaled = true;
        })
        .catch(() => {
          if (!disposed) showNotice("无法接收再次打开的文件，请重启应用。");
        });
    }
    void restoreStartupFiles().finally(() => {
      if (!disposed && isTauri()) startupOpenReady = true;
    });
    if (isTauri()) {
      const currentWindow = getCurrentWindow();
      void syncMaximizedState();
      void currentWindow
        .onResized(() => void syncMaximizedState())
        .then((unlisten) => unlistenNativeEvents.push(unlisten))
        .catch(() => {});
      void currentWindow.onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          draggingFiles = event.payload.paths.some((path) => /\.(?:md|markdown)$/i.test(path));
          return;
        }
        if (event.payload.type === "leave") {
          draggingFiles = false;
          return;
        }
        if (event.payload.type !== "drop") return;
        draggingFiles = false;
        if (documentInteractionBlocked) return;
        const markdownPaths = event.payload.paths.filter((path) => /\.(?:md|markdown)$/i.test(path));
        if (markdownPaths.length < event.payload.paths.length) {
          showNotice("仅支持拖放 .md 和 .markdown 文件");
        }
        if (markdownPaths.length) void openFiles(markdownPaths);
      }).then((unlisten) => unlistenNativeEvents.push(unlisten));
      void currentWindow.onCloseRequested(async (event) => {
        if (allowConfirmedWindowClose) {
          allowConfirmedWindowClose = false;
          return;
        }
        if (windowClosePending) {
          event.preventDefault();
          return;
        }
        if (pendingConfirmation) {
          event.preventDefault();
          resolveActionConfirmation(false);
          return;
        }
        if (pendingCloseIds.length || closeSaveInProgress) {
          event.preventDefault();
          return;
        }
        windowClosePending = true;
        try {
          const saved = await waitForPendingSaves(() => tabs);
          if (!saved || pendingConfirmation || pendingCloseIds.length) {
            event.preventDefault();
            return;
          }
          editorComponent?.commitTableCell();
          persistSession();
          persistDraftRecovery();
          const dirtyIds = tabs.filter(isDirty).map((tab) => tab.id);
          if (!dirtyIds.length) return;
          event.preventDefault();
          showClosePrompt(dirtyIds, true);
        } finally {
          windowClosePending = false;
        }
      }).then((unlisten) => unlistenNativeEvents.push(unlisten));
      externalCheckTimer = setInterval(() => void checkOpenFiles(), 2500);
    }

    const handleSaveAsKeydownCapture = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || !event.shiftKey || event.key.toLocaleLowerCase() !== "s") return;
      event.preventDefault();
      if (!settingsOpen && !documentInteractionBlocked) {
        void saveActiveTab(true);
      }
    };

    const isTextEntryTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
      if (!(target instanceof HTMLInputElement)) return false;
      return ![
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ].includes(target.type);
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLocaleLowerCase();

      if (event.key === "Escape") {
        if (zoomedImage) {
          closeImagePreview();
        } else if (pendingConfirmation) {
          event.preventDefault();
          resolveActionConfirmation(false);
        } else if (pendingCloseIds.length) {
          event.preventDefault();
          cancelPendingClose();
        } else if (tabContextMenu) {
          event.preventDefault();
          closeTabContextMenu();
        } else if (searchOpen) {
          closeSearch();
        } else if (settingsOpen) {
          closeSettings();
        } else {
          openMenu = null;
        }
        return;
      }

      if (modifier && key === "a") {
        if (
          isTextEntryTarget(event.target) ||
          settingsOpen ||
          documentInteractionBlocked ||
          tabContextMenu ||
          openMenu ||
          !activeTab ||
          activeTab.editing ||
          activeTab.loading ||
          activeTab.error ||
          !readerContent
        ) return;

        const selection = window.getSelection();
        if (!selection) return;
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(readerContent);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }

      if (settingsOpen) {
        if (modifier && key === "w") {
          event.preventDefault();
          closeSettings();
        }
        return;
      }

      if (documentInteractionBlocked) return;

      if (modifier && key === "p") {
        event.preventDefault();
        if (!pendingCloseIds.length) void printActiveDocument();
        return;
      }

      if (!modifier) return;
      if (key === "o") {
        event.preventDefault();
        void openFiles();
      } else if (key === "n") {
        event.preventDefault();
        void createMarkdownDocument();
      } else if (key === "w") {
        event.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) void saveActiveTab(true);
        else void saveActiveTab();
      } else if (key === "f") {
        event.preventDefault();
        if (activeTab?.editing) editorComponent?.openSearch();
        else void showSearch();
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        changeFontSize(1);
      } else if (key === "-") {
        event.preventDefault();
        changeFontSize(-1);
      } else if (key === "0") {
        event.preventDefault();
        resetReadingFontSize();
      } else if (key === "tab") {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      }
    };

    window.addEventListener("keydown", handleSaveAsKeydownCapture, true);
    window.addEventListener("keydown", handleKeydown);
    return () => {
      disposed = true;
      startupOpenReady = false;
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleSaveAsKeydownCapture, true);
      window.removeEventListener("keydown", handleKeydown);
      for (const timer of editorOutlineTimers.values()) clearTimeout(timer);
      editorOutlineTimers.clear();
      if (noticeTimer) clearTimeout(noticeTimer);
      if (themeSwitchTimer) clearTimeout(themeSwitchTimer);
      if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
      if (draftRecoveryTimer) clearTimeout(draftRecoveryTimer);
      if (externalCheckTimer) clearInterval(externalCheckTimer);
      for (const unlisten of unlistenNativeEvents) unlisten();
    };
  });

  function toggleOutlinePanel() {
    tocVisible = !tocVisible;
    savePreferences();
  }

  async function createMarkdownDocument() {
    openMenu = null;
    settingsOpen = false;
    closeSearch();

    let name = "未命名.md";
    let ordinal = 2;
    while (tabs.some((tab) => tab.name === name)) {
      name = `未命名 ${ordinal}.md`;
      ordinal += 1;
    }

    const tab = createLoadingTab("", 0, true, false);
    tab.id = `untitled:${crypto.randomUUID()}`;
    tab.name = name;
    tab.editing = true;
    tabs = [...tabs, tab];
    activeTabId = tab.id;
    activeHeadingId = null;
    scheduleSessionSave();

    await tick();
    if (activeTabId === tab.id) editorComponent?.focusEditor();
  }

  /** 串行读取原生队列，确认期间保留已经读到的路径 */
  async function openPendingMarkdownFiles() {
    if (drainingNativeOpenRequests) return;
    drainingNativeOpenRequests = true;
    try {
      while (startupOpenReady && !documentInteractionBlocked) {
        if (forwardedPaths.length) {
          const paths = forwardedPaths;
          forwardedPaths = [];
          void openFiles(paths);
        }
        if (!nativeOpenSignaled) return;

        nativeOpenSignaled = false;
        try {
          const paths = await invoke<string[]>("take_pending_markdown_files");
          if (startupOpenReady) forwardedPaths = paths;
        } catch {
          if (startupOpenReady) showNotice("无法接收再次打开的文件，请重试。");
        }
      }
    } finally {
      drainingNativeOpenRequests = false;
    }
  }

  async function openFiles(paths?: string[]) {
    editorComponent?.commitTableCell();
    openMenu = null;
    try {
      const selection =
        paths ??
        (await open({
          multiple: true,
          defaultPath: defaultOpenDirectory || undefined,
          filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        }));
      if (!selection) return;
      const selectedPaths = Array.isArray(selection) ? selection : [selection];
      if (!selectedPaths.length) return;
      settingsOpen = false;
      await Promise.all(selectedPaths.map((path, index) =>
        openPath(path, { activateOnOpen: index === selectedPaths.length - 1 }),
      ));
    } catch {
      showNotice("文件选择失败，请重试。");
    }
  }

  /** 将通过不同路径打开的同一文件汇合到已有标签 */
  function mergeDuplicateTab(request: ReaderTab, canonicalId: string): boolean {
    const duplicate = tabs.find((tab) => tab.id === canonicalId && tab !== request);
    if (!duplicate) return false;

    const wasSelected = activeTabId === request.id;
    tabs = tabs.filter((tab) => tab !== request);
    if (wasSelected) {
      duplicate.pendingFragment = request.pendingFragment ?? duplicate.pendingFragment;
      if (duplicate.error) void openPath(duplicate.path);
      else void activateTab(duplicate.id);
    } else {
      scheduleSessionSave();
    }
    return true;
  }

  async function openPath(
    path: string,
    { fragment, restoredScrollTop = 0, forceReload = false, activateOnOpen = true }: {
      fragment?: string;
      restoredScrollTop?: number;
      forceReload?: boolean;
      activateOnOpen?: boolean;
    } = {},
  ) {
    if (activateOnOpen) settingsOpen = false;
    const initialId = pathKey(path);
    const existing = tabs.find((tab) => tab.id === initialId || pathKey(tab.path) === initialId);

    if (existing?.loadStarted && (existing.loading || (!forceReload && !existing.error))) {
      if (fragment) existing.pendingFragment = fragment;
      if (activateOnOpen) await activateTab(existing.id);
      return;
    }

    const loadTabId = existing?.id ?? initialId;
    const loadRequestId = crypto.randomUUID();
    const savedScrollTop = existing?.scrollTop ?? restoredScrollTop;
    const reloadWasEditing = forceReload && !!existing?.editing;
    const savedEditorScrollTop = existing?.editorScrollTop ?? 0;
    const savedEditorScrollProgress = existing?.editorScrollProgress ?? 0;
    const savedCursor = existing?.cursor ?? 0;
    if (existing) {
      existing.loadRequestId = loadRequestId;
      existing.loading = true;
      existing.loadStarted = true;
      existing.error = null;
      existing.externalChange = null;
      existing.editing = false;
      if (fragment) existing.pendingFragment = fragment;
    } else {
      const loadingTab = createLoadingTab(path, restoredScrollTop, true);
      loadingTab.loadRequestId = loadRequestId;
      loadingTab.pendingFragment = fragment;
      tabs = [...tabs, loadingTab];
      scheduleSessionSave();
    }
    if (activateOnOpen) activeTabId = loadTabId;
    openMenu = null;

    try {
      const [document, markdown] = await Promise.all([
        invoke<MarkdownDocument>("read_markdown", { path }),
        loadMarkdownModule(),
      ]);
      const canonicalId = pathKey(document.path);
      const request = tabs.find(
        (tab) => tab.id === loadTabId && tab.loadRequestId === loadRequestId,
      );
      if (!request || mergeDuplicateTab(request, canonicalId)) return;

      const rendered = await markdown.renderMarkdown(
        document.content,
        loadDocumentImage(document.path),
      );
      const currentRequest = tabs.find(
        (tab) => tab.id === loadTabId && tab.loadRequestId === loadRequestId,
      );
      if (!currentRequest || mergeDuplicateTab(currentRequest, canonicalId)) return;
      const shouldActivate = activeTabId === loadTabId;
      const editorInstanceId = crypto.randomUUID();

      tabs = tabs.map((tab) =>
        tab === currentRequest
          ? {
              ...tab,
              id: canonicalId,
              editorInstanceId,
              editorState: null,
              editorCompartments: null,
              savedEditorDoc: null,
              path: document.path,
              name: document.name,
              source: document.content,
              savedSource: document.content,
              renderedSource: document.content,
              renderedPath: document.path,
              html: rendered.html,
              headings: rendered.headings,
              scrollTop: savedScrollTop,
              editorScrollTop: forceReload ? savedEditorScrollTop : 0,
              editorScrollProgress: forceReload ? savedEditorScrollProgress : 0,
              cursor: forceReload ? savedCursor : 0,
              encoding: document.encoding,
              lineEnding: lineEndingOf(document.content),
              version: document.version,
              externalChange: null,
              editing: reloadWasEditing,
              loadRequestId: null,
              loading: false,
              error: null,
            }
          : tab,
      );
      if (shouldActivate) {
        activeTabId = canonicalId;
        activeHeadingId = rendered.headings[0]?.id ?? null;
      }
      rememberFile(document.path, document.name);
      const loadedTab = tabs.find(
        (tab) => tab.id === canonicalId && tab.editorInstanceId === editorInstanceId,
      );
      if (shouldActivate && loadedTab) await restoreActiveTabLocation(loadedTab);
      scheduleSessionSave();
    } catch (error) {
      const message = displayError(error, "无法显示这篇文档，请重试。");
      const failedRequest = tabs.find(
        (tab) => tab.id === loadTabId && tab.loadRequestId === loadRequestId,
      );
      if (!failedRequest) return;
      if (forceReload && existing) {
        failedRequest.loading = false;
        failedRequest.loadRequestId = null;
        failedRequest.editing = reloadWasEditing;
        if (failedRequest.version) {
          const failedPath = failedRequest.path;
          const failedEditorInstanceId = failedRequest.editorInstanceId;
          await checkTabForExternalChange(failedRequest);
          const currentFailedRequest = tabs.find(
            (tab) =>
              tab.editorInstanceId === failedEditorInstanceId && tab.path === failedPath,
          );
          if (currentFailedRequest) {
            if (!currentFailedRequest.loadRequestId && !currentFailedRequest.externalChange) {
              currentFailedRequest.externalChange = "modified";
            }
            showNotice("重新载入失败，当前文档内容仍保留在窗口中。");
          }
        } else {
          failedRequest.error = message;
          failedRequest.externalChange = null;
          if (activeTabId !== failedRequest.id) {
            showNotice("无法打开文件，请检查文件是否存在且可读取。");
          }
        }
      } else {
        tabs = tabs.map((tab) =>
          tab.id === loadTabId && tab.loadRequestId === loadRequestId
            ? { ...tab, loadRequestId: null, loading: false, error: message }
            : tab,
        );
        if (activeTabId !== loadTabId) {
          showNotice("无法打开文件，请检查文件是否存在且可读取。");
        }
      }
      scheduleSessionSave();
    }
  }

  /** 正文挂载后恢复活动标签的阅读位置，并处理待跳转的锚点 */
  async function restoreActiveTabLocation(tab: ReaderTab) {
    await tick();
    if (activeTab !== tab || tab.loading || tab.error) return;

    if (readerViewport && !tab.editing) readerViewport.scrollTop = tab.scrollTop;
    if (tab.pendingFragment) {
      const fragment = tab.pendingFragment;
      tab.pendingFragment = undefined;
      await jumpToAnchor(fragment, tab.id);
    }
    if (activeTab === tab && !tab.editing) syncActiveHeading();
  }

  async function activateTab(id: string) {
    const selected = tabs.find((tab) => tab.id === id);
    if (!selected) return;

    if (activeTabId !== id) editorComponent?.commitTableCell();
    settingsOpen = false;
    if (selected.editing && searchOpen) closeSearch();
    if (activeTabId !== id) activeHeadingId = null;
    activeTabId = id;
    openMenu = null;
    tabContextMenu = null;
    scheduleSessionSave();
    if (!selected.loadStarted && !selected.error) {
      void openPath(selected.path, { activateOnOpen: false });
      return;
    }
    await restoreActiveTabLocation(selected);
    if (activeTab === selected && !selected.loading && !selected.error) {
      void checkTabForExternalChange(selected);
    }
  }

  function closeTab(id: string) {
    void requestCloseTabs([id]);
  }

  function createLoadingTab(
    path: string,
    scrollTop: number,
    loadStarted: boolean,
    loading = true,
  ): ReaderTab {
    return {
      id: pathKey(path),
      editorInstanceId: crypto.randomUUID(),
      editorState: null,
      editorCompartments: null,
      savedEditorDoc: null,
      path,
      name: nameFromPath(path),
      source: "",
      savedSource: "",
      renderedSource: "",
      renderedPath: "",
      html: "",
      headings: [],
      scrollTop,
      editorScrollTop: 0,
      editorScrollProgress: 0,
      draftUpdatedAt: 0,
      cursor: 0,
      encoding: "utf-8",
      lineEnding: "\n",
      version: null,
      externalChange: null,
      editing: false,
      renderGeneration: 0,
      loadRequestId: null,
      loading,
      loadStarted,
      error: null,
    };
  }

  async function waitForPendingSaves(closingTabs: () => ReaderTab[]): Promise<boolean> {
    while (true) {
      const pending = closingTabs()
        .map((tab) => saveOperations.get(tab))
        .filter((operation): operation is Promise<boolean> => operation !== undefined);
      if (!pending.length) return true;
      const results = await Promise.allSettled(pending);
      if (results.some((result) => result.status === "rejected" || !result.value)) return false;
    }
  }

  async function requestCloseTabs(ids: string[]) {
    if (windowClosePending || documentInteractionBlocked) return;
    const requestedTabs = tabs.filter((tab) => ids.includes(tab.id));
    const closingTabs = () => requestedTabs.filter((tab) => tabs.includes(tab));
    const saved = await waitForPendingSaves(closingTabs);
    if (!saved || windowClosePending || documentInteractionBlocked) return;
    const closing = closingTabs();
    if (!closing.length) return;
    if (activeTab && closing.includes(activeTab)) editorComponent?.commitTableCell();
    const closingIds = closing.map((tab) => tab.id);
    if (closing.some(isDirty)) {
      showClosePrompt(closingIds, false);
      return;
    }
    performCloseTabs(closingIds);
  }

  function requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
    if (pendingConfirmation || confirmationResolver) return Promise.resolve(false);
    confirmationReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingConfirmation = request;
    const result = new Promise<boolean>((resolve) => {
      confirmationResolver = resolve;
    });
    void tick().then(focusConfirmation);
    return result;
  }

  function resolveActionConfirmation(confirmed: boolean) {
    const resolve = confirmationResolver;
    if (!resolve) return;
    confirmationResolver = undefined;
    pendingConfirmation = null;
    const returnFocus = confirmationReturnFocus;
    confirmationReturnFocus = null;
    resolve(confirmed);
    restoreWorkspaceFocus(returnFocus);
  }

  function showClosePrompt(ids: string[], closeWindowAfter: boolean) {
    closePromptGeneration += 1;
    closePromptReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingCloseIds = ids;
    closeAfterConfirmation = closeWindowAfter;
    void tick().then(focusConfirmation);
  }

  function handleConfirmDialogKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget as HTMLElement;
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    if (!buttons.length) {
      event.preventDefault();
      return;
    }
    const first = buttons[0];
    const last = buttons.at(-1)!;
    if (document.activeElement === dialog) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function resolvePendingClose(action: "save" | "discard") {
    if (closeSaveInProgress) return;
    const promptGeneration = closePromptGeneration;
    let closing = [...pendingCloseIds];
    const shouldCloseWindow = closeAfterConfirmation;
    closeSaveInProgress = true;
    void tick().then(focusConfirmation);
    try {
      if (action === "discard") {
        while (true) {
          const pendingSaves = closing
            .map((id) => tabs.find((tab) => tab.id === id))
            .map((tab) => (tab ? saveOperations.get(tab) : undefined))
            .filter((operation): operation is Promise<boolean> => !!operation);
          if (!pendingSaves.length) break;
          await Promise.allSettled(pendingSaves);
          await Promise.resolve();
          if (closePromptGeneration !== promptGeneration) return;
          closing = [...pendingCloseIds];
        }
      } else {
        for (const id of [...closing]) {
          if (closePromptGeneration !== promptGeneration) return;
          const tab = tabs.find((item) => item.id === id);
          if (tab && isDirty(tab)) {
            const saved = await saveTab(id);
            if (closePromptGeneration !== promptGeneration) return;
            if (!saved) return;
            if (tab.id !== id) {
              closing = closing.map((closingId) => (closingId === id ? tab.id : closingId));
              pendingCloseIds = pendingCloseIds.map((closingId) =>
                closingId === id ? tab.id : closingId,
              );
            }
          }
        }
        if (closePromptGeneration !== promptGeneration) return;
        if (closing.some((id) => isDirty(tabs.find((tab) => tab.id === id)))) {
          showNotice("保存期间文档又有修改，请再次保存后关闭。", true);
          return;
        }
      }
    } finally {
      closeSaveInProgress = false;
      void tick().then(focusConfirmation);
    }
    if (closePromptGeneration !== promptGeneration) return;
    const returnFocus = closePromptReturnFocus;
    closePromptReturnFocus = null;
    pendingCloseIds = [];
    closePromptGeneration += 1;
    if (shouldCloseWindow) {
      persistSession();
      persistDraftRecovery(
        action === "discard" ? tabs.filter((tab) => !closing.includes(tab.id)) : tabs,
      );
      allowConfirmedWindowClose = true;
      try {
        await getCurrentWindow().close();
      } catch (error) {
        allowConfirmedWindowClose = false;
        closeAfterConfirmation = false;
        showNotice("关闭窗口失败：" + displayError(error, "请再试一次。"));
        restoreWorkspaceFocus(returnFocus);
      }
      return;
    }
    closeAfterConfirmation = false;
    performCloseTabs(closing);
    restoreWorkspaceFocus(returnFocus);
  }

  function cancelPendingClose() {
    if (closeSaveInProgress) return;
    const returnFocus = closePromptReturnFocus;
    closePromptReturnFocus = null;
    closePromptGeneration += 1;
    pendingCloseIds = [];
    closeAfterConfirmation = false;
    restoreWorkspaceFocus(returnFocus);
  }

  function performCloseTabs(ids: string[]) {
    const closing = new Set(ids);
    const oldIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const wasActive = !!activeTabId && closing.has(activeTabId);
    const nextTab = wasActive
      ? tabs.find((tab, index) => index > oldIndex && !closing.has(tab.id)) ??
        tabs.findLast((tab, index) => index < oldIndex && !closing.has(tab.id))
      : undefined;
    for (const tab of tabs) {
      if (!closing.has(tab.id)) continue;
      const outlineTimer = editorOutlineTimers.get(tab.editorInstanceId);
      if (outlineTimer) clearTimeout(outlineTimer);
      editorOutlineTimers.delete(tab.editorInstanceId);
    }
    tabs = tabs.filter((tab) => !closing.has(tab.id));
    persistDraftRecovery(tabs);

    if (!tabs.length) {
      activeTabId = null;
      searchOpen = false;
      searchQuery = "";
      activeHeadingId = null;
    } else if (nextTab) {
      void activateTab(nextTab.id);
    }
    scheduleSessionSave();
  }

  function reorderTab(sourceId: string, targetId: string, side: "before" | "after") {
    const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
    const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const reordered = [...tabs];
    const [moved] = reordered.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = targetIndex - (sourceIndex < targetIndex ? 1 : 0);
    const insertionIndex = targetIndexAfterRemoval + (side === "after" ? 1 : 0);
    reordered.splice(insertionIndex, 0, moved);
    tabs = reordered;
    scheduleSessionSave();
  }

  function handleTabDragStart(event: DragEvent, tabId: string) {
    draggedTabId = tabId;
    dropTargetTabId = null;
    dropTargetSide = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tabId);
    }
  }

  function tabDropSide(event: DragEvent): "before" | "after" {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
  }

  function handleTabDragOver(event: DragEvent, targetId: string) {
    if (!draggedTabId) return;
    if (targetId === draggedTabId) {
      dropTargetTabId = null;
      dropTargetSide = null;
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTargetTabId = targetId;
    dropTargetSide = tabDropSide(event);
  }

  function handleTabDrop(event: DragEvent, targetId: string) {
    if (!draggedTabId) return;
    event.preventDefault();
    if (targetId !== draggedTabId) reorderTab(draggedTabId, targetId, tabDropSide(event));
    clearTabDragState();
  }

  function clearTabDragState() {
    draggedTabId = null;
    dropTargetTabId = null;
    dropTargetSide = null;
  }

  function showTabContextMenu(event: MouseEvent, tabId: string) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    openTabContextMenu(tabId, event.clientX || rect.left, event.clientY || rect.bottom);
  }

  function openTabContextMenu(tabId: string, x: number, y: number) {
    openMenu = null;
    tabContextMenu = { tabId, x, y };
    const openedMenu = tabContextMenu;
    void tick().then(() => {
      if (tabContextMenu !== openedMenu || !tabContextMenuElement) return;
      const menu = tabContextMenuElement;
      openedMenu.x = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
      openedMenu.y = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
      menu.querySelector<HTMLButtonElement>('button[role="menuitem"]:enabled')?.focus({ preventScroll: true });
    });
  }

  function closeTabContextMenu() {
    const tabId = tabContextMenu?.tabId;
    tabContextMenu = null;
    focusTabButton(tabId);
  }

  function focusTabButton(tabId: string | null | undefined) {
    if (!tabId) return;
    void tick().then(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-button"))
        .find((button) => button.dataset.tabId === tabId)
        ?.focus();
    });
  }

  async function copyTabPath(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab?.path) return;
    try {
      await navigator.clipboard.writeText(displayPath(tab.path));
      showNotice("已复制文件路径");
    } catch {
      showNotice("无法复制文件路径");
    }
    tabContextMenu = null;
  }

  async function checkOpenFiles() {
    if (document.visibilityState === "hidden") return;
    const openTabs = tabs.filter((tab) => !tab.loading && !tab.error && tab.version);
    await Promise.all(openTabs.map((tab) => checkTabForExternalChange(tab)));
  }

  async function checkTabForExternalChange(tab: ReaderTab) {
    if (!tab.version || tab.loading) return;
    const checkedId = tab.id;
    if (externalChecksInFlight.has(checkedId)) return;
    externalChecksInFlight.add(checkedId);
    const checkedVersion = tab.version;
    try {
      const status = await invoke<MarkdownFileStatus>("get_markdown_version", { path: tab.path });
      const current = tabs.find((item) => item.id === checkedId);
      if (current !== tab || !sameVersion(current.version, checkedVersion)) return;
      if (!status.version) {
        if (current.externalChange !== "missing") {
          current.externalChange = "missing";
          if (current.id === activeTabId) showNotice("文件已移动、删除或无法读取");
        }
      } else if (
        pathKey(current.path) !== pathKey(status.path) ||
        !sameVersion(current.version, status.version)
      ) {
        if (current.externalChange !== "modified") {
          current.externalChange = "modified";
          if (current.id === activeTabId) showNotice("文件已在其他程序中修改");
        }
      } else if (current.externalChange === "modified" || current.externalChange === "missing") {
        current.externalChange = null;
      }
    } catch {
      const current = tabs.find((item) => item.id === checkedId);
      if (
        current === tab &&
        sameVersion(current.version, checkedVersion) &&
        current.externalChange !== "missing"
      ) {
        current.externalChange = "missing";
        if (current.id === activeTabId) showNotice("文件已移动、删除或无法读取");
      }
    } finally {
      externalChecksInFlight.delete(checkedId);
    }
  }

  async function reloadCurrentFile() {
    const tab = activeTab;
    if (!tab) return;
    const editorInstanceId = tab.editorInstanceId;
    if (isDirty(tab)) {
      const decision = await confirmDocumentReload(() => sourceForTab(tab), () => requestConfirmation({
        title: "放弃未保存的修改？",
        message: `重新载入将放弃“${tab.name}”的未保存修改。`,
        confirmLabel: "重新载入",
        tone: "danger",
      }));
      if (decision === "changed") {
        showNotice("确认期间文档又有修改，重新载入已取消。");
      }
      if (decision !== "confirmed") return;
    }
    const confirmedSource = sourceForTab(tab);
    const confirmedEditorDoc = tab.editorState?.doc ?? null;

    while (true) {
      const currentTab = tabs.find((item) => item.editorInstanceId === editorInstanceId);
      if (!currentTab) return;
      const pendingSave = saveOperations.get(currentTab);
      if (!pendingSave) {
        await openPath(currentTab.path, {
          restoredScrollTop: currentTab.scrollTop,
          forceReload: true,
          activateOnOpen: activeTabId === currentTab.id,
        });
        return;
      }
      try {
        await pendingSave;
      } catch {
        // 写入失败后仍按用户确认继续尝试重新载入
      }
      const latestTab = tabs.find((item) => item.editorInstanceId === editorInstanceId);
      if (!latestTab) return;
      const matchesConfirmedContent = confirmedEditorDoc && latestTab.editorState
        ? latestTab.editorState.doc.eq(confirmedEditorDoc)
        : sourceForTab(latestTab) === confirmedSource;
      if (!matchesConfirmedContent) {
        showNotice("等待写入期间文档又有修改，重新载入已取消。", true);
        return;
      }
    }
  }

  async function saveActiveTab(saveAs = false) {
    editorComponent?.commitTableCell();
    if (activeTabId) await saveTab(activeTabId, saveAs);
  }

  async function saveTab(
    tabId: string,
    saveAs = false,
    forcedEncoding?: string,
  ): Promise<boolean> {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab || tab.loading || tab.error) return false;

    const pendingSave = saveOperations.get(tab);
    if (pendingSave) {
      let saved: boolean;
      try {
        saved = await pendingSave;
      } catch {
        return false;
      }
      if (!saved) return false;
      const currentTab = tabs.find((item) => item.id === tab.id);
      if (!currentTab) return false;
      if (saveAs || isDirty(currentTab)) {
        return saveTab(currentTab.id, saveAs, forcedEncoding);
      }
      return true;
    }
    if (!saveAs && tab.path && !isDirty(tab)) return true;

    const operation = saveTabOperation(tabId, saveAs, forcedEncoding);
    saveOperations.set(tab, operation);
    try {
      return await operation;
    } catch (error) {
      showNotice("保存失败：" + displayError(error, "请检查文件权限和磁盘空间后重试。"));
      return false;
    } finally {
      if (saveOperations.get(tab) === operation) saveOperations.delete(tab);
    }
  }

  async function saveTabOperation(
    tabId: string,
    saveAs = false,
    forcedEncoding?: string,
  ): Promise<boolean> {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab || tab.loading || tab.error) return false;
    if (!saveAs && tab.path && !isDirty(tab)) return true;

    let targetPath = tab.path;
    let expectedVersion: FileVersion | null = tab.version;
    let encoding = forcedEncoding ?? tab.encoding;
    if (saveAs || !tab.path) {
      const selectedPath = await save({
        defaultPath: tab.path || tab.name,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (!selectedPath) return false;
      let targetStatus: MarkdownFileStatus;
      try {
        targetStatus = await invoke<MarkdownFileStatus>("get_markdown_version", {
          path: selectedPath,
        });
      } catch (error) {
        showNotice("无法检查目标文件：" + displayError(error, "请检查路径和访问权限后重试。"));
        return false;
      }
      targetPath = targetStatus.path;
      const targetKey = pathKey(targetPath);
      if (tabs.some((other) => other.id !== tab.id && pathKey(other.path) === targetKey)) {
        showNotice("目标文件已在另一个标签中打开", true);
        return false;
      }

      const samePath = !!tab.path && targetKey === pathKey(tab.path);
      if (samePath) {
        expectedVersion = tab.version;
        encoding = forcedEncoding ?? tab.encoding;
      } else {
        encoding = forcedEncoding ?? tab.encoding;
        expectedVersion = targetStatus.version;
        if (expectedVersion) {
          const overwrite = await requestConfirmation({
            title: "覆盖现有文件？",
            message: `“${targetPath}”已存在。覆盖后会替换该文件的内容。`,
            confirmLabel: "覆盖文件",
            tone: "danger",
          });
          if (!overwrite) return false;
        }
      }
    }

    const editorStateToSave = tab.editorState;
    const sourceToSave = sourceForTab(tab);
    if (!saveAs && tab.path && tab.savedSource.length > 0 && sourceToSave.length === 0) {
      const confirmed = await requestConfirmation({
        title: "清空文档？",
        message: `当前内容为空。保存将清空“${tab.name}”的现有内容。`,
        confirmLabel: "保存空文档",
        tone: "danger",
      });
      if (!confirmed) return false;
    }
    const write = (writeEncoding: string) =>
      invoke<MarkdownWriteResult>("write_markdown", {
        path: targetPath,
        content: sourceToSave,
        encoding: writeEncoding,
        expectedVersion,
      });

    let result: MarkdownWriteResult;
    try {
      result = await write(encoding);
    } catch (error) {
      const message = displayError(error, "无法写入文件，请检查文件权限和磁盘空间后重试。");
      if (message.includes("无法表示新增字符")) {
        const convert = await requestConfirmation({
          title: "转换为 UTF-8？",
          message: `当前编码无法保存“${tab.name}”中的新增字符。改用 UTF-8 后会保留文字内容。`,
          confirmLabel: "使用 UTF-8 保存",
          tone: "primary",
        });
        if (!convert) return false;
        try {
          result = await write("utf-8");
        } catch (retryError) {
          const retryMessage = displayError(
            retryError,
            "无法写入文件，请检查文件权限和磁盘空间后重试。",
          );
          if (isFileVersionConflict(retryMessage)) {
            showWriteConflict(tab, targetPath, retryMessage);
          } else {
            showNotice(retryMessage);
          }
          return false;
        }
      } else {
        if (isFileVersionConflict(message)) {
          showWriteConflict(tab, targetPath, message);
        } else {
          showNotice("保存失败：" + message);
        }
        return false;
      }
    }

    const documentPathChanged = pathKey(tab.path) !== pathKey(result.path);
    const previousId = tab.id;
    const nextId = pathKey(result.path);
    tab.id = nextId;
    if (activeTabId === previousId) activeTabId = nextId;
    if (pendingCloseIds.includes(previousId)) {
      pendingCloseIds = pendingCloseIds.map((id) => (id === previousId ? nextId : id));
    }
    tab.path = result.path;
    tab.name = result.name;
    tab.source = sourceToSave;
    tab.savedSource = sourceToSave;
    tab.savedEditorDoc = editorStateToSave?.doc ?? null;
    tab.encoding = result.encoding;
    tab.version = result.version;
    tab.externalChange = null;
    tab.error = null;
    rememberFile(result.path, result.name);
    persistDraftRecovery();
    scheduleSessionSave();
    if (documentPathChanged && !tab.editing) {
      const renderGeneration = ++tab.renderGeneration;
      void renderMarkdown(sourceToSave, loadDocumentImage(result.path))
        .then(async (rendered) => {
          if (
            !tabs.includes(tab) ||
            tab.editing ||
            tab.path !== result.path ||
            tab.renderGeneration !== renderGeneration
          ) return;
          tab.html = rendered.html;
          tab.headings = rendered.headings;
          tab.renderedSource = sourceToSave;
          tab.renderedPath = result.path;
          if (activeTabId === tab.id) {
            activeHeadingId = rendered.headings[0]?.id ?? null;
            await tick();
            if (activeTabId === tab.id && !tab.editing) syncActiveHeading();
          }
        })
        .catch(() => {
          if (activeTabId === tab.id && !tab.editing) {
            showNotice("另存为后无法更新本地图片。");
          }
        });
    }
    showNotice("已保存");
    return true;
  }

  function handleEditorCursorChange(
    editorInstanceId: string,
    cursor: number,
    currentLine: number,
  ) {
    const tab = tabs.find((item) => item.editorInstanceId === editorInstanceId);
    if (!tab) return;
    tab.cursor = cursor;
    let low = 0;
    let high = tab.headings.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tab.headings[middle].line <= currentLine) low = middle + 1;
      else high = middle;
    }
    if (tab.id === activeTabId) {
      activeHeadingId = tab.headings[low - 1]?.id ?? null;
    }
  }

  function handleEditorScrollPositionChange(
    editorInstanceId: string,
    scrollTop: number,
    progress: number,
  ) {
    const tab = tabs.find((item) => item.editorInstanceId === editorInstanceId);
    if (!tab) return;
    tab.editorScrollTop = Math.max(0, scrollTop);
    tab.editorScrollProgress = Math.min(1, Math.max(0, progress));
  }

  function handleEditorStateChange(
    editorInstanceId: string,
    editorState: EditorState,
    compartments: EditorCompartments,
    documentChanged: boolean,
  ) {
    const tab = tabs.find((item) => item.editorInstanceId === editorInstanceId);
    if (!tab) return;
    if (!tab.savedEditorDoc) tab.savedEditorDoc = editorState.doc;
    const stateChanged = tab.editorState !== editorState;
    tab.editorState = editorState;
    tab.editorCompartments = compartments;
    if (documentChanged && stateChanged) {
      if (!tab.path) {
        tab.draftUpdatedAt = Date.now();
        scheduleDraftRecovery();
      }
      if (tab.editing) scheduleEditorOutlineUpdate(tab, editorState);
    }
  }

  function scheduleEditorOutlineUpdate(tab: ReaderTab, editorState: EditorState) {
    const outlineKey = tab.editorInstanceId;
    const previousTimer = editorOutlineTimers.get(outlineKey);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      if (editorOutlineTimers.get(outlineKey) === timer) editorOutlineTimers.delete(outlineKey);
      if (
        !tabs.includes(tab) ||
        !tab.editing ||
        tab.editorState?.doc !== editorState.doc
      ) return;

      const source = sourceForTab(tab);
      void loadMarkdownModule()
        .then((markdown) => {
          if (
            !tabs.includes(tab) ||
            !tab.editing ||
            tab.editorState?.doc !== editorState.doc
          ) return;
          tab.headings = markdown.extractDocumentHeadings(source);
          const currentEditorState = tab.editorState;
          if (currentEditorState && activeTabId === tab.id) {
            const cursor = currentEditorState.selection.main.head;
            const line = currentEditorState.doc.lineAt(cursor).number - 1;
            handleEditorCursorChange(tab.editorInstanceId, cursor, line);
          }
        })
        .catch(() => {});
    }, 180);
    editorOutlineTimers.set(outlineKey, timer);
  }

  async function toggleEditing() {
    editorComponent?.commitTableCell();
    const tab = activeTab;
    if (!tab || tab.loading || tab.error) return;
    if (!tab.editing) {
      tab.renderGeneration += 1;
      if (!tab.editorState && readerViewport) {
        const maxScrollTop = readerViewport.scrollHeight - readerViewport.clientHeight;
        tab.editorScrollProgress =
          maxScrollTop > 0 ? readerViewport.scrollTop / maxScrollTop : 0;
      }
      closeSearch();
      tab.editing = true;
      await tick();
      return;
    }

    const outlineTimer = editorOutlineTimers.get(tab.editorInstanceId);
    if (outlineTimer) clearTimeout(outlineTimer);
    editorOutlineTimers.delete(tab.editorInstanceId);
    const renderGeneration = ++tab.renderGeneration;
    const isCurrentRender = () =>
      tab.renderGeneration === renderGeneration &&
      tabs.includes(tab) &&
      !tab.loading &&
      tab.editing;
    const source = sourceForTab(tab);

    if (source === tab.renderedSource && pathKey(tab.path) === pathKey(tab.renderedPath)) {
      tab.source = source;
      tab.editing = false;
      if (activeTabId === tab.id) {
        await tick();
        if (activeTabId === tab.id && !tab.editing && readerViewport) {
          setReaderScrollProgress(tab.editorScrollProgress);
          tab.scrollTop = readerViewport.scrollTop;
          syncActiveHeading();
        }
      }
      return;
    }

    try {
      let renderedSource = source;
      let rendered: RenderedDocument;
      while (true) {
        if (!isCurrentRender()) return;

        const editorState = tab.editorState;
        const documentPath = tab.path;
        renderedSource = sourceForTab(tab);
        rendered = await renderMarkdown(renderedSource, loadDocumentImage(documentPath));

        if (!isCurrentRender()) return;
        if (tab.editorState === editorState && tab.path === documentPath) break;
      }

      tab.source = renderedSource;
      tab.html = rendered.html;
      tab.headings = rendered.headings;
      tab.renderedSource = renderedSource;
      tab.renderedPath = tab.path;
      tab.editing = false;
      if (activeTabId === tab.id) {
        activeHeadingId = rendered.headings[0]?.id ?? null;
        await tick();
        if (activeTabId === tab.id) {
          setReaderScrollProgress(tab.editorScrollProgress);
          if (readerViewport) tab.scrollTop = readerViewport.scrollTop;
          syncActiveHeading();
        }
      }
    } catch (error) {
      if (isCurrentRender()) {
        showNotice("无法切换到阅读模式：" + displayError(error, "当前修改仍保留，请重试。"));
      }
    }
  }

  function cycleTab(direction: number) {
    const ids = tabs.map((tab) => tab.id);
    const currentIndex = ids.indexOf(activeTabId ?? "");
    if (ids.length < 2 || currentIndex < 0) return;
    const nextId = ids[(currentIndex + direction + ids.length) % ids.length];
    void activateTab(nextId);
  }

  function clearReaderHeadingScroll() {
    if (readerHeadingSyncTimer) clearTimeout(readerHeadingSyncTimer);
    readerHeadingSyncTimer = undefined;
    headingScrollPending = false;
  }

  $effect(() => {
    activeTabId;
    readerViewport;
    return clearReaderHeadingScroll;
  });

  $effect(() => {
    if (tocVisible && activeTab?.headings.length && activeHeadingId && outlineList) {
      const current = outlineList.querySelector<HTMLElement>('[aria-current="location"]');
      if (current) revealOutlineItem(outlineList, current);
    }
  });

  function revealOutlineItem(list: HTMLElement, item: HTMLElement) {
    const top = list.getBoundingClientRect().top + list.clientTop;
    const itemBounds = item.getBoundingClientRect();
    const focusClearance = 6;
    const above = itemBounds.top - (top + focusClearance);
    const below = itemBounds.bottom - (top + list.clientHeight - focusClearance);
    if (above < 0) list.scrollTop += above;
    else if (below > 0) list.scrollTop += below;
  }

  function handleOutlineKeydown(event: KeyboardEvent & { currentTarget: HTMLButtonElement }) {
    const current = event.currentTarget;
    const list = current.parentElement;
    if (!list || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const targets: Record<string, Element | null> = {
      ArrowUp: current.previousElementSibling,
      ArrowDown: current.nextElementSibling,
      Home: list.firstElementChild,
      End: list.lastElementChild,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    if (!(target instanceof HTMLButtonElement)) return;
    target.focus({ preventScroll: true });
    revealOutlineItem(list, target);
  }

  function scheduleReaderHeadingSync() {
    if (readerHeadingSyncTimer) clearTimeout(readerHeadingSyncTimer);
    readerHeadingSyncTimer = setTimeout(() => {
      readerHeadingSyncTimer = undefined;
      headingScrollPending = false;
    }, 160);
  }

  function handleReaderScroll(event: Event) {
    const viewport = event.currentTarget as HTMLDivElement;
    if (viewport !== readerViewport || !activeTab || activeTab.editing || activeTab.loading) return;
    activeTab.scrollTop = viewport.scrollTop;
    scheduleSessionSave();
    if (headingScrollPending) scheduleReaderHeadingSync();
    else syncActiveHeading();
  }

  function setReaderScrollProgress(progress: number) {
    if (!readerViewport) return;
    const maxScrollTop = Math.max(0, readerViewport.scrollHeight - readerViewport.clientHeight);
    const nextScrollTop = maxScrollTop * Math.min(1, Math.max(0, progress));
    if (Math.abs(readerViewport.scrollTop - nextScrollTop) > 2) {
      readerViewport.scrollTop = nextScrollTop;
    }
  }

  function findReaderAnchor(id: string) {
    return readerContent?.querySelector(`#${CSS.escape(id)}`);
  }

  function syncActiveHeading() {
    if (headingScrollPending) return;
    if (!readerViewport || !readerContent || !activeTab?.headings.length) {
      activeHeadingId = null;
      return;
    }

    const maxScrollTop = readerViewport.scrollHeight - readerViewport.clientHeight;
    if (maxScrollTop > 2 && readerViewport.scrollTop >= maxScrollTop - 2) {
      activeHeadingId = activeTab.headings.at(-1)?.id ?? null;
      return;
    }

    const viewportTop = readerViewport.getBoundingClientRect().top;
    const threshold = viewportTop + 92;
    let low = 0;
    let high = activeTab.headings.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const element = findReaderAnchor(activeTab.headings[middle].id);
      if (element && element.getBoundingClientRect().top <= threshold) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    activeHeadingId = activeTab.headings[Math.max(0, low - 1)]?.id ?? null;
  }

  function scrollReaderToHeading(id: string, element: Element) {
    headingScrollPending = true;
    activeHeadingId = id;
    element.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    scheduleReaderHeadingSync();
  }

  function jumpToHeading(heading: DocumentHeading) {
    if (activeTab?.editing) {
      editorComponent?.scrollToLine(heading.line);
      activeHeadingId = heading.id;
      return;
    }
    const element = findReaderAnchor(heading.id);
    if (element) {
      scrollReaderToHeading(heading.id, element);
    }
  }

  async function jumpToAnchor(id: string, expectedTabId = activeTabId) {
    if (!expectedTabId || activeTabId !== expectedTabId) return;
    const expectedEditorInstanceId = tabs.find(
      (tab) => tab.id === expectedTabId,
    )?.editorInstanceId;
    if (!expectedEditorInstanceId) return;
    await tick();
    if (activeTabId !== expectedTabId) return;
    const expectedTab = tabs.find((tab) => tab.id === expectedTabId);
    if (!expectedTab || expectedTab.editorInstanceId !== expectedEditorInstanceId) return;
    if (expectedTab.editing) {
      const heading = expectedTab.headings.find((item) => item.id === id);
      if (!heading) return;
      editorComponent?.scrollToLine(heading.line);
      activeHeadingId = heading.id;
      return;
    }
    const element = findReaderAnchor(id);
    if (!element) return;
    if (expectedTab.headings.some((heading) => heading.id === id)) {
      scrollReaderToHeading(id, element);
      return;
    }
    element.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }

  function setTheme(value: string) {
    const nextDarkMode = value === "dark";
    if (nextDarkMode === darkMode) return;

    themeSwitching = true;
    darkMode = nextDarkMode;
    savePreferences();
    if (themeSwitchTimer) clearTimeout(themeSwitchTimer);
    themeSwitchTimer = setTimeout(() => {
      themeSwitching = false;
      themeSwitchTimer = undefined;
    }, 180);
  }

  function setReadingLineHeight(value: string) {
    const nextValue = Number(value);
    if (!lineHeightOptions.includes(nextValue as (typeof lineHeightOptions)[number])) return;
    lineHeight = nextValue as (typeof lineHeightOptions)[number];
    savePreferences();
  }

  function setReadingFontSize(value: string) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    fontSize = Math.min(maxFontSize, Math.max(minFontSize, nextValue));
    savePreferences();
  }

  function toggleSettings() {
    if (settingsOpen) {
      closeSettings();
      return;
    }
    openMenu = null;
    tabContextMenu = null;
    if (searchOpen) closeSearch();
    settingsOpen = true;
    void tick().then(focusSettingsCategory);
  }

  function focusSettingsCategory() {
    const target = settingsWorkspace?.querySelector<HTMLElement>(
      '.settings-nav [role="tab"][aria-selected="true"]',
    );
    target?.focus({ preventScroll: true });
  }

  function closeSettings() {
    settingsOpen = false;
    void tick().then(() => document.querySelector<HTMLButtonElement>(".settings-toggle")?.focus());
  }

  async function chooseDefaultOpenDirectory() {
    try {
      const directory = await open({ directory: true, multiple: false });
      if (typeof directory !== "string") return;
      defaultOpenDirectory = directory;
      savePreferences();
    } catch {
      showNotice("选择默认文件夹失败，请重试。");
    }
  }

  async function openDefaultAppsSettings() {
    try {
      await openUrl("ms-settings:defaultapps");
      showNotice("请在默认应用设置中选择 LiteMD，并关联 .md 和 .markdown 文件。");
    } catch {
      showNotice("无法打开系统默认应用设置。");
    }
  }

  function changeFontSize(amount: number) {
    const nextFontSize = Math.min(maxFontSize, Math.max(minFontSize, fontSize + amount));
    if (nextFontSize === fontSize) return;
    fontSize = nextFontSize;
    savePreferences();
  }

  function resetReadingFontSize() {
    if (fontSize === defaultFontSize) return;
    fontSize = defaultFontSize;
    savePreferences();
  }

  function bindFontZoomWheel(node: HTMLElement) {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();

      const now = performance.now();
      if (now - lastFontZoomAt < 80) return;
      lastFontZoomAt = now;
      changeFontSize(event.deltaY < 0 ? 1 : -1);
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener("wheel", handleWheel);
      },
    };
  }

  function setEditorIndentWidth(width: 2 | 4 | 8) {
    editorIndentWidth = width;
    savePreferences();
    openMenu = null;
    if (!settingsOpen) void tick().then(() => editorComponent?.focusEditor());
  }

  function beginOutlineResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const splitter = event.currentTarget as HTMLElement;
    const layout = splitter.parentElement;
    if (!layout) return;
    const bounds = layout.getBoundingClientRect();
    outlineResizeBounds = { left: bounds.left, splitterWidth: splitter.offsetWidth };
    splitter.setPointerCapture(event.pointerId);
  }

  function resizeOutline(event: PointerEvent) {
    const splitter = event.currentTarget as HTMLElement;
    const bounds = outlineResizeBounds;
    if (!splitter.hasPointerCapture(event.pointerId) || !bounds) return;
    outlineWidth = Math.min(
      maxOutlineWidth,
      Math.max(minOutlineWidth, event.clientX - bounds.left - bounds.splitterWidth / 2),
    );
  }

  function finishOutlineResize(event: PointerEvent) {
    const splitter = event.currentTarget as HTMLElement;
    if (splitter.hasPointerCapture(event.pointerId)) {
      resizeOutline(event);
      splitter.releasePointerCapture(event.pointerId);
      outlineResizeBounds = null;
      savePreferences();
    } else {
      outlineResizeBounds = null;
    }
  }

  function handleOutlineResizeKeydown(event: KeyboardEvent) {
    let nextWidth: number | null = null;
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") nextWidth = visibleOutlineWidth - step;
    else if (event.key === "ArrowRight") nextWidth = visibleOutlineWidth + step;
    else if (event.key === "Home") nextWidth = minOutlineWidth;
    else if (event.key === "End") nextWidth = maxOutlineWidth;
    else return;
    event.preventDefault();
    outlineWidth = Math.min(maxOutlineWidth, Math.max(minOutlineWidth, nextWidth));
    savePreferences();
  }

  async function showSearch() {
    if (!activeTab || activeTab.loading || activeTab.error || activeTab.editing) return;
    searchOpen = true;
    openMenu = null;
    await tick();
    searchInput?.focus();
    searchInput?.select();
  }

  function toggleReaderSearch() {
    if (searchOpen) closeSearch();
    else void showSearch();
  }

  function closeSearch() {
    const restoreFocus = searchOpen;
    searchOpen = false;
    searchQuery = "";
    searchCount = 0;
    activeSearchIndex = 0;
    if (restoreFocus) {
      void tick().then(() => readerViewport?.focus({ preventScroll: true }));
    }
  }

  function clearSearchHighlights() {
    const marks = readerContent?.querySelectorAll("mark.reader-search-hit");
    if (marks?.length) {
      marks.forEach((mark) => mark.replaceWith(mark.textContent ?? ""));
      readerContent?.normalize();
    }
    searchCount = 0;
    activeSearchIndex = 0;
  }

  function applySearchHighlights(query: string) {
    clearSearchHighlights();
    const term = query.trim();
    if (!readerContent || !term) return;
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(escapedTerm, "giu");

    const walker = document.createTreeWalker(readerContent, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, mark")) continue;
      textNodes.push(node);
    }

    let matchIndex = 0;
    for (const node of textNodes) {
      const value = node.nodeValue ?? "";
      let match = matcher.exec(value);
      if (!match) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      while (match) {
        const position = match.index;
        fragment.append(document.createTextNode(value.slice(cursor, position)));
        const mark = document.createElement("mark");
        mark.className = matchIndex === 0 ? "reader-search-hit current" : "reader-search-hit";
        mark.dataset.searchIndex = String(matchIndex);
        mark.textContent = match[0];
        fragment.append(mark);
        matchIndex += 1;
        cursor = position + match[0].length;
        match = matcher.exec(value);
      }
      fragment.append(document.createTextNode(value.slice(cursor)));
      node.parentNode?.replaceChild(fragment, node);
    }

    searchCount = matchIndex;
  }

  function moveSearchMatch(direction: number) {
    if (!readerContent || searchCount === 0) return;
    readerContent.querySelector("mark.reader-search-hit.current")?.classList.remove("current");
    activeSearchIndex =
      (activeSearchIndex + direction + searchCount) % searchCount;
    const match = readerContent.querySelector(
      `mark.reader-search-hit[data-search-index="${activeSearchIndex}"]`,
    );
    match?.classList.add("current");
    match?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      moveSearchMatch(event.shiftKey ? -1 : 1);
    }
  }

  $effect(() => {
    const tabId = activeTab?.id;
    const html = activeTab?.html;
    const content = readerContent;
    const isSearchOpen = searchOpen;
    const query = searchQuery;
    void tick().then(() => {
      if (
        activeTab?.id !== tabId ||
        activeTab?.html !== html ||
        readerContent !== content ||
        searchOpen !== isSearchOpen ||
        searchQuery !== query
      ) return;
      if (!tabId || !isSearchOpen) clearSearchHighlights();
      else applySearchHighlights(query);
    });
  });

  $effect(() => {
    const selectedTabId = activeTabId;
    const strip = tabStripElement;
    if (!selectedTabId) return;
    void tick().then(() => {
      if (activeTabId !== selectedTabId) return;
      strip
        ?.querySelector<HTMLElement>(".tab-shell.selected")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

  function closeImagePreview() {
    const trigger = imageZoomTrigger;
    zoomedImage = null;
    imageZoomTrigger = null;
    void tick().then(() => {
      if (trigger?.isConnected) {
        trigger.tabIndex = -1;
        trigger.focus({ preventScroll: true });
      }
    });
  }

  function handleImagePreviewKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeImagePreview();
    } else if (event.key === "Tab") {
      const preview = event.currentTarget as HTMLElement;
      const focusable = Array.from(
        preview.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function handleImagePreviewClick(event: MouseEvent) {
    if (event.target === event.currentTarget) closeImagePreview();
  }

  async function handleReaderClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copyButton = target.closest<HTMLButtonElement>("[data-copy-code]");
    if (copyButton) {
      event.preventDefault();
      const code = copyButton
        .closest(".reader-code-block")
        ?.querySelector("pre code")
        ?.textContent;
      if (code === undefined) return;
      try {
        await navigator.clipboard.writeText(code);
        const originalLabel = copyButton.dataset.copyLabel || copyButton.textContent?.trim() || "复制";
        const previousTimer = readerCodeCopyTimers.get(copyButton);
        if (previousTimer) clearTimeout(previousTimer);
        copyButton.dataset.copyLabel = originalLabel;
        copyButton.textContent = "已复制";
        const timer = window.setTimeout(() => {
          readerCodeCopyTimers.delete(copyButton);
          if (!copyButton.isConnected) return;
          copyButton.textContent = originalLabel;
          delete copyButton.dataset.copyLabel;
        }, 1400);
        readerCodeCopyTimers.set(copyButton, timer);
      } catch {
        showNotice("无法复制代码");
      }
      return;
    }
    const image = target.closest<HTMLImageElement>("img");
    if (image && !image.closest("a")) {
      event.preventDefault();
      image.tabIndex = -1;
      imageZoomTrigger = image;
      zoomedImage = { src: image.currentSrc || image.src, alt: image.alt };
      void tick().then(() => imageZoomClose?.focus());
      return;
    }
    const anchor = target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();

    if (href.startsWith("#")) {
      try {
        const id = decodeURIComponent(href.slice(1));
        if (id) await jumpToAnchor(id);
      } catch {
        showNotice("无法定位到这个标题。");
      }
      return;
    }

    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      void openUrl(href).catch(() => showNotice("无法打开这个链接。"));
      return;
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(href) || /^(?:\/|\\\\)/.test(href)) {
      showNotice("暂不支持这个链接格式。");
      return;
    }

    const hashIndex = href.indexOf("#");
    const pathAndQuery = hashIndex < 0 ? href : href.slice(0, hashIndex);
    const queryIndex = pathAndQuery.indexOf("?");
    const encodedPath = queryIndex < 0 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
    let path: string;
    let fragment: string | undefined;
    try {
      path = decodeURIComponent(encodedPath);
      fragment = hashIndex < 0 ? undefined : decodeURIComponent(href.slice(hashIndex + 1));
    } catch {
      showNotice("无法解析这个链接。");
      return;
    }

    if (!path) {
      if (fragment) await jumpToAnchor(fragment);
      return;
    }
    if (!/\.(?:md|markdown)$/i.test(path)) {
      showNotice("暂时只支持跳转到 Markdown 文档。");
      return;
    }

    const sourceTab = activeTab;
    if (!sourceTab?.path) return;
    try {
      const targetPath = await invoke<string>("resolve_markdown_link", {
        documentPath: sourceTab.path,
        source: path,
      });
      if (tabs.includes(sourceTab)) {
        await openPath(targetPath, { fragment, activateOnOpen: activeTab === sourceTab });
      }
    } catch {
      showNotice("无法打开链接中的 Markdown 文档。");
    }
  }

  function interceptReaderLinks(node: HTMLElement) {
    const handleClick = (event: MouseEvent) => void handleReaderClick(event);
    node.addEventListener("click", handleClick);
    return {
      destroy() {
        node.removeEventListener("click", handleClick);
      },
    };
  }

  function getWindowResizeDirection(event: PointerEvent): WindowResizeDirection | null {
    if (!isTauri() || windowMaximized) return null;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, input, select, textarea, [contenteditable='true']")
    ) {
      return null;
    }

    const north = event.clientY <= windowResizeEdgeSize;
    const south = event.clientY >= window.innerHeight - windowResizeEdgeSize;
    const west = event.clientX <= windowResizeEdgeSize;
    const east = event.clientX >= window.innerWidth - windowResizeEdgeSize;

    if (north && west) return "NorthWest";
    if (north && east) return "NorthEast";
    if (south && west) return "SouthWest";
    if (south && east) return "SouthEast";
    if (north) return "North";
    if (south) return "South";
    if (west) return "West";
    if (east) return "East";
    return null;
  }

  function handleWindowResizePointerMove(event: PointerEvent) {
    resizeDirection = getWindowResizeDirection(event);
  }

  function clearWindowResizeDirection() {
    resizeDirection = null;
  }

  function handleOuterPointerDown(event: PointerEvent) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".modal-backdrop, .image-zoom-backdrop")
    ) {
      return;
    }

    if (event.button === 0) {
      const direction = getWindowResizeDirection(event);
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        void getCurrentWindow().startResizeDragging(direction).catch((error) => {
          resizeDirection = null;
          showNotice("无法调整窗口大小：" + displayError(error, "请稍后重试。"));
        });
        return;
      }
    }

    if (notice && !noticePersistent && target instanceof Element && !target.closest(".notice")) {
      dismissNotice(false);
    }
    if (target instanceof Element && !target.closest(".menu-wrap")) {
      openMenu = null;
    }
    if (target instanceof Element && !target.closest(".tab-context-menu")) {
      tabContextMenu = null;
    }
    if (settingsOpen) return;
  }

  function handleSettingsChoiceKeydown(event: KeyboardEvent) {
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
    if (direction === 0 && event.key !== "Home" && event.key !== "End") return;
    const button = event.currentTarget as HTMLButtonElement;
    const group = button.parentElement;
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!buttons.length) return;
    event.preventDefault();
    const currentIndex = Math.max(0, buttons.indexOf(button));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    buttons[nextIndex].click();
  }

  function toggleMenu(menu: "file" | "recent" | "tabs") {
    if (openMenu === menu) {
      openMenu = null;
      hoveredRecentPath = null;
      focusedRecentPath = null;
      return;
    }

    if (activeTab?.editing) editorComponent?.closeSearch();
    hoveredRecentPath = null;
    focusedRecentPath = null;
    openMenu = menu;
    void tick().then(() => {
      if (openMenu !== menu) return;
      document
        .querySelector<HTMLButtonElement>(`[data-menu-trigger="${menu}"]`)
        ?.closest(".menu-wrap")
        ?.querySelector<HTMLElement>(
          "[role^='menuitem']:not([disabled]):not([aria-hidden='true'])",
        )
        ?.focus();
    });
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    const menu = event.currentTarget as HTMLElement;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menu.classList.contains("tab-context-menu")) {
        closeTabContextMenu();
      } else {
        const trigger = menu.parentElement?.querySelector<HTMLButtonElement>(".menu-trigger");
        openMenu = null;
        void tick().then(() => trigger?.focus());
      }
      return;
    }

    const items = Array.from(
      menu.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled]):not([aria-hidden='true'])"),
    );
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + items.length) % items.length;
    else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    items[nextIndex]?.focus();
  }

  function handleTabKeydown(event: KeyboardEvent, tabId: string) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      openTabContextMenu(tabId, rect.left, rect.bottom);
      return;
    }

    const ids = tabs.map((tab) => tab.id);
    const currentIndex = ids.indexOf(tabId);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % ids.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = ids.length - 1;
    else return;

    event.preventDefault();
    const nextId = ids[nextIndex];
    void activateTab(nextId).then(() => {
      focusTabButton(nextId);
    });
  }

  async function minimizeWindow() {
    await getCurrentWindow().minimize();
  }

  async function syncMaximizedState() {
    try {
      windowMaximized = await getCurrentWindow().isMaximized();
    } catch {
      // 浏览器预览不提供原生窗口状态
    }
  }

  async function toggleMaximizeWindow() {
    await getCurrentWindow().toggleMaximize();
    await syncMaximizedState();
  }

  async function closeWindow() {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      showNotice("关闭窗口失败：" + displayError(error, "请再试一次。"));
    }
  }
</script>

<svelte:head>
  <title>LiteMD</title>
</svelte:head>

{#snippet noticeContents()}
  <span>{notice}</span>
  <button aria-label="关闭提示" title="关闭提示" onclick={() => dismissNotice()}><X size={16} /></button>
{/snippet}

{#snippet documentTabs()}
    <div class="tab-strip drag-region" data-tauri-drag-region bind:this={tabStripContainerElement}>
      <div class="tab-scroll-area" bind:this={tabStripElement}>
      <div class="tab-list" role="tablist" aria-label="工作区标签" bind:this={tabListElement}>
        {#each tabs as tab (tab.id)}
          {@const directoryHint = tabDirectoryHint(tab)}
          <div
            class="tab-shell"
            class:selected={tab.id === activeTabId && !settingsOpen}
            class:modified={isDirty(tab)}
            class:drop-before={dropTargetTabId === tab.id && dropTargetSide === "before"}
            class:drop-after={dropTargetTabId === tab.id && dropTargetSide === "after"}
          >
            <button
              class="tab-button"
              role="tab"
              data-tab-id={tab.id}
              draggable="true"
              aria-selected={tab.id === activeTabId && !settingsOpen}
              tabindex={tab.id === focusableTabId ? 0 : -1}
              title={tab.path ? displayPath(tab.path) : tab.name}
              onclick={() => void activateTab(tab.id)}
              onkeydown={(event) => handleTabKeydown(event, tab.id)}
              oncontextmenu={(event) => showTabContextMenu(event, tab.id)}
              ondragstart={(event) => handleTabDragStart(event, tab.id)}
              ondragover={(event) => handleTabDragOver(event, tab.id)}
              ondrop={(event) => handleTabDrop(event, tab.id)}
              ondragend={clearTabDragState}
            >
              <FileText size={16} strokeWidth={1.8} />
              <span class="tab-copy" class:has-directory-hint={directoryHint !== null}>
                <span class="tab-name">{tab.name}</span>
                {#if directoryHint}<span class="tab-directory-hint">· {directoryHint}</span>{/if}
              </span>
              {#if isDirty(tab)}<span class="dirty-indicator" aria-label="有未保存的修改"></span>{/if}
              {#if tab.externalChange}<span class="external-indicator" aria-label="文件在外部发生变化"></span>{/if}
              {#if tab.loading}<span class="tab-loading" aria-label="正在读取"></span>{/if}
            </button>
            <button
              class="tab-close"
              aria-label={"关闭 " + tab.name}
              title="关闭标签"
              onclick={() => closeTab(tab.id)}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        {/each}
      </div>
      </div>
      {#if hasTabOverflow}
        <div class="menu-wrap tab-overflow-wrap">
          <button
            class="menu-trigger tab-overflow-trigger"
            data-menu-trigger="tabs"
            aria-label="显示所有标签"
            title="显示所有标签"
            aria-haspopup="menu"
            aria-expanded={openMenu === "tabs"}
            onclick={() => toggleMenu("tabs")}
          >
            <ChevronDown size={16} />
          </button>
          {#if openMenu === "tabs"}
            <div
              class="dropdown-menu tab-overflow-menu"
              role="menu"
              aria-label="所有工作区标签"
              tabindex="-1"
              transition:popupTransition={{ duration: 150 }}
              onkeydown={handleMenuKeydown}
            >
              <span class="menu-label">工作区标签</span>
              {#each tabs as tab (tab.id)}
                <button
                  class="tab-overflow-item"
                  role="menuitem"
                  aria-current={tab.id === activeTabId && !settingsOpen ? "page" : undefined}
                  title={tab.path ? displayPath(tab.path) : tab.name}
                  onclick={() => { void activateTab(tab.id).then(() => focusTabButton(tab.id)); }}
                >
                  <FileText size={16} strokeWidth={1.8} />
                  <span class="tab-overflow-copy">
                    <span class="tab-overflow-title-line">
                      <span class="tab-overflow-name">{tab.name}</span>
                      {#if tab.loading || tab.error || isDirty(tab) || tab.externalChange}
                        <span class="tab-overflow-status">
                          {#if tab.loading}正在读取{/if}
                          {#if tab.error}{tab.loading ? " · " : ""}打开失败{/if}
                          {#if isDirty(tab)}{tab.loading || tab.error ? " · " : ""}未保存{/if}
                          {#if tab.externalChange === "modified"}{tab.loading || tab.error || isDirty(tab) ? " · " : ""}外部已修改{/if}
                          {#if tab.externalChange === "missing"}{tab.loading || tab.error || isDirty(tab) ? " · " : ""}文件不可用{/if}
                        </span>
                      {/if}
                    </span>
                    <span class="tab-overflow-path">
                      {#if tab.path}<bdi>{displayPath(tab.path)}</bdi>{:else}未保存文档{/if}
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
{/snippet}
<main
  class="app-shell"
  class:dark={darkMode}
  class:theme-switching={themeSwitching}
  class:no-document-state={!activeTab}
  class:with-workspace-tabs={tabs.length > 0}
  class:settings-open={settingsOpen}
  class:has-modal={pendingCloseIds.length > 0 || pendingConfirmation !== null}
  class:window-inactive={!windowFocused}
  class:window-resize-hover={resizeDirection !== null}
  style={`--reader-line-height:${lineHeight};--window-resize-cursor:${resizeDirection ? windowResizeCursorByDirection[resizeDirection] : "auto"}`}
  use:tooltipLayer
  onpointerdown={handleOuterPointerDown}
  onpointermove={handleWindowResizePointerMove}
  onpointerleave={clearWindowResizeDirection}
>
  <header class="titlebar" inert={documentInteractionBlocked}>
  <nav class="toolbar" aria-label="应用工具栏">
    <div class="toolbar-left">
      <div class="menu-wrap">
        <button class="menu-trigger" data-menu-trigger="file" aria-haspopup="menu" aria-expanded={openMenu === "file"} onclick={() => toggleMenu("file")}>
          <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>文件</span>
        </button>
        {#if openMenu === "file"}
          <div class="dropdown-menu" role="menu" tabindex="-1" transition:popupTransition={{ duration: 150 }} onkeydown={handleMenuKeydown}>
            <button role="menuitem" onclick={() => void openFiles()}>
              <FolderOpen size={16} /> <span>打开文件…</span><kbd>Ctrl+O</kbd>
            </button>
            <button role="menuitem" onclick={() => void createMarkdownDocument()}>
              <Plus size={16} /> <span>新建文件</span><kbd>Ctrl+N</kbd>
            </button>
            {#if activeTab && !activeTab.loading && !activeTab.error}
              <div class="menu-divider"></div>
              <button role="menuitem" onclick={() => { openMenu = null; void saveActiveTab(); }}>
                <Save size={16} /> <span>保存</span><kbd>Ctrl+S</kbd>
              </button>
              <button role="menuitem" onclick={() => { openMenu = null; void saveActiveTab(true); }}>
                <Save size={16} /> <span>另存为…</span><kbd>Ctrl+Shift+S</kbd>
              </button>
            {/if}
            {#if activeTab && !activeTab.loading && !activeTab.error}
              <div class="menu-divider"></div>
              <button role="menuitem" onclick={() => void printActiveDocument()}>
                <Printer size={16} /> <span>打印…</span><kbd>Ctrl+P</kbd>
              </button>
              <button role="menuitem" onclick={() => void exportActiveDocument()}>
                <Download size={16} /> <span>导出 HTML…</span>
              </button>
            {/if}
            <div class="menu-divider"></div>
            <button role="menuitem" onclick={() => void closeWindow()}>
              <LogOut size={16} /> <span>退出</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-wrap">
        <button
          class="menu-trigger"
          data-menu-trigger="recent"
          aria-haspopup="menu"
          aria-expanded={openMenu === "recent"}
          onclick={() => toggleMenu("recent")}
        >
          <History size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>最近</span>
        </button>
        {#if openMenu === "recent"}
          <div class="dropdown-menu" role="menu" tabindex="-1" transition:popupTransition={{ duration: 150 }} onkeydown={handleMenuKeydown}>
            <span class="menu-label">最近打开</span>
            {#if recentFiles.length}
              {#each recentFiles.slice(0, maxRecentFiles) as file, index (file.path)}
                <div
                  class="recent-menu-row"
                  role="none"
                  onpointerenter={() => { hoveredRecentPath = file.path; }}
                  onpointerleave={() => { if (hoveredRecentPath === file.path) hoveredRecentPath = null; }}
                  onfocusin={() => { focusedRecentPath = file.path; }}
                  onfocusout={(event) => clearRecentRowFocus(file.path, event)}
                >
                  <button
                    role="menuitem"
                    class="recent-menu-item"
                    data-recent-open-index={index}
                    title={displayPath(file.path)}
                    onclick={() => { openMenu = null; void openPath(file.path); }}
                  >
                    <FileText size={16} /><span class="recent-menu-copy"><span class="recent-menu-name">{file.name}</span><span class="recent-menu-path"><bdi dir="ltr">{recentDirectoryLabel(file)}</bdi></span></span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="recent-menu-remove"
                    aria-label={"从最近记录移除 " + displayPath(file.path)}
                    title="从最近记录移除"
                    aria-hidden={!isRecentRemoveVisible(file.path)}
                    tabindex={isRecentRemoveVisible(file.path) ? 0 : -1}
                    onclick={(event) => { event.stopPropagation(); removeRecentFile(file.path, index); }}
                  >
                    <X size={16} />
                  </button>
                </div>
              {/each}
              <button role="menuitem" class="muted-menu-item" onclick={clearRecentFiles}>
                <Trash2 size={16} /><span>清空记录</span>
              </button>
            {:else}
              <div class="recent-menu-empty" role="status">暂无最近打开的文档</div>
              <button role="menuitem" onclick={() => void openFiles()}>
                <FolderOpen size={16} /><span>打开文件…</span><kbd>Ctrl+O</kbd>
              </button>
            {/if}
          </div>
        {/if}
      </div>
      <button
        class="titlebar-action settings-toggle"
        aria-label={settingsOpen ? "关闭设置" : "设置"}
        title={settingsOpen ? "关闭设置" : undefined}
        aria-controls="settings-panel"
        aria-pressed={settingsOpen}
        onclick={toggleSettings}
      >
        <Settings size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>设置</span>
      </button>
    </div>

    <div class="tab-drag-space drag-region" data-tauri-drag-region></div>

    {#if activeTab && !settingsOpen}
    <div class="toolbar-right">
      {#if activeTab && !activeTab.loading && !activeTab.error}
        <div class="document-controls" role="group" aria-label="文档工具">
          <div class="document-navigation-actions" role="group" aria-label="文档导航">
            <div class="menu-wrap search-menu-wrap">
              <button
                class="tool-button"
                aria-label="查找当前文档"
                title="查找当前文档 (Ctrl+F)"
                aria-expanded={activeTab.editing ? undefined : searchOpen}
                aria-controls={searchOpen && !activeTab.editing ? "reader-search-popover" : undefined}
                onclick={() => { if (activeTab?.editing) editorComponent?.toggleSearch(); else toggleReaderSearch(); }}
              >
                <Search size={16} aria-hidden="true" />
              </button>
              {#if searchOpen && !activeTab.editing}
                <div
                  id="reader-search-popover"
                  class="search-popover"
                  role="search"
                  aria-label="查找当前文档"
                  transition:popupTransition={{ duration: 160 }}
                >
                  <div class="search-popover-header">
                    <div class="search-popover-title"><Search size={16} aria-hidden="true" /><strong>查找</strong></div>
                    <button class="search-close" aria-label="关闭查找" title="关闭查找" onclick={closeSearch}><X size={16} /></button>
                  </div>
                  <div class="search-popover-body">
                    <div class="search-box search-popover-field">
                      <Search size={16} aria-hidden="true" />
                      <input bind:this={searchInput} bind:value={searchQuery} placeholder="查找当前文档" aria-label="查找当前文档" onkeydown={handleSearchKeydown} />
                    </div>
                    <div class="search-popover-footer">
                      <span
                        class="search-count"
                        class:search-count-empty={!searchQuery.trim()}
                        class:search-count-has-results={Boolean(searchQuery.trim()) && searchCount > 0}
                        class:search-count-no-results={Boolean(searchQuery.trim()) && searchCount === 0}
                        aria-live="polite"
                        aria-atomic="true"
                      >{searchQuery.trim() ? (searchCount ? activeSearchIndex + 1 + " / " + searchCount : "无匹配结果") : ""}</span>
                      <div class="search-popover-navigation">
                        <button class="search-step" aria-label="上一个匹配项" title="上一个匹配项" disabled={searchCount === 0} onclick={() => moveSearchMatch(-1)}><ChevronLeft size={16} /></button>
                        <button class="search-step" aria-label="下一个匹配项" title="下一个匹配项" disabled={searchCount === 0} onclick={() => moveSearchMatch(1)}><ChevronRight size={16} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
            <button
              class="tool-button"
              aria-label="文档目录"
              title={tocVisible ? "隐藏目录" : "显示目录"}
              aria-pressed={tocVisible}
              onclick={toggleOutlinePanel}
            >
              {#if tocVisible}<PanelLeftClose size={16} aria-hidden="true" />{:else}<PanelLeftOpen size={16} aria-hidden="true" />{/if}
            </button>
          </div>
          <span class="document-controls-divider" aria-hidden="true"></span>
          <button
            class="tool-button"
            aria-label={activeTab.editing ? "切换到阅读模式（当前为编辑）" : "切换到编辑模式（当前为阅读）"}
            title={activeTab.editing ? "切换到阅读" : "切换到编辑"}
            aria-pressed={activeTab.editing}
            onclick={() => void toggleEditing()}
          >
            {#if activeTab.editing}<Pencil size={16} aria-hidden="true" />{:else}<BookOpen size={16} aria-hidden="true" />{/if}
          </button>
        </div>
      {/if}
    </div>
    {/if}
  </nav>

  {#if tabs.length}
    <div class="titlebar-tabs-row">
      {@render documentTabs()}
    </div>
  {/if}

    <div class="titlebar-preferences" role="group" aria-label="显示选项">
      <button
        class="theme-toggle"
        aria-label={darkMode ? "切换到浅色主题" : "切换到深色主题"}
        title={darkMode ? "切换到浅色主题" : "切换到深色主题"}
        aria-pressed={darkMode}
        onclick={() => setTheme(darkMode ? "light" : "dark")}
      >
        {#if darkMode}<Sun size={16} />{:else}<Moon size={16} />{/if}
      </button>
    </div>

    <div class="window-controls" role="group" aria-label="窗口控制">
      <button class="window-minimize" aria-label="最小化" title="最小化" onclick={() => void minimizeWindow()}>
        <Minus size={16} />
      </button>
      <button
        class="window-maximize"
        aria-label={windowMaximized ? "还原窗口" : "最大化窗口"}
        title={windowMaximized ? "还原" : "最大化"}
        onclick={() => void toggleMaximizeWindow()}
      >
        {#if windowMaximized}<Copy size={14} />{:else}<Square size={12} />{/if}
      </button>
      <button class="close-window" aria-label="关闭窗口" title="关闭窗口" onclick={() => void closeWindow()}>
        <X size={16} />
      </button>
    </div>
  </header>

  {#if settingsOpen}
      <section
        class="settings-workspace"
        id="settings-panel"
        bind:this={settingsWorkspace}
        aria-labelledby="settings-title"
        inert={documentInteractionBlocked}
        in:shiftTransition={{ duration: 170, y: -8, scale: 1 }}
        out:shiftTransition={{ duration: 100, y: -8, scale: 1 }}
      >
        <header class="settings-workspace-header">
          <h2 id="settings-title">设置</h2>
          <button
            class="settings-close"
            type="button"
            aria-label="关闭设置"
            title="关闭设置"
            onclick={closeSettings}
          >
            <X size={18} />
          </button>
        </header>

        <div class="settings-workspace-body">
          <div class="settings-nav" role="tablist" aria-label="设置类别" aria-orientation="vertical">
            <button id="settings-tab-appearance" type="button" role="tab" aria-selected={settingsCategory === "appearance"} tabindex={settingsCategory === "appearance" ? 0 : -1} class:active={settingsCategory === "appearance"} onclick={() => (settingsCategory = "appearance")} onkeydown={handleSettingsChoiceKeydown}>阅读外观</button>
            <button id="settings-tab-behavior" type="button" role="tab" aria-selected={settingsCategory === "behavior"} tabindex={settingsCategory === "behavior" ? 0 : -1} class:active={settingsCategory === "behavior"} onclick={() => (settingsCategory = "behavior")} onkeydown={handleSettingsChoiceKeydown}>阅读行为</button>
            <button id="settings-tab-files" type="button" role="tab" aria-selected={settingsCategory === "files"} tabindex={settingsCategory === "files" ? 0 : -1} class:active={settingsCategory === "files"} onclick={() => (settingsCategory = "files")} onkeydown={handleSettingsChoiceKeydown}>文件</button>
            <button id="settings-tab-about" type="button" role="tab" aria-selected={settingsCategory === "about"} tabindex={settingsCategory === "about" ? 0 : -1} class:active={settingsCategory === "about"} onclick={() => (settingsCategory = "about")} onkeydown={handleSettingsChoiceKeydown}>关于</button>
          </div>

          <div class="settings-panel-content" role="tabpanel" id={"settings-panel-" + settingsCategory} aria-labelledby={"settings-tab-" + settingsCategory}>
            {#if settingsCategory === "appearance"}
              <section class="settings-page">
                <h3>阅读外观</h3>
                <div class="settings-control-row">
                  <div class="settings-label"><span>主题</span><small>选择阅读界面的颜色</small></div>
                  <div class="settings-segmented" role="radiogroup" aria-label="主题">
                    <button type="button" role="radio" aria-checked={!darkMode} tabindex={darkMode ? -1 : 0} class:active={!darkMode} onclick={() => setTheme("light")} onkeydown={handleSettingsChoiceKeydown}>浅色</button>
                    <button type="button" role="radio" aria-checked={darkMode} tabindex={darkMode ? 0 : -1} class:active={darkMode} onclick={() => setTheme("dark")} onkeydown={handleSettingsChoiceKeydown}>深色</button>
                  </div>
                </div>
                <div class="settings-control-row">
                  <div class="settings-label"><span>正文字号</span><small>按 1 px 调整，范围 15–25 px</small></div>
                  <div class="font-size-controls">
                    <div class="font-size-stepper" aria-label="正文字号">
                      <button type="button" aria-label="减小字号" title="减小字号" disabled={fontSize <= minFontSize} onclick={() => changeFontSize(-1)}><Minus size={16} /></button>
                      <output aria-live="polite">{fontSize} px</output>
                      <button type="button" aria-label="增大字号" title="增大字号" disabled={fontSize >= maxFontSize} onclick={() => changeFontSize(1)}><Plus size={16} /></button>
                    </div>
                    <button class="settings-button" type="button" title="恢复默认字号（Ctrl+0）" disabled={fontSize === defaultFontSize} onclick={resetReadingFontSize}>恢复默认</button>
                  </div>
                </div>
                <div class="settings-control-row">
                  <div class="settings-label"><span>行距</span><small>即时应用到阅读和 HTML 导出</small></div>
                  <div class="settings-segmented" role="radiogroup" aria-label="行距">
                    <button type="button" role="radio" aria-checked={lineHeight === 1.6} tabindex={lineHeight === 1.6 ? 0 : -1} class:active={lineHeight === 1.6} onclick={() => setReadingLineHeight("1.6")} onkeydown={handleSettingsChoiceKeydown}>紧凑</button>
                    <button type="button" role="radio" aria-checked={lineHeight === 1.8} tabindex={lineHeight === 1.8 ? 0 : -1} class:active={lineHeight === 1.8} onclick={() => setReadingLineHeight("1.8")} onkeydown={handleSettingsChoiceKeydown}>标准</button>
                    <button type="button" role="radio" aria-checked={lineHeight === 2} tabindex={lineHeight === 2 ? 0 : -1} class:active={lineHeight === 2} onclick={() => setReadingLineHeight("2")} onkeydown={handleSettingsChoiceKeydown}>宽松</button>
                  </div>
                </div>
                <div class="settings-preview-wrap">
                    <h4>字号与行距示例</h4>
                  <article class="settings-preview" style={`font-size:${fontSize}px;line-height:${lineHeight}`}>
                    <h5>让文字保持舒适</h5>
                    <p>字号与行距会同步应用到当前文档。长文阅读时，合适的行长和留白更容易保持注意力。</p>
                    <p>行内代码示例：<code>markdown</code></p>
                  </article>
                </div>
              </section>
            {:else if settingsCategory === "behavior"}
              <section class="settings-page">
                <h3>阅读行为</h3>
                <label class="settings-switch-row">
                  <span class="settings-label"><span>启动时恢复上次文件</span><small>恢复已打开文档和上次阅读位置</small></span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={restoreLastSession}
                    checked={restoreLastSession}
                    onchange={(event) => { restoreLastSession = event.currentTarget.checked; savePreferences(); }}
                  />
                </label>
                <label class="settings-switch-row">
                  <span class="settings-label"><span>显示文档目录</span><small>记住目录栏的展开状态</small></span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={tocVisible}
                    checked={tocVisible}
                    onchange={(event) => { tocVisible = event.currentTarget.checked; savePreferences(); }}
                  />
                </label>
                <h4 class="settings-subsection-title">编辑器</h4>
                <label class="settings-switch-row">
                  <span class="settings-label"><span>自动换行</span><small>长行在编辑区内折行显示</small></span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={editorWordWrap}
                    checked={editorWordWrap}
                    onchange={(event) => { editorWordWrap = event.currentTarget.checked; savePreferences(); }}
                  />
                </label>
                <div class="settings-control-row">
                  <div class="settings-label"><span>缩进宽度</span><small>按 Tab 输入的空格数</small></div>
                  <div class="settings-segmented" role="radiogroup" aria-label="缩进宽度">
                    {#each editorIndentWidths as width}
                      <button type="button" role="radio" aria-checked={editorIndentWidth === width} tabindex={editorIndentWidth === width ? 0 : -1} class:active={editorIndentWidth === width} onclick={() => setEditorIndentWidth(width)} onkeydown={handleSettingsChoiceKeydown}>{width} 空格</button>
                    {/each}
                  </div>
                </div>
              </section>
            {:else if settingsCategory === "files"}
              <section class="settings-page">
                <h3>文件</h3>
                <div class="settings-control-row settings-file-setting">
                  <div class="settings-label"><span>默认打开目录</span><small>用作打开文件对话框的初始位置</small></div>
                  <div class="settings-folder-control">
                    <span class="settings-path" dir={defaultOpenDirectory ? "rtl" : "ltr"} title={defaultOpenDirectory || undefined}><bdi dir="ltr">{defaultOpenDirectory || "使用系统默认位置"}</bdi></span>
                    <button class="settings-button" onclick={() => void chooseDefaultOpenDirectory()}>选择文件夹…</button>
                  </div>
                </div>
                <div class="settings-control-row settings-file-setting">
                  <div class="settings-label"><span>Markdown 文件</span><small>为 .md 和 .markdown 设置默认应用</small></div>
                  <button class="settings-button" onclick={() => void openDefaultAppsSettings()}>打开默认应用设置</button>
                </div>
              </section>
            {:else}
              <section class="settings-page settings-about">
                <h3>关于</h3>
                <div class="settings-about-brand">
                  <span class="settings-about-mark"><BookOpen size={22} /></span>
                  <div><strong>LiteMD</strong><small>轻量本地 Markdown 阅读器</small></div>
                </div>
                <div class="settings-about-version"><span>版本</span><span>{appVersion}</span></div>
              </section>
            {/if}
          </div>
        </div>
        {#if notice}
          <div
            class="notice settings-notice"
            class:persistent={noticePersistent}
            role={noticePersistent ? "alert" : "status"}
            aria-live={noticePersistent ? "assertive" : "polite"}
            onpointerenter={handleNoticePointerEnter}
            onpointerleave={handleNoticePointerLeave}
            onfocusin={handleNoticeFocusIn}
            onfocusout={handleNoticeFocusOut}
          >
            {@render noticeContents()}
          </div>
        {/if}
      </section>
  {/if}

  {#if tabContextMenu}
    <div
      class="dropdown-menu tab-context-menu"
      bind:this={tabContextMenuElement}
      role="menu"
      tabindex="-1"
      inert={documentInteractionBlocked}
      style={`left:${tabContextMenu.x}px;top:${tabContextMenu.y}px`}
      transition:popupTransition={{ duration: 150 }}
      onkeydown={handleMenuKeydown}
    >
      <button role="menuitem" onclick={() => { const id = tabContextMenu?.tabId; tabContextMenu = null; if (id) closeTab(id); }}><X size={16} /><span>关闭标签</span></button>
      <button role="menuitem" onclick={() => { const id = tabContextMenu?.tabId; tabContextMenu = null; if (id) void requestCloseTabs(tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)); }}><X size={16} /><span>关闭其他标签</span></button>
      {#if tabs.find((tab) => tab.id === tabContextMenu?.tabId)?.path}
        <div class="menu-divider"></div>
        <button role="menuitem" onclick={() => { const id = tabContextMenu?.tabId; if (id) void copyTabPath(id); }}><Copy size={16} /><span>复制文件路径</span></button>
      {/if}
    </div>
  {/if}



  <section
    class="reader-layout"
    class:settings-hidden={settingsOpen}
    class:with-outline={!!activeTab && tocVisible && !activeTab.loading && !activeTab.error}
    class:external-changed={!!activeTab?.externalChange && !activeTab.loading && !activeTab.error}
    class:dragging-files={draggingFiles}
    aria-hidden={settingsOpen}
    inert={settingsOpen || documentInteractionBlocked}
    style={"--outline-width:" + visibleOutlineWidth + "px"}
  >
    {#if activeTab?.externalChange && !activeTab.loading && !activeTab.error}
      {@const canSaveCopy = isDirty(activeTab) || activeTab.externalChange === "missing"}
      <div class="external-banner" role="status" aria-live="polite">
        <span>
          {#if activeTab.externalChange === "missing"}
            原文件已移动、删除或无法读取。{#if isDirty(activeTab)}未保存修改仍保留在当前窗口。{/if}
          {:else}
            原文件已在其他程序中修改。{#if isDirty(activeTab)}保存前请重新载入或另存为。{/if}
          {/if}
        </span>
        <div>
          <button class={canSaveCopy ? "secondary-button" : "primary-button"} onclick={() => void reloadCurrentFile()}>重新载入</button>
          {#if canSaveCopy}
            <button class="primary-button" onclick={() => void saveActiveTab(true)}>另存为…</button>
          {/if}
        </div>
      </div>
    {/if}

    {#if activeTab && tocVisible && !activeTab.loading && !activeTab.error}
      <aside class="outline-panel" aria-label="文档目录" transition:panelTransition={{ x: -8, duration: 160 }} inert={!tocVisible}>
        <div class="outline-header"><span>文档目录</span></div>
        {#if activeTab.headings.length}
          <nav class="outline-list" aria-label="标题目录" bind:this={outlineList}>
            {#each activeTab.headings as heading (heading.id)}
              <button
                class="outline-item"
                class:root-heading={heading.level === 1}
                class:current={activeHeadingId === heading.id}
                aria-current={activeHeadingId === heading.id ? "location" : undefined}
                style={"--heading-indent:" + ((heading.level - 1) * 12 + 8) + "px"}
                title={heading.title}
                onclick={() => jumpToHeading(heading)}
                onkeydown={handleOutlineKeydown}
              >
                <span>{heading.title}</span>
              </button>
            {/each}
          </nav>
        {:else}
          <p class="outline-empty">此文档没有标题目录</p>
        {/if}
      </aside>
      <div
        class="outline-splitter"
        transition:fadeTransition={{ duration: 120 }}
        inert={!tocVisible}
        role="slider"
        aria-label="调整目录宽度"
        aria-orientation="vertical"
        aria-valuemin={minOutlineWidth}
        aria-valuemax={maxOutlineWidth}
        aria-valuenow={Math.round(visibleOutlineWidth)}
        aria-valuetext={`${Math.round(visibleOutlineWidth)} 像素`}
        tabindex="0"
        onpointerdown={beginOutlineResize}
        onpointermove={resizeOutline}
        onpointerup={finishOutlineResize}
        onpointercancel={finishOutlineResize}
        onkeydown={handleOutlineResizeKeydown}
      ></div>
    {/if}
    {#if !activeTab}
      <section class="empty-workspace" aria-label="空白工作区"></section>
    {:else if activeTab.loading}
      <section class="document-state" role="status">
        <div class="loading-ring" aria-hidden="true"></div>
        <p>正在打开 {activeTab.name}</p>
      </section>
    {:else if activeTab.error}
      <section class="document-state error-state" role="alert">
        <div class="state-icon"><FileText size={22} /></div>
        <h2>无法打开这篇文档</h2>
        <p>{activeTab.error}</p>
        <div class="error-actions">
          <button class="primary-button" onclick={() => void openPath(activeTab.path)}>重试</button>
          <button class="secondary-button" onclick={() => closeTab(activeTab.id)}>关闭标签</button>
        </div>
      </section>
    {:else if activeTab.editing}
      {@const editorInstanceId = activeTab.editorInstanceId}
      <div
        class="editor-workspace"
        in:fadeTransition={{ duration: 120 }}
        role="region"
        aria-label="Markdown 源码编辑器"
      >
        <div class="editor-viewport">
          {#key editorInstanceId}
            <MarkdownEditor
              bind:this={editorComponent}
              value={activeTab.source}
              editorState={activeTab.editorState}
              editorCompartments={activeTab.editorCompartments}
              cursor={activeTab.cursor}
              editorScrollProgress={activeTab.editorScrollProgress}
              darkMode={darkMode}
              wordWrap={editorWordWrap}
              indentWidth={editorIndentWidth}
              selectionToolbarEnabled={!tabContextMenu}
              onCursorChange={(cursor, line) =>
                handleEditorCursorChange(editorInstanceId, cursor, line)
              }
              onScrollPositionChange={(scrollTop, progress) =>
                handleEditorScrollPositionChange(editorInstanceId, scrollTop, progress)}
              onSave={(saveAs) => void saveActiveTab(saveAs)}
              onEditorStateChange={(state, compartments, documentChanged) =>
                handleEditorStateChange(editorInstanceId, state, compartments, documentChanged)}
            />
          {/key}
        </div>
      </div>
    {:else}
      <div class="reader-viewport" role="region" aria-label="文档内容" tabindex="-1" in:fadeTransition={{ duration: 120 }} bind:this={readerViewport} onscroll={handleReaderScroll} use:bindFontZoomWheel>
        <article
          class="reader-content"
          bind:this={readerContent}
          style={"font-size:" + fontSize + "px"}
          use:interceptReaderLinks
          use:bindReaderTableScrollbars={activeTab.html}
        >
          {@html activeTab.html}
        </article>
      </div>
    {/if}
    {#if activeTab?.editing && !activeTab.loading && !activeTab.error}
      <div class="print-document" aria-hidden="true">
        <article class="reader-content" style={"font-size:" + fontSize + "px"}>
          {@html activeTab.html}
        </article>
      </div>
    {/if}
  </section>

  {#if pendingCloseIds.length || pendingConfirmation}
    <div class="modal-backdrop">
      <div class="modal-backdrop-shade" aria-hidden="true" in:fadeTransition={{ duration: 160 }} out:fadeTransition={{ duration: 100 }}></div>
      <div
        class="confirm-dialog"
        class:action-confirm-dialog={pendingConfirmation !== null}
        bind:this={confirmationDialog}
        role="alertdialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby={pendingConfirmation ? "action-confirm-title" : "close-confirm-title"}
        aria-describedby={pendingConfirmation ? "action-confirm-description" : "close-confirm-description"}
        in:shiftTransition={{ duration: 160 }}
        out:shiftTransition={{ duration: 100 }}
        onkeydown={handleConfirmDialogKeydown}
      >
        <div class="confirm-content">
          {#if pendingConfirmation}
            <h2 id="action-confirm-title">{pendingConfirmation.title}</h2>
            <p id="action-confirm-description">{pendingConfirmation.message}</p>
          {:else}
            {@const unsavedTabs = tabs.filter((tab) => pendingCloseIds.includes(tab.id) && isDirty(tab))}
            <h2 id="close-confirm-title">
              {unsavedTabs.length === 1 ? "保存对“" + unsavedTabs[0].name + "”的修改？" : "保存这些文档的修改？"}
            </h2>
            <p id="close-confirm-description">选择“不保存”会丢弃尚未保存的修改。</p>
            {#if unsavedTabs.length > 1}
              <ul class="pending-document-list">
                {#each unsavedTabs as tab (tab.id)}
                  <li>{tab.name}</li>
                {/each}
              </ul>
            {/if}
          {/if}
          {#if notice}
            <div
              class="notice confirm-notice"
              class:persistent={noticePersistent}
              role={noticePersistent ? "alert" : "status"}
              aria-live={noticePersistent ? "assertive" : "polite"}
              onpointerenter={handleNoticePointerEnter}
              onpointerleave={handleNoticePointerLeave}
              onfocusin={handleNoticeFocusIn}
              onfocusout={handleNoticeFocusOut}
            >
              {@render noticeContents()}
            </div>
          {/if}
        </div>
        <div class="dialog-actions" class:close-confirm-actions={!pendingConfirmation}>
          {#if pendingConfirmation}
            {#if pendingConfirmation.tone === "danger"}
              <button class="danger-button" data-confirm-action onclick={() => resolveActionConfirmation(true)}>{pendingConfirmation.confirmLabel}</button>
              <button class="secondary-button" data-cancel-confirm onclick={() => resolveActionConfirmation(false)}>取消</button>
            {:else}
              <button class="secondary-button" data-cancel-confirm onclick={() => resolveActionConfirmation(false)}>取消</button>
              <button class="primary-button" data-confirm-action onclick={() => resolveActionConfirmation(true)}>{pendingConfirmation.confirmLabel}</button>
            {/if}
          {:else}
            <button class="danger-button" disabled={closeSaveInProgress} onclick={() => void resolvePendingClose("discard")}>不保存</button>
            <button class="secondary-button" data-cancel-close disabled={closeSaveInProgress} onclick={cancelPendingClose}>取消</button>
            <button class="primary-button save-close-button" data-save-close aria-busy={closeSaveInProgress} disabled={closeSaveInProgress} onclick={() => void resolvePendingClose("save")}>
              {#if closeSaveInProgress}
                <span class="button-spinner" aria-hidden="true"></span>
                <span>正在保存…</span>
              {:else}
                <span>{closeAfterConfirmation ? "保存并退出" : "保存并关闭"}</span>
              {/if}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if zoomedImage}
    <div class="image-zoom-backdrop" role="dialog" aria-modal="true" aria-label={zoomedImage.alt || "图片预览"} tabindex="-1" onkeydown={handleImagePreviewKeydown} onclick={handleImagePreviewClick}>
      <div class="image-zoom-backdrop-shade" aria-hidden="true" in:fadeTransition={{ duration: 160 }} out:fadeTransition={{ duration: 100 }}></div>
      <button class="image-zoom-close" bind:this={imageZoomClose} aria-label="关闭图片预览" title="关闭图片预览" onclick={closeImagePreview} in:shiftTransition={{ duration: 160 }} out:shiftTransition={{ duration: 100 }}>
        <X size={20} />
      </button>
      <img src={zoomedImage.src} alt={zoomedImage.alt || "图片预览"} in:shiftTransition={{ duration: 160 }} out:shiftTransition={{ duration: 100 }} />
      {#if notice}
        <div
          class="notice image-preview-notice"
          class:persistent={noticePersistent}
          role={noticePersistent ? "alert" : "status"}
          aria-live={noticePersistent ? "assertive" : "polite"}
          onpointerenter={handleNoticePointerEnter}
          onpointerleave={handleNoticePointerLeave}
          onfocusin={handleNoticeFocusIn}
          onfocusout={handleNoticeFocusOut}
        >
          {@render noticeContents()}
        </div>
      {/if}
    </div>
  {/if}

  {#if notice && !settingsOpen && !pendingCloseIds.length && !pendingConfirmation && !zoomedImage}
    <div
      class="notice"
      class:persistent={noticePersistent}
      role={noticePersistent ? "alert" : "status"}
      aria-live={noticePersistent ? "assertive" : "polite"}
      transition:popupTransition={{ duration: 160 }}
      onpointerenter={handleNoticePointerEnter}
      onpointerleave={handleNoticePointerLeave}
      onfocusin={handleNoticeFocusIn}
      onfocusout={handleNoticeFocusOut}
    >
      {@render noticeContents()}
    </div>
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  :global(body) {
    font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif;
    font-size: 15px;
    font-weight: 400;
    text-rendering: optimizeLegibility;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  .app-shell {
    position: relative;
    --ease-out: cubic-bezier(0.333333, 1, 0.666667, 1);
    --titlebar-height: 48px;
    --toolbar-inline-padding: 16px;
    --radius-control: 6px;
    --radius-popover: 10px;
    --radius-dialog: 12px;
    --duration-interaction: 100ms;
    --duration-press-in: 80ms;
    --duration-press-out: 150ms;
    --duration-surface: 160ms;
    --duration-theme: 160ms;
    --ease-theme: cubic-bezier(0.2, 0, 0.2, 1);
    --window-bg: #f5f6f8;
    --chrome-bg: #f3f4f6;
    --sidebar-bg: #f6f7f9;
    --surface: #ffffff;
    --reading-surface: #ffffff;
    --surface-muted: #f1f3f6;
    --surface-highlight: rgba(255, 255, 255, 0.7);
    --text: #252830;
    --muted: #353b45;
    --subtle: #3d444f;
    --disabled: #4b535f;
    --line: #e2e5ea;
    --line-strong: #818a99;
    --accent: #3d5bc3;
    --accent-secondary: #23877f;
    --accent-foreground: #ffffff;
    --accent-hover: #324ca8;
    --accent-pressed: #2b4192;
    --accent-soft: #ebefff;
    --selected-bg: #ebefff;
    --selection-bg: #dce4ff;
    --hover: #e9edf3;
    --pressed: #dde3ec;
    --error: #b42332;
    --error-bg: #fff0f2;
    --error-pressed-bg: #f9d7db;
    --modal-backdrop: rgba(25, 32, 50, 0.3);
    --image-backdrop: rgba(0, 0, 0, 0.84);
    --window-close-hover-bg: #d8343d;
    --window-close-pressed-bg: #b42332;
    --success: #236645;
    --success-bg: #ecf7f0;
    --warning: #805900;
    --warning-bg: #fff6db;
    --code-bg: #f1f3f6;
    --code-comment: #626875;
    --code-keyword: #7546a3;
    --code-string: #286345;
    --code-number: #8d4b24;
    --code-title: #285a94;
    --search-hit-bg: #fff0b8;
    --search-hit-text: #493b16;
    --search-hit-current-bg: #f3ce66;
    --search-hit-current-outline: rgba(53, 40, 5, 0.72);
    --shadow-popover: 0 4px 16px rgba(25, 32, 50, 0.12);
    --shadow-dialog: 0 16px 48px rgba(25, 32, 50, 0.18);
    --shadow: var(--shadow-popover);
    color-scheme: light;
    display: grid;
    grid-template-rows: var(--titlebar-height) minmax(0, 1fr);
    width: 100vw;
    height: 100vh;
    min-width: 0;
    color: var(--text);
    background: var(--window-bg);
    overflow: hidden;
  }

  .app-shell.with-workspace-tabs {
    --titlebar-height: 86px;
  }

  .app-shell.window-resize-hover,
  .app-shell.window-resize-hover :global(*) {
    cursor: var(--window-resize-cursor) !important;
  }

  .app-shell.dark {
    color-scheme: dark;
    --window-bg: #181a20;
    --chrome-bg: #202229;
    --sidebar-bg: #202229;
    --surface: #24272f;
    --reading-surface: #1b1d23;
    --surface-muted: #252932;
    --surface-highlight: rgba(255, 255, 255, 0.04);
    --text: #e6e8ee;
    --muted: #adb3c0;
    --subtle: #9199a8;
    --disabled: #8d95a3;
    --line: #323640;
    --line-strong: #707989;
    --accent: #a7b8ff;
    --accent-secondary: #77c9bd;
    --accent-foreground: #1d263e;
    --accent-hover: #bcc8ff;
    --accent-pressed: #94a7f1;
    --accent-soft: #303a59;
    --selected-bg: #303a59;
    --selection-bg: #3d4f7e;
    --hover: #30343e;
    --pressed: #3a404d;
    --error: #ff9ca8;
    --error-bg: #44262e;
    --error-pressed-bg: #5b303a;
    --modal-backdrop: rgba(0, 0, 0, 0.48);
    --image-backdrop: rgba(0, 0, 0, 0.9);
    --success: #91d5aa;
    --success-bg: #223a2b;
    --warning: #e8c56a;
    --warning-bg: #3b321d;
    --code-bg: #252932;
    --code-comment: #a4adbd;
    --code-keyword: #ccaff2;
    --code-string: #92d3aa;
    --code-number: #eab48a;
    --code-title: #9ac5f0;
    --search-hit-bg: #594a23;
    --search-hit-text: #fff1bb;
    --search-hit-current-bg: #795b19;
    --search-hit-current-outline: rgba(255, 244, 204, 0.9);
    --shadow-popover: 0 6px 20px rgba(0, 0, 0, 0.28);
    --shadow-dialog: 0 18px 56px rgba(0, 0, 0, 0.42);
    --shadow: var(--shadow-popover);
  }

  .app-shell.no-document-state {
    background: var(--window-bg);
    position: relative;
  }

  .app-shell.dark.no-document-state {
    background: var(--window-bg);
  }

  .app-shell :global(button:focus-visible),
  .app-shell :global(a:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .app-shell :global(button) {
    cursor: pointer;
    transition:
      color var(--duration-interaction) var(--ease-out),
      background-color var(--duration-interaction) var(--ease-out),
      border-color var(--duration-interaction) var(--ease-out),
      opacity var(--duration-interaction) var(--ease-out),
      box-shadow var(--duration-interaction) var(--ease-out),
      transform var(--duration-press-out) var(--ease-out);
  }

  .app-shell :global(button svg) {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    stroke-width: 1.8px;
  }

  .app-shell :global(button:disabled) {
    color: var(--disabled);
    cursor: default;
    opacity: 1;
  }

  .app-shell :global(::selection) {
    color: var(--text);
    background: var(--selection-bg, #dce4ff);
  }

  .app-shell,
  .titlebar,
  .toolbar,
  .tab-shell,
  .reader-layout,
  .outline-panel,
  .settings-workspace,
  .dropdown-menu,
  .search-popover,
  .tab-context-menu,
  .state-icon,
  .reader-viewport,
  .editor-workspace,
  .editor-viewport,
  .confirm-dialog,
  .search-box {
    transition:
      color var(--duration-surface) var(--ease-out),
      background-color var(--duration-surface) var(--ease-out),
      border-color var(--duration-surface) var(--ease-out),
      box-shadow var(--duration-surface) var(--ease-out);
  }

  .app-shell.theme-switching,
  .app-shell.theme-switching :global(*) {
    transition-duration: var(--duration-theme) !important;
    transition-timing-function: var(--ease-theme) !important;
    transition-delay: 0ms !important;
  }

  .titlebar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-rows: 48px;
    align-items: stretch;
    min-width: 0;
    height: var(--titlebar-height);
    background: var(--chrome-bg);
    border-bottom: 1px solid var(--line);
    box-shadow: none;
    user-select: none;
  }

  .app-shell.with-workspace-tabs .titlebar {
    grid-template-rows: 48px 37px;
  }

  .app-shell.window-inactive .tab-shell:not(.selected) .tab-name {
    opacity: 0.98;
  }

  .app-shell.window-inactive .tab-shell:not(.selected) .tab-button > :global(svg),
  .app-shell.window-inactive .tab-close :global(svg),
  .app-shell.window-inactive .titlebar-preferences button :global(svg),
  .app-shell.window-inactive .window-controls button :global(svg) {
    opacity: 0.86;
  }

  .titlebar-action {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: auto;
    height: 32px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    font-size: 14px;
    cursor: pointer;
  }

  .titlebar-action:hover,
  .titlebar-action[aria-pressed="true"] {
    color: var(--text);
    background: var(--hover);
  }

  .titlebar-action[aria-pressed="true"] {
    --button-pressed-bg: var(--accent-soft);
    color: var(--accent);
    background: var(--accent-soft);
  }

  .titlebar-action span {
    white-space: nowrap;
  }

  .settings-workspace {
    position: absolute;
    inset: var(--titlebar-height) 0 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--text);
    background: var(--window-bg);
  }

  .app-shell.settings-open .reader-layout {
    visibility: hidden;
    pointer-events: none;
  }

  .settings-workspace-header {
    display: flex;
    flex: 0 0 60px;
    align-items: center;
    padding: 0 28px;
    border-bottom: 1px solid var(--line);
    background: var(--chrome-bg);
  }

  .settings-workspace-header h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.4;
  }

  .settings-workspace-body {
    display: grid;
    flex: 1 1 auto;
    grid-template-columns: 208px minmax(0, 1fr);
    min-height: 0;
  }

  .settings-notice {
    position: static;
    width: auto;
    max-width: none;
    max-height: min(30vh, 180px);
    margin: 0 24px 16px;
    translate: none;
    box-shadow: none;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 20px 12px;
    border-right: 1px solid var(--line);
    background: var(--sidebar-bg);
  }

  .settings-nav button {
    min-height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }

  .settings-nav button:hover {
    color: var(--text);
    background: var(--hover);
  }

  .settings-nav button.active {
    --button-pressed-bg: var(--selected-bg);
    color: var(--accent);
    background: var(--selected-bg);
    font-weight: 600;
  }

  .settings-panel-content {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 32px 40px;
    scrollbar-color: var(--line-strong) transparent;
    scrollbar-width: thin;
  }

  .settings-page {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }

  .settings-page h3 {
    margin: 0 0 8px;
    color: var(--text);
    font-size: 18px;
    font-weight: 600;
    line-height: 1.5;
  }

  .settings-subsection-title {
    margin: 20px 0 0;
    padding: 18px 0 10px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.45;
  }

  .settings-control-row,
  .settings-switch-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 24px;
    min-width: 0;
    min-height: 72px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }

  .settings-control-row > :last-child,
  .settings-switch-row > input[type="checkbox"] {
    justify-self: end;
  }

  .settings-label {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    gap: 4px;
    color: var(--text);
    font-size: 15px;
  }

  .settings-label small,
  .settings-about-brand small {
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .settings-segmented,
  .font-size-stepper {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    min-height: 36px;
    padding: 1px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .settings-segmented button {
    min-width: 66px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    font-size: 15px;
    cursor: pointer;
  }

  .settings-segmented button:hover {
    color: var(--text);
    background: var(--hover);
  }

  .settings-segmented button.active {
    --button-pressed-bg: var(--selected-bg);
    color: var(--accent);
    background: var(--selected-bg);
    font-weight: 500;
  }

  .font-size-stepper {
    gap: 4px;
    padding: 1px;
  }

  .font-size-controls {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
  }

  .font-size-stepper button {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .font-size-stepper button:hover:not(:disabled) {
    color: var(--text);
    background: var(--hover);
  }

  .font-size-stepper button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .font-size-stepper output {
    min-width: 54px;
    color: var(--text);
    font-size: 15px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .settings-preview-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 24px;
  }

  .settings-preview-wrap h4 {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    font-weight: 500;
  }

  .settings-preview {
    width: 100%;
    padding: 18px 20px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--text);
    background: var(--reading-surface);
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .settings-preview h5 {
    margin: 0 0 0.55em;
    font-size: 1.2em;
    font-weight: 600;
  }

  .settings-preview p {
    margin: 0 0 0.7em;
  }

  .settings-preview p:last-child {
    margin-bottom: 0;
  }

  .settings-preview code {
    padding: 0.15em 0.35em;
    border-radius: 4px;
    background: var(--surface-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 0.9em;
  }

  .settings-switch-row {
    min-height: 56px;
    cursor: pointer;
  }

  .settings-switch-row input[type="checkbox"] {
    position: relative;
    flex: 0 0 40px;
    width: 40px;
    height: 24px;
    margin: 0;
    appearance: none;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--line-strong);
    cursor: pointer;
    transition: background-color 120ms var(--ease-out), border-color 120ms var(--ease-out);
  }

  .settings-switch-row input[type="checkbox"]::after {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(25, 42, 64, 0.22);
    content: "";
    transition: transform 120ms var(--ease-out);
  }

  .settings-switch-row input[type="checkbox"]:checked {
    border-color: var(--accent);
    background: var(--accent);
  }

  .settings-switch-row input[type="checkbox"]:checked::after {
    transform: translateX(16px);
  }

  .settings-switch-row input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .settings-file-setting {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .settings-file-setting > .settings-label {
    grid-column: 1;
  }

  .settings-file-setting > .settings-button {
    justify-self: end;
  }

  .settings-folder-control {
    display: flex;
    align-items: center;
    gap: 12px;
    grid-column: 2;
    width: 100%;
    min-width: 0;
    max-width: 560px;
    justify-self: end;
  }

  .settings-path {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
    text-align: left;
    text-overflow: ellipsis;
    unicode-bidi: isolate;
    white-space: nowrap;
  }

  .settings-button {
    flex: 0 0 auto;
  }

  .settings-about-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0 16px;
  }

  .settings-about-mark {
    display: grid;
    flex: 0 0 40px;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 8px;
    color: var(--accent-foreground);
    background: var(--accent);
  }

  .settings-about-brand > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-about-brand strong {
    font-size: 16px;
    font-weight: 600;
  }

  .settings-about-version {
    display: flex;
    justify-content: space-between;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 14px;
  }

  .drag-region {
    -webkit-app-region: drag;
  }

  .tab-strip {
    display: flex;
    flex: 1 1 180px;
    align-items: center;
    min-width: 112px;
    max-width: none;
    gap: 2px;
    height: 100%;
    padding: 0 4px;
    overflow: visible;
  }

  .tab-scroll-area {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tab-scroll-area::-webkit-scrollbar {
    display: none;
  }

  .tab-strip.drag-region,
  .tab-scroll-area {
    -webkit-app-region: drag;
  }

  .tab-list,
  .tab-overflow-wrap {
    -webkit-app-region: no-drag;
  }

  .tab-list {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 0;
    width: max-content;
    max-width: 100%;
    height: 100%;
    margin-inline: 0;
    gap: 2px;
    -webkit-app-region: no-drag;
  }

  .tab-overflow-wrap {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    height: 100%;
  }

  .tab-overflow-trigger {
    flex: 0 0 32px;
    width: 32px;
    padding: 0;
  }

  .tab-overflow-trigger :global(svg) {
    width: 16px;
    height: 16px;
  }

  .tab-shell {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 auto;
    width: 200px;
    min-width: 112px;
    max-width: 220px;
    height: 36px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 6px 6px 0 0;
    color: var(--muted);
    transition: color var(--duration-interaction) var(--ease-out), background-color var(--duration-interaction) var(--ease-out);
  }

  .tab-shell.selected {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 5%, var(--reading-surface));
    border-bottom-color: var(--accent);
  }

  .tab-shell:not(.selected):hover {
    background: var(--hover);
  }

  .tab-shell.drop-before::after,
  .tab-shell.drop-after::after {
    position: absolute;
    top: 5px;
    bottom: 5px;
    z-index: 1;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
    content: "";
    pointer-events: none;
  }

  .tab-shell.drop-before::after {
    left: -2px;
  }

  .tab-shell.drop-after::after {
    right: -2px;
  }

  .tab-button,
  .tab-close,
  .titlebar-preferences button,
  .window-controls button,
  .tool-button,
  .search-step,
  .search-close,
  .settings-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    color: inherit;
    background: transparent;
    cursor: pointer;
  }

  .tab-button {
    justify-content: flex-start;
    flex: 1;
    min-width: 0;
    height: 100%;
    container-type: inline-size;
    gap: 8px;
    padding: 0 4px 0 11px;
    border-radius: inherit;
    color: inherit;
    text-align: left;
  }

  .tab-button :global(svg) {
    flex: 0 0 auto;
    color: var(--subtle);
  }

  .selected .tab-button :global(svg) {
    color: var(--accent);
  }

  .tab-copy {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 0;
    overflow: hidden;
    gap: 4px;
  }

  .tab-copy.has-directory-hint {
    flex: 1 1 auto;
    gap: 2px;
  }

  .tab-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-directory-hint {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 76px;
    overflow: hidden;
    color: var(--subtle);
    font-size: 13px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @container (max-width: 136px) {
    .tab-directory-hint {
      display: none;
    }
  }

  .dirty-indicator,
  .external-indicator {
    flex: 0 0 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dirty-indicator {
    background: var(--accent);
  }

  .external-indicator {
    background: var(--warning);
  }

  .tab-shell .tab-button {
    cursor: default;
  }

  .tab-close {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    margin-right: 5px;
    border-radius: var(--radius-control);
    opacity: 0;
  }

  .app-shell .tab-shell .tab-button:focus-visible:not(:disabled),
  .app-shell .tab-shell .tab-close:focus-visible:not(:disabled) {
    outline-offset: -2px;
  }

  .tab-shell.selected .tab-close,
  .tab-shell:hover .tab-close,
  .tab-shell:focus-within .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    color: var(--text);
    background: var(--hover);
    opacity: 1;
  }

  .tab-loading {
    position: absolute;
    right: 30px;
    bottom: 0;
    left: 9px;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
  }

  .tab-loading::after {
    position: absolute;
    inset: 0 auto 0 0;
    width: 38%;
    background: var(--accent);
    content: "";
    transform: translateX(0);
    animation: loading-progress 1.15s linear infinite;
  }

  @keyframes loading-progress {
    from { transform: translateX(-100%); }
    to { transform: translateX(265%); }
  }

  .titlebar-preferences button:hover,
  .window-controls button:hover,
  .tool-button:hover:not(:disabled),
  .search-step:hover:not(:disabled),
  .search-close:hover:not(:disabled),
  .settings-close:hover:not(:disabled) {
    color: var(--text);
    background: var(--hover);
  }

  .tool-button[aria-pressed="true"]:not(:disabled),
  .tool-button[aria-expanded="true"]:not(:disabled) {
    --button-pressed-bg: var(--selected-bg);
    color: var(--accent);
    background: var(--selected-bg);
  }

  .tab-drag-space {
    flex: 1;
    min-width: 12px;
    align-self: stretch;
  }

  .titlebar-preferences,
  .window-controls {
    display: flex;
    flex: 0 0 auto;
    align-items: stretch;
    justify-content: flex-end;
  }

  .titlebar-preferences {
    grid-column: 2;
    grid-row: 1;
  }

  .window-controls {
    grid-column: 3;
    grid-row: 1;
  }

  .titlebar-preferences {
    align-items: center;
    padding: 0 4px;
  }

  .titlebar-preferences button {
    color: var(--muted);
  }

  .window-controls button {
    width: 46px;
    flex: 0 0 46px;
    color: var(--muted);
  }

  .titlebar-preferences .theme-toggle {
    align-self: center;
    height: 32px;
    border-radius: var(--radius-control);
  }

  .titlebar-preferences .theme-toggle {
    flex: 0 0 38px;
    width: 38px;
    margin: 0 4px;
  }

  .window-controls button:focus-visible {
    outline-offset: -2px;
  }

  .window-controls .close-window {
    --button-pressed-bg: var(--window-close-pressed-bg);
  }

  .window-controls .close-window:hover {
    color: #fff;
    background: var(--window-close-hover-bg);
  }

  .window-controls .close-window:hover:focus-visible {
    outline-color: #fff;
  }

  .toolbar {
    position: relative;
    z-index: 5;
    display: flex;
    grid-column: 1;
    grid-row: 1;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 0 8px;
    background: transparent;
    box-shadow: none;
  }

  .titlebar-tabs-row {
    grid-column: 1 / -1;
    grid-row: 2;
    display: flex;
    min-width: 0;
    height: 37px;
    border-top: 1px solid var(--line);
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 0;
    gap: 3px;
  }

  .toolbar-left {
    gap: 3px;
  }

  .menu-wrap {
    position: relative;
  }

  .menu-trigger,
  .tool-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .menu-trigger:hover {
    color: var(--text);
    background: var(--hover);
  }

  .menu-trigger[aria-expanded="true"] {
    --button-pressed-bg: var(--accent-soft);
    color: var(--accent);
    background: var(--accent-soft);
  }

  .menu-trigger {
    font-size: 15px;
    font-weight: 400;
  }

  .toolbar-right {
    flex: 0 0 auto;
    min-width: 0;
    gap: 12px;
  }

  .document-navigation-actions {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 0;
    gap: 2px;
  }

  .document-controls {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
  }

  .document-controls-divider {
    flex: 0 0 1px;
    width: 1px;
    height: 18px;
    margin-inline: 2px;
    background: var(--line-strong);
    opacity: 0.45;
  }

  .tool-button {
    width: 36px;
    height: 36px;
    padding: 0;
  }

  .app-shell .settings-nav button:focus-visible,
  .app-shell .settings-segmented button:focus-visible,
  .app-shell .font-size-stepper button:focus-visible,
  .app-shell .theme-toggle:focus-visible {
    outline-offset: -2px;
  }

  .app-shell .toolbar .menu-trigger:focus-visible,
  .app-shell .toolbar .tool-button:focus-visible,
  .app-shell .toolbar .search-step:focus-visible,
  .app-shell .toolbar .search-close:focus-visible {
    outline-offset: -2px;
  }

  .tool-button:disabled {
    color: var(--disabled);
    cursor: default;
    background: transparent;
  }

  .dropdown-menu {
    position: absolute;
    top: 38px;
    left: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 236px;
    max-height: calc(100vh - 64px);
    padding: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--line);
    border-radius: var(--radius-popover);
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    transform-origin: top left;
  }

  .search-popover {
    position: absolute;
    top: 38px;
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    width: min(360px, calc(100vw - 24px));
    max-height: calc(100vh - 64px);
    padding: 0;
    overflow: visible;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: var(--radius-popover);
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    transform-origin: top right;
  }

  .search-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--line);
  }

  .search-popover-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
  }

  .search-popover-title :global(svg) {
    color: var(--accent);
  }

  .search-popover-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }

  .search-popover .search-box {
    width: 100%;
    height: 38px;
    padding: 0 8px 0 10px;
    gap: 7px;
    border-color: var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
  }

  .search-popover .search-box:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .search-popover .search-box > :global(svg) {
    flex: 0 0 16px;
    color: var(--muted);
  }

  .search-popover .search-box input:focus {
    outline: 0;
  }

  .search-popover-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
    gap: 8px;
  }

  .search-popover-footer .search-count {
    flex: 0 0 auto;
    width: auto;
    min-width: 84px;
    font-size: 14px;
    text-align: left;
  }

  .search-popover-footer .search-count-empty {
    visibility: hidden;
  }

  .search-popover-navigation {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .tab-overflow-menu {
    top: 38px;
    right: 0;
    left: auto;
    width: min(360px, calc(100vw - 20px));
    box-sizing: border-box;
    max-height: min(420px, calc(100vh - 64px));
    transform-origin: top right;
  }

  .dropdown-menu .tab-overflow-item {
    align-items: center;
    min-height: 58px;
    gap: 10px;
    padding: 6px 9px;
  }

  .dropdown-menu .tab-overflow-item > :global(svg) {
    align-self: flex-start;
    margin-top: 5px;
  }

  .dropdown-menu .tab-overflow-item > .tab-overflow-copy {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
    white-space: normal;
  }

  .tab-overflow-title-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .tab-overflow-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-overflow-status {
    flex: 0 1 auto;
    max-width: 48%;
    overflow: hidden;
    color: var(--muted);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-overflow-path {
    display: block;
    width: 100%;
    overflow: hidden;
    color: var(--subtle);
    direction: rtl;
    font-size: 14px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .tab-overflow-path > bdi {
    direction: ltr;
  }

  .dropdown-menu .tab-overflow-item[aria-current="page"] {
    background: var(--selected-bg);
  }

  .dropdown-menu .tab-overflow-item[aria-current="page"] > :global(svg) {
    color: var(--accent);
  }

  .tab-context-menu {
    position: fixed;
    width: min(224px, calc(100vw - 16px));
    min-width: 0;
    max-height: calc(100vh - 16px);
  }

  .app-shell .dropdown-menu button:focus-visible:not(:disabled) {
    outline-offset: -2px;
  }

  .dropdown-menu button {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 8px;
    min-height: 32px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--text);
    background: transparent;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }

  .dropdown-menu button:hover:not(:disabled),
  .dropdown-menu button:focus-visible:not(:disabled) {
    background: var(--hover);
  }

  :global(.app-shell .editor-context-menu button:focus-visible:not(:disabled)) {
    outline-offset: -2px;
  }

  .dropdown-menu button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .dropdown-menu button:disabled:hover {
    background: transparent;
  }

  .dropdown-menu button :global(svg) {
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
    stroke-width: 1.8px;
    color: var(--muted);
  }

  .dropdown-menu button:disabled :global(svg) {
    color: var(--disabled);
  }

  .toolbar :global(svg) {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    stroke-width: 1.8px;
  }

  .toolbar .menu-trigger :global(svg),
  .toolbar .settings-toggle :global(svg) {
    width: 16px;
    height: 16px;
    stroke-width: 1.8px;
  }

  .dropdown-menu button:not(.recent-menu-item) > span:nth-child(2) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-overflow-menu .tab-overflow-item > .tab-overflow-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    text-overflow: clip;
    white-space: normal;
  }

  .dropdown-menu kbd {
    margin-inline-start: auto;
    color: var(--subtle);
    font-size: 14px;
    font-family: inherit;
    white-space: nowrap;
  }

  .dropdown-menu button:disabled kbd {
    color: var(--disabled);
  }

  .menu-divider {
    height: 1px;
    margin: 5px 3px;
    background: var(--line);
  }

  .menu-label {
    padding: 5px 9px 4px;
    color: var(--subtle);
    font-size: 14px;
    font-weight: 500;
  }

  .dropdown-menu .recent-menu-empty {
    padding: 8px 9px 10px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .dropdown-menu .recent-menu-item {
    flex: 1;
    min-width: 0;
    min-height: 68px;
    gap: 10px;
    padding: 6px 9px;
  }

  .dropdown-menu .recent-menu-row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    border-radius: var(--radius-control);
  }

  .dropdown-menu .recent-menu-remove {
    display: grid;
    flex: 0 0 32px;
    place-items: center;
    width: 32px;
    height: 32px;
    min-height: 32px;
    padding: 0;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .dropdown-menu .recent-menu-remove[aria-hidden="false"],
  .dropdown-menu .recent-menu-row:hover .recent-menu-remove,
  .dropdown-menu .recent-menu-row:focus-within .recent-menu-remove {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }

  .dropdown-menu .recent-menu-remove:hover,
  .dropdown-menu .recent-menu-remove:focus-visible {
    background: var(--hover);
  }

  .dropdown-menu:has(.recent-menu-item) {
    width: min(360px, calc(100vw - 20px));
    box-sizing: border-box;
  }

  .dropdown-menu .recent-menu-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    overflow: hidden;
    white-space: normal;
  }

  .dropdown-menu .recent-menu-name,
  .dropdown-menu .recent-menu-path {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-menu .recent-menu-name {
    color: var(--text);
    font-size: 15px;
    font-weight: 500;
  }

  .dropdown-menu .recent-menu-path {
    color: var(--subtle);
    direction: rtl;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.4;
    text-align: left;
    unicode-bidi: isolate;
  }

  .dropdown-menu .recent-menu-path > bdi {
    direction: ltr;
  }

  .dropdown-menu .muted-menu-item {
    color: var(--muted);
    font-size: 15px;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 7px;
    width: min(400px, calc(100vw - 24px));
    height: 44px;
    padding: 0 5px 0 10px;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-popover);
    color: var(--muted);
    background: var(--surface);
  }

  .search-box input {
    flex: 1;
    width: 100px;
    min-width: 48px;
    padding: 0 5px;
    border: 0;
    border-radius: var(--radius-control);
    outline: 0;
    color: var(--text);
    background: transparent;
  }

  .search-box input::placeholder {
    color: var(--subtle);
  }

  .search-count {
    flex: 0 0 80px;
    width: 80px;
    color: var(--subtle);
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
  }

  .search-step,
  .search-close,
  .settings-close {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-control);
    color: var(--muted);
  }

  .settings-close {
    margin-left: auto;
  }

  .search-step:disabled {
    color: var(--disabled);
    background: transparent;
    cursor: default;
  }

  .reader-layout {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--reading-surface);
  }

  .reader-layout.dragging-files::after {
    position: absolute;
    inset: 12px;
    z-index: 60;
    display: block;
    border: 2px dashed var(--accent);
    border-radius: 8px;
    color: var(--accent);
    background: color-mix(in srgb, var(--window-bg) 96%, var(--accent) 4%);
    content: "";
    pointer-events: none;
    transition: background-color 100ms var(--ease-out), border-color 100ms var(--ease-out);
  }

  .reader-layout.with-outline {
    grid-template-columns: minmax(200px, var(--outline-width)) 8px minmax(0, 1fr);
  }

  /* 目录退出动画期间固定正文列，避免退出中的侧栏把正文挤到下一行 */
  @media (min-width: 821px) {
    .reader-layout:has(> .outline-panel) {
      grid-template-columns: minmax(200px, var(--outline-width)) 8px minmax(0, 1fr);
    }

    .reader-layout:has(> .outline-panel) > .reader-viewport,
    .reader-layout:has(> .outline-panel) > .editor-workspace,
    .reader-layout:has(> .outline-panel) > .document-state,
    .reader-layout:has(> .outline-panel) > .empty-workspace {
      grid-column: 3;
    }
  }

  .reader-layout.external-changed {
    grid-template-rows: min-content minmax(0, 1fr);
  }

  .external-banner {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
    min-height: 48px;
    padding: 6px 18px;
    border-bottom: 1px solid var(--line);
    color: var(--text);
    background: var(--warning-bg);
    font-size: 15px;
    line-height: 1.45;
  }

  .external-banner > span {
    flex: 1 1 280px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .external-banner > div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .external-banner button {
    min-height: 32px;
    margin: 0;
    padding: 0 11px;
    font-size: 15px;
  }

  .outline-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--sidebar-bg);
  }

  .outline-header {
    display: flex;
    flex: 0 0 44px;
    align-items: center;
    padding: 0 16px;
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
  }

  .outline-splitter {
    position: relative;
    z-index: 1;
    width: 8px;
    min-height: 0;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
  }

  .outline-splitter::after {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: var(--line);
    content: "";
  }

  .outline-splitter:hover::after,
  .outline-splitter:focus-visible::after {
    width: 2px;
    background: var(--accent);
  }

  .outline-splitter:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .outline-empty {
    margin: 0;
    padding: 10px 16px;
    color: var(--subtle);
    font-size: 14px;
    line-height: 1.6;
  }

  .outline-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
    overscroll-behavior-y: contain;
    padding: 6px 12px 24px;
  }

  .outline-item {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
    min-height: 32px;
    padding: 5px 6px 5px var(--heading-indent);
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.4;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .outline-item > span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .outline-item:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .outline-item.root-heading {
    color: var(--text);
    font-weight: 500;
  }

  .outline-item.current {
    --button-pressed-bg: var(--selected-bg);
    color: var(--accent);
    background: var(--selected-bg);
    font-weight: 600;
  }

  .outline-item.current::before {
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: 5px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
    content: "";
  }

  .empty-workspace {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 0;
    background: var(--window-bg);
  }

  .document-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  .state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 54px;
    border: 1px solid var(--line);
    border-radius: 16px;
    color: var(--accent);
    background: var(--surface);
  }

  .primary-button,
  .secondary-button,
  .settings-button,
  .danger-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    margin: 0;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }

  .primary-button {
    --button-pressed-bg: var(--accent-pressed);
    border-color: var(--accent);
    color: var(--accent-foreground);
    background: var(--accent);
  }

  .save-close-button {
    gap: 8px;
    min-width: 128px;
    white-space: nowrap;
  }

  .button-spinner {
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 800ms linear infinite;
  }

  .primary-button:hover:not(:disabled) {
    border-color: var(--accent-hover);
    background: var(--accent-hover);
  }

  .secondary-button,
  .settings-button {
    --button-pressed-bg: var(--pressed);
    border-color: transparent;
    color: var(--text);
    background: transparent;
  }

  .secondary-button:hover:not(:disabled),
  .settings-button:hover:not(:disabled) {
    background: var(--hover);
  }

  .danger-button {
    --button-pressed-bg: var(--error-pressed-bg);
    color: var(--error);
    background: transparent;
  }

  .danger-button:hover:not(:disabled) {
    background: var(--error-bg);
  }

  .primary-button:disabled {
    --button-pressed-bg: var(--surface-muted);
    color: var(--disabled);
    background: var(--surface-muted);
  }

  .secondary-button:disabled,
  .settings-button:disabled,
  .danger-button:disabled {
    --button-pressed-bg: transparent;
    color: var(--disabled);
    background: transparent;
  }

  .reader-viewport {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--reading-surface);
    scrollbar-gutter: stable;
    scrollbar-color: var(--line-strong) transparent;
    scrollbar-width: thin;
  }

  .reader-viewport:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .editor-workspace {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--window-bg);
  }

  .print-document {
    display: none;
  }

  .editor-viewport {
    flex: 1 1 auto;
    width: 100%;
    height: auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--surface);
  }

  .reader-content {
    --reader-text-width: 720px;
    --reader-available-width: calc(100% - 64px);
    width: min(var(--reader-available-width), var(--reader-text-width));
    min-height: 100%;
    margin: 0 auto;
    padding: 56px 0 96px;
    box-sizing: border-box;
    border: 0;
    color: var(--text);
    background: transparent;
    font-size: var(--reader-font-size, 20px);
    font-weight: 400;
    line-height: var(--reader-line-height, 1.8);
    overflow-wrap: anywhere;
    user-select: text;
  }

  .reader-content :global(h1),
  .reader-content :global(h2),
  .reader-content :global(h3),
  .reader-content :global(h4),
  .reader-content :global(h5),
  .reader-content :global(h6) {
    color: var(--text);
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0;
    scroll-margin-top: 24px;
  }

  .reader-content :global(h1:first-child),
  .reader-content :global(h2:first-child),
  .reader-content :global(h3:first-child),
  .reader-content :global(h4:first-child),
  .reader-content :global(h5:first-child),
  .reader-content :global(h6:first-child) {
    margin-top: 0;
  }

  .reader-content :global(h1) {
    margin: 1.4em 0 0.78em;
    padding-left: 14px;
    border-left: 3px solid var(--accent);
    font-size: 1.8em;
    line-height: 1.3;
    font-weight: 650;
  }

  .reader-content :global(h2) {
    margin: 1.43em 0 0.57em;
    font-size: 1.4em;
    line-height: 1.4;
    font-weight: 650;
  }

  .reader-content :global(h2)::before {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 10px;
    border-radius: 2px;
    background: var(--accent);
    content: "";
    vertical-align: 0.2em;
  }

  .reader-content :global(h3) {
    margin: 1.33em 0 0.5em;
    font-size: 1.2em;
    line-height: 1.45;
    font-weight: 650;
  }

  .reader-content :global(h4),
  .reader-content :global(h5),
  .reader-content :global(h6) {
    margin: 1.09em 0 0.45em;
    line-height: 1.45;
    font-weight: 600;
  }

  .reader-content :global(h5) {
    margin: 1.2em 0 0.4em;
    line-height: 1.5;
    font-weight: 600;
  }

  .reader-content :global(h6) {
    margin: 1em 0 0.4em;
    color: var(--muted);
    line-height: 1.5;
    font-weight: 600;
  }

  .reader-content :global(h4) {
    font-size: 1.1em;
  }

  .reader-content :global(h5),
  .reader-content :global(h6) {
    font-size: 1em;
  }

  .reader-content :global(p) {
    margin: 0 0 0.9em;
  }

  .reader-content :global(a) {
    color: var(--accent);
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 3px;
  }

  .reader-content :global(a:hover) {
    text-decoration-color: currentColor;
  }

  .reader-content :global(blockquote) {
    margin: 1.25em 0;
    padding: 0.12em 0 0.12em 1.05em;
    border-left: 3px solid var(--accent-secondary);
    color: var(--muted);
  }

  .reader-content :global(blockquote > :last-child) {
    margin-bottom: 0;
  }

  .reader-content :global(ul),
  .reader-content :global(ol) {
    margin: 0 0 1.2em;
    padding-left: 1.55em;
  }

  .reader-content :global(li) {
    padding-left: 0.2em;
  }

  .reader-content :global(li + li) {
    margin-top: 0.22em;
  }

  .reader-content :global(hr) {
    height: 1px;
    margin: 2.5em 0;
    border: 0;
    background: var(--line);
  }

  .reader-content :global(code) {
    padding: 0.15em 0.35em;
    border-radius: 4px;
    color: var(--text);
    background: var(--code-bg);
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 0.9em;
  }

  .reader-content :global(pre) {
    margin: 1.35em 0 1.6em;
    padding: 17px 19px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--code-bg);
    line-height: 1.65;
  }

  .reader-content :global(pre code) {
    display: block;
    padding: 0;
    color: inherit;
    background: transparent;
    font-size: 0.9em;
    white-space: pre;
  }

  .reader-content :global(.reader-code-block) {
    position: relative;
    margin: 1.35em 0 1.6em;
  }

  .reader-content :global(.reader-code-block pre) {
    margin: 0;
    padding-top: 42px;
  }

  .reader-content :global(.reader-code-copy) {
    position: absolute;
    top: 8px;
    right: 9px;
    width: 64px;
    height: 32px;
    padding: 0 8px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    font-size: 14px;
    cursor: pointer;
  }

  .reader-content :global(.reader-code-copy:hover:not(:disabled)) {
    color: var(--text);
    background: var(--hover);
  }

  .reader-content :global(.katex-display) {
    margin: 1.2em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.12em 0;
  }

  .reader-content :global(.katex-error) {
    color: var(--error);
    white-space: normal;
  }

  .reader-content :global(.math-block) {
    margin: 1.2em 0;
  }

  .reader-content :global(.mermaid-block) {
    min-width: 0;
    margin: 1.45em 0 1.7em;
    overflow-x: auto;
    text-align: center;
  }

  .reader-content :global(.mermaid-block > svg) {
    display: block;
    width: auto;
    max-width: 100%;
    max-height: 720px;
    height: auto;
    margin: 0 auto;
  }

  .reader-content :global(.mermaid-source) {
    margin-top: 0.65em;
    color: var(--muted);
    font-size: 14px;
    text-align: left;
  }

  .reader-content :global(.mermaid-source summary) {
    width: fit-content;
    cursor: pointer;
    font-weight: 550;
  }

  .reader-content :global(.mermaid-source pre) {
    margin-top: 0.6em;
  }

  .reader-content :global(.hljs-comment),
  .reader-content :global(.hljs-quote) {
    color: var(--code-comment);
    font-style: italic;
  }

  .reader-content :global(.hljs-keyword),
  .reader-content :global(.hljs-selector-tag),
  .reader-content :global(.hljs-literal),
  .reader-content :global(.hljs-name) {
    color: var(--code-keyword);
  }

  .reader-content :global(.hljs-string),
  .reader-content :global(.hljs-regexp),
  .reader-content :global(.hljs-addition) {
    color: var(--code-string);
  }

  .reader-content :global(.hljs-number),
  .reader-content :global(.hljs-attr),
  .reader-content :global(.hljs-variable),
  .reader-content :global(.hljs-template-variable) {
    color: var(--code-number);
  }

  .reader-content :global(.hljs-title),
  .reader-content :global(.hljs-section),
  .reader-content :global(.hljs-built_in) {
    color: var(--code-title);
  }

  .reader-content :global(.reader-table-block) {
    margin: 1.4em 0 1.8em;
  }

  @media screen {
    .reader-content:has(> :global(.reader-table-block)) {
      width: max-content;
      min-width: min(var(--reader-available-width), var(--reader-text-width));
      max-width: var(--reader-available-width);
    }

    .reader-content:has(> :global(.reader-table-block)) > :global(:not(.reader-table-block)) {
      max-width: var(--reader-text-width);
    }

    .reader-content > :global(.reader-table-block) > :global(.reader-table-wrap) {
      width: max-content;
      min-width: min(100%, var(--reader-text-width));
      max-width: 100%;
    }

    .reader-content :global(.reader-table-scrollbar) {
      position: sticky;
      top: 0;
      z-index: 1;
      height: 18px;
      max-width: 100%;
      margin-inline-start: 1px;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      scrollbar-color: var(--line-strong) transparent;
      background: var(--reading-surface);
    }

    .reader-content :global(.reader-table-scrollbar > div) {
      height: 1px;
    }

    .reader-content :global(.reader-table-block:has(> .reader-table-scrollbar:not([hidden])) > .reader-table-wrap) {
      scrollbar-width: none;
    }
  }

  .reader-content :global(img) {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1.3em auto;
    border-radius: 5px;
    cursor: zoom-in;
  }

  .reader-content :global(a img) {
    cursor: pointer;
  }

  .reader-content :global(mark.reader-search-hit) {
    padding: 0 1px;
    border-radius: 2px;
    outline: 2px solid transparent;
    color: var(--search-hit-text);
    background: var(--search-hit-bg);
  }

  .reader-content :global(mark.reader-search-hit.current) {
    background: var(--search-hit-current-bg);
    outline: 2px solid var(--search-hit-current-outline);
  }

  .dark .reader-content :global(.hljs-comment),
  .dark .reader-content :global(.hljs-quote) {
    color: #a4adbd;
  }

  .dark .reader-content :global(.hljs-keyword),
  .dark .reader-content :global(.hljs-selector-tag),
  .dark .reader-content :global(.hljs-literal),
  .dark .reader-content :global(.hljs-name) {
    color: #ccaff2;
  }

  .dark .reader-content :global(.hljs-string),
  .dark .reader-content :global(.hljs-regexp),
  .dark .reader-content :global(.hljs-addition) {
    color: #92d3aa;
  }

  .dark .reader-content :global(.hljs-number),
  .dark .reader-content :global(.hljs-attr),
  .dark .reader-content :global(.hljs-variable),
  .dark .reader-content :global(.hljs-template-variable) {
    color: #eab48a;
  }

  .dark .reader-content :global(.hljs-title),
  .dark .reader-content :global(.hljs-section),
  .dark .reader-content :global(.hljs-built_in) {
    color: #9ac5f0;
  }

  .reader-content :global(.reader-table-wrap:focus-visible),
  .reader-content :global(.reader-table-scrollbar:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .document-state {
    flex-direction: column;
    gap: 10px;
    padding: 28px;
    color: var(--muted);
    text-align: center;
  }

  .document-state p {
    margin: 0;
    max-width: min(100%, 520px);
    font-size: 15px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .loading-ring {
    width: 24px;
    height: 24px;
    border: 2px solid var(--line-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 800ms linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .app-shell :global(button:active:not(:disabled)) {
    background-color: var(--button-pressed-bg, var(--pressed));
    transform: scale(0.97);
    transition-duration: var(--duration-press-in);
  }

  .app-shell :global(button.primary-button:active:not(:disabled)) {
    border-color: var(--accent-pressed);
  }

  @media (prefers-reduced-motion: reduce) {
    .app-shell {
      --duration-theme: 80ms;
    }

    :global(.app-tooltip) {
      transition: none;
    }

    .tab-loading::after,
    .loading-ring,
    .button-spinner {
      animation: none !important;
    }

    .app-shell :global(button) {
      transition-property: color, background-color, border-color, opacity, box-shadow !important;
      transition-duration: 80ms !important;
      transition-timing-function: ease !important;
    }

    .app-shell :global(button:active:not(:disabled)) {
      transform: none;
    }

    .app-shell,
    .titlebar,
    .toolbar,
    .tab-shell,
    .reader-layout,
    .outline-panel,
    .state-icon,
    .reader-viewport,
    .editor-workspace,
    .editor-viewport,
    .settings-workspace,
    .settings-nav,
    .settings-preview,
    .confirm-dialog,
    .search-box {
      transition-duration: 80ms !important;
      transition-timing-function: ease !important;
    }
  }

  @media (forced-colors: active) {
    :global(.app-tooltip) {
      border-color: ButtonBorder;
      color: CanvasText;
      background: Canvas;
      box-shadow: none;
    }

    .app-shell,
    .app-shell.dark {
      --window-bg: Canvas;
      --chrome-bg: Canvas;
      --sidebar-bg: Canvas;
      --surface: Canvas;
      --reading-surface: Canvas;
      --surface-muted: Canvas;
      --surface-highlight: Canvas;
      --text: CanvasText;
      --muted: CanvasText;
      --subtle: CanvasText;
      --disabled: GrayText;
      --line: ButtonBorder;
      --line-strong: ButtonBorder;
      --accent: Highlight;
      --accent-secondary: Highlight;
      --accent-foreground: HighlightText;
      --accent-hover: Highlight;
      --accent-pressed: Highlight;
      --accent-soft: Canvas;
      --selected-bg: Highlight;
      --selection-bg: Highlight;
      --hover: Canvas;
      --pressed: Canvas;
      --error: CanvasText;
      --error-bg: Canvas;
      --error-pressed-bg: Canvas;
      --modal-backdrop: Canvas;
      --image-backdrop: Canvas;
      --window-close-hover-bg: Highlight;
      --window-close-pressed-bg: Highlight;
      --success: CanvasText;
      --success-bg: Canvas;
      --warning: CanvasText;
      --warning-bg: Canvas;
      --code-bg: Canvas;
      --code-comment: GrayText;
      --code-keyword: LinkText;
      --code-string: VisitedText;
      --code-number: LinkText;
      --code-title: LinkText;
      --search-hit-bg: Mark;
      --search-hit-text: MarkText;
      --search-hit-current-bg: Highlight;
      --search-hit-current-outline: HighlightText;
      --shadow-popover: none;
      --shadow-dialog: none;
    }

    .app-shell :global(button:focus-visible),
    .app-shell :global(a:focus-visible),
    .app-shell .reader-viewport:focus-visible,
    .reader-content :global(.reader-table-wrap:focus-visible),
    .reader-content :global(.reader-table-scrollbar:focus-visible) {
      outline-color: HighlightText;
    }

    .app-shell .settings-nav button.active,
    .app-shell .settings-segmented button.active,
    .app-shell .tool-button[aria-pressed="true"],
    .app-shell .tool-button[aria-expanded="true"],
    .app-shell .titlebar-action[aria-pressed="true"],
    .app-shell .menu-trigger[aria-expanded="true"],
    .app-shell .outline-item.current {
      color: HighlightText;
      background: Highlight;
    }

    .app-shell .window-controls .close-window:hover {
      color: HighlightText;
      background: Highlight;
    }

    .app-shell .window-controls .close-window:hover:focus-visible {
      outline-color: HighlightText;
    }

    .app-shell.window-inactive .tab-shell:not(.selected) .tab-name,
    .app-shell.window-inactive .tab-shell:not(.selected) .tab-button > :global(svg),
    .app-shell.window-inactive .tab-close :global(svg),
    .app-shell.window-inactive .titlebar-preferences button :global(svg),
    .app-shell.window-inactive .window-controls button :global(svg) {
      opacity: 1;
    }

    .reader-content :global(a) {
      color: LinkText;
      text-decoration: underline;
    }
  }

  .error-state h2 {
    margin: 2px 0 0;
    color: var(--text);
    font-size: 20px;
    font-weight: 600;
  }

  .error-state .state-icon {
    border-color: color-mix(in srgb, var(--error) 28%, var(--line));
    color: var(--error);
    background: var(--error-bg);
  }

  .error-state p {
    max-width: 520px;
    overflow-wrap: anywhere;
    line-height: 1.7;
  }

  .state-icon {
    width: 46px;
    height: 46px;
    border-radius: 13px;
  }

  .error-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: transparent;
  }

  .modal-backdrop-shade {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: var(--modal-backdrop);
  }

  .image-zoom-backdrop {
    --image-preview-safe-inset: 56px;
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: var(--image-preview-safe-inset);
    background: transparent;
  }

  .image-zoom-backdrop-shade {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: var(--image-backdrop);
  }

  .image-zoom-backdrop img {
    position: relative;
    z-index: 1;
    max-width: min(
      86vw,
      1440px,
      calc(100vw - var(--image-preview-safe-inset) - var(--image-preview-safe-inset))
    );
    max-height: min(
      82vh,
      calc(100vh - var(--image-preview-safe-inset) - var(--image-preview-safe-inset))
    );
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 20px 70px rgba(0, 0, 0, 0.4);
    transform-origin: center;
  }

  .image-preview-notice {
    position: absolute;
    z-index: 1;
  }

  .image-zoom-close {
    --button-pressed-bg: rgba(255, 255, 255, 0.3);
    position: absolute;
    z-index: 2;
    top: 16px;
    right: 16px;
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: var(--radius-control);
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
    cursor: pointer;
  }

  .image-zoom-close:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .app-shell .image-zoom-close:focus-visible {
    outline-color: #fff;
  }

  @media (forced-colors: active) {
    .app-shell .image-zoom-close:focus-visible {
      outline-color: HighlightText;
    }
  }

  .app-shell .image-zoom-close :global(svg) {
    width: 20px;
    height: 20px;
  }

  .confirm-dialog {
    position: relative;
    z-index: 1;
    width: min(100%, 460px);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: var(--radius-dialog);
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-dialog);
    transform-origin: center;
  }

  .confirm-dialog h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
  }

  .confirm-content {
    min-height: 0;
    overflow: auto;
    overflow-wrap: anywhere;
    overscroll-behavior: contain;
  }

  .confirm-dialog p {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 15px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .confirm-notice {
    position: static;
    width: 100%;
    max-width: none;
    max-height: min(30vh, 180px);
    margin-top: 16px;
    translate: none;
    box-shadow: none;
  }

  .pending-document-list {
    max-height: 150px;
    margin: 12px 0 0;
    padding-left: 21px;
    overflow: auto;
    color: var(--muted);
    font-size: 15px;
  }

  .dialog-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 24px;
  }

  .dialog-actions button:not(.save-close-button) {
    min-width: 72px;
  }

  .close-confirm-actions .danger-button {
    margin-inline-end: auto;
  }

  .dialog-actions .danger-button + .secondary-button {
    margin-inline-start: 12px;
  }

  .dialog-actions button:disabled {
    cursor: default;
  }

  .notice {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 20;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: max-content;
    max-width: min(480px, calc(100vw - 48px));
    max-height: min(50vh, 240px);
    padding: 12px 16px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-popover);
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    font-size: 14px;
    line-height: 1.5;
    translate: -50% 0;
    transform-origin: bottom center;
  }

  .notice > span {
    flex: 1 1 auto;
    min-width: 0;
  }

  .notice > button {
    display: grid;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    place-items: center;
    margin: -6px -8px -5px 0;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .notice > button:hover {
    color: var(--text);
    background: var(--hover);
  }

  :global(.app-tooltip) {
    position: fixed;
    z-index: 40;
    width: max-content;
    max-width: min(280px, calc(100vw - 24px));
    max-height: min(200px, calc(100vh - 24px));
    padding: 6px 10px;
    overflow: auto;
    border: 1px solid var(--tooltip-line, ButtonBorder);
    border-radius: var(--radius-control, 6px);
    color: var(--tooltip-text, CanvasText);
    background: var(--tooltip-surface, Canvas);
    box-shadow: var(--tooltip-shadow, none);
    font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif;
    font-size: 14px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    pointer-events: none;
    transform: translate(-50%, 4px);
    opacity: 0;
    transition:
      opacity 120ms var(--ease-out, cubic-bezier(0.333333, 1, 0.666667, 1)),
      transform 120ms var(--ease-out, cubic-bezier(0.333333, 1, 0.666667, 1));
  }

  :global(.app-tooltip[data-layer="modal"]) {
    z-index: 120;
  }

  :global(.app-tooltip[data-placement="below"]) {
    transform: translate(-50%, -4px);
  }

  :global(.app-tooltip[data-visible="true"]) {
    transform: translate(-50%, 0);
    opacity: 1;
  }

  :global(.app-tooltip[data-placement="right"]) {
    transform: translate(4px, -50%);
  }

  :global(.app-tooltip[data-placement="left"]) {
    transform: translate(-4px, -50%);
  }

  :global(.app-tooltip[data-visible="true"][data-placement="right"]) {
    transform: translate(0, -50%);
  }

  :global(.app-tooltip[data-visible="true"][data-placement="left"]) {
    transform: translate(0, -50%);
  }

  .app-shell.has-modal .notice {
    z-index: 120;
  }

  @media (max-width: 820px) {
    .window-controls button {
      width: 40px;
      flex-basis: 40px;
    }

    .document-controls {
      gap: 3px;
    }

    .titlebar-preferences .theme-toggle {
      width: 36px;
      flex-basis: 36px;
    }

    .app-shell {
      --toolbar-inline-padding: 9px;
    }

    .toolbar {
      padding: 0 var(--toolbar-inline-padding);
    }

    .reader-layout.with-outline {
      grid-template-columns: minmax(0, 1fr);
    }

    .outline-panel {
      display: none;
    }

    .outline-splitter {
      display: none;
    }

    .reader-content {
      padding: 40px 25px 76px;
    }

  }

  @media (max-width: 760px) {
    .settings-workspace-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
    .settings-nav {
      flex-direction: row;
      gap: 4px;
      overflow-x: auto;
      padding: 10px 12px;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
    .settings-nav button { flex: 0 0 auto; }
    .settings-panel-content { padding: 24px; }
    .settings-control-row,
    .settings-switch-row,
    .settings-file-setting { column-gap: 20px; }
  }

  @media (max-width: 560px) {
    .titlebar {
      height: var(--titlebar-height);
    }

    .window-controls button {
      width: 34px;
      flex-basis: 34px;
    }

    .document-controls-divider {
      margin-inline: 1px;
    }

    .titlebar-preferences .theme-toggle {
      width: 34px;
      flex-basis: 34px;
      margin-inline: 2px;
    }

    .tab-shell {
      min-width: 84px;
      max-width: 160px;
    }

    .tab-strip {
      min-width: 0;
    }

    .toolbar-left {
      gap: 1px;
    }

    .menu-trigger {
      padding: 0 6px;
    }

    .toolbar-right {
      gap: 0;
    }

    .tool-button {
      width: 32px;
    }

    .reader-content {
      --reader-available-width: 100%;
      width: 100%;
      margin: 0;
      padding: 32px 19px 64px;
    }

    .settings-workspace-header { flex-basis: 56px; padding: 0 20px; }
    .settings-panel-content { padding: 20px; }
    .toolbar-left .menu-trigger > :global(svg) { display: none; }
    .settings-toggle > :global(svg) { display: none; }
  }

  @media (max-width: 420px) {
    .settings-workspace-header { padding: 0 16px; }
    .settings-panel-content { padding: 18px 16px; }
    .settings-control-row,
    .settings-switch-row { display: flex; align-items: flex-start; flex-direction: column; gap: 10px; }
    .settings-switch-row { flex-direction: row; align-items: center; }
    .settings-page { gap: 0; }
    .settings-folder-control { grid-column: 1; align-items: flex-start; flex-direction: column; }
    .settings-file-setting { grid-template-columns: minmax(0, 1fr); }
    .settings-file-setting > .settings-button { justify-self: stretch; }
    .settings-button { width: 100%; }
    .font-size-controls .settings-button { width: auto; }
  }

  @media print {
    @page {
      margin: 18mm;
    }

    :global(html),
    :global(body) {
      width: auto !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      background: #ffffff !important;
    }

    .app-shell,
    .app-shell.dark {
      --window-bg: #ffffff;
      --surface: #ffffff;
      --reading-surface: #ffffff;
      --surface-muted: #f8f9fb;
      --text: #20242a;
      --muted: #424b57;
      --subtle: #424b57;
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
      display: block !important;
      width: auto !important;
      height: auto !important;
      min-width: 0 !important;
      overflow: visible !important;
      color: #20242a !important;
      background: #ffffff !important;
    }

    .titlebar,
    .toolbar,
    .outline-panel,
    .outline-splitter,
    .external-banner,
    .empty-workspace,
    .document-state,
    .settings-workspace,
    .modal-backdrop,
    .notice,
    .tab-context-menu,
    .editor-workspace {
      display: none !important;
    }

    .reader-content :global(.reader-code-copy),
    .image-zoom-backdrop {
      display: none !important;
    }

    .reader-layout {
      display: block !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      background: #ffffff !important;
    }

    .reader-viewport {
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
    }

    .reader-content {
      width: auto !important;
      max-width: none !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      color: #20242a !important;
      background: #ffffff !important;
      box-shadow: none !important;
    }

    .print-document {
      display: block !important;
      height: auto !important;
      overflow: visible !important;
    }

    .reader-content :global(h1),
    .reader-content :global(h2),
    .reader-content :global(h3),
    .reader-content :global(h4) {
      break-after: avoid-page;
    }

    .reader-content :global(p),
    .reader-content :global(li) {
      orphans: 3;
      widows: 3;
    }

    .reader-content :global(pre) {
      overflow: visible !important;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      break-inside: avoid;
    }

    .reader-content :global(table),
    .reader-content :global(img),
    .reader-content :global(.mermaid-block) {
      break-inside: avoid;
    }

    .reader-content :global(mark.reader-search-hit) {
      color: inherit !important;
      background: transparent !important;
      outline: none !important;
    }

    .reader-content :global(.reader-code-block pre) {
      padding-top: 17px;
    }

    .reader-content :global(.reader-table-wrap) {
      max-width: none;
      overflow: visible;
      border-radius: 0;
    }

    .reader-content :global(.reader-table-scrollbar) {
      display: none;
    }

    .reader-content :global(th),
    .reader-content :global(td) {
      min-width: 0;
      max-width: none;
      padding: 0.3em 0.45em;
    }

    .reader-content :global(.hljs-comment),
    .reader-content :global(.hljs-quote) {
      color: #4d5866 !important;
    }

    .reader-content :global(.hljs-keyword),
    .reader-content :global(.hljs-selector-tag),
    .reader-content :global(.hljs-literal),
    .reader-content :global(.hljs-name) {
      color: #63418e !important;
    }

    .reader-content :global(.hljs-string),
    .reader-content :global(.hljs-regexp),
    .reader-content :global(.hljs-addition) {
      color: #205c3f !important;
    }

    .reader-content :global(.hljs-number),
    .reader-content :global(.hljs-attr),
    .reader-content :global(.hljs-variable),
    .reader-content :global(.hljs-template-variable) {
      color: #87411f !important;
    }

    .reader-content :global(.hljs-title),
    .reader-content :global(.hljs-section),
    .reader-content :global(.hljs-built_in) {
      color: #205984 !important;
    }
  }
</style>

