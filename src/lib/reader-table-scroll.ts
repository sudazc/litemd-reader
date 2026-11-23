import type { Action } from "svelte/action";

/** 在溢出的表格顶部提供横向滚动条，正文负责纵向滚动 */
export const bindReaderTableScrollbars: Action<HTMLElement, string> = (article) => {
  const syncByElement = new Map<Element, () => void>();
  const disposers: Array<() => void> = [];
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries) syncByElement.get(target)?.();
  });
  let frame: number | undefined;

  function clearScrollbars() {
    observer.disconnect();
    syncByElement.clear();
    for (const dispose of disposers) dispose();
    disposers.length = 0;
  }

  function connectScrollbars() {
    frame = undefined;
    clearScrollbars();
    for (const block of article.querySelectorAll<HTMLElement>(".reader-table-block")) {
      const wrap = block.querySelector<HTMLElement>(":scope > .reader-table-wrap");
      const table = wrap?.querySelector(":scope > table");
      if (!wrap || !table) continue;

      const scrollbar = article.ownerDocument.createElement("div");
      scrollbar.className = "reader-table-scrollbar";
      scrollbar.hidden = true;
      scrollbar.tabIndex = 0;
      scrollbar.setAttribute("role", "region");
      scrollbar.setAttribute("aria-label", "横向滚动表格");
      const track = article.ownerDocument.createElement("div");
      scrollbar.append(track);
      block.prepend(scrollbar);

      const scrollTable = () => { wrap.scrollLeft = scrollbar.scrollLeft; };
      const scrollBar = () => { scrollbar.scrollLeft = wrap.scrollLeft; };
      const syncSize = () => {
        const { clientWidth, scrollWidth } = wrap;
        scrollbar.hidden = clientWidth === 0 || scrollWidth <= clientWidth;
        if (scrollbar.hidden) return;
        scrollbar.style.width = `${clientWidth}px`;
        track.style.width = `${scrollWidth}px`;
        scrollBar();
      };

      scrollbar.addEventListener("scroll", scrollTable);
      wrap.addEventListener("scroll", scrollBar);
      disposers.push(() => {
        scrollbar.removeEventListener("scroll", scrollTable);
        wrap.removeEventListener("scroll", scrollBar);
        scrollbar.remove();
      });
      syncByElement.set(wrap, syncSize);
      syncByElement.set(table, syncSize);
      observer.observe(wrap);
      observer.observe(table);
      syncSize();
    }
  }

  function scheduleUpdate() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(connectScrollbars);
  }

  scheduleUpdate();
  return {
    update: scheduleUpdate,
    destroy() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearScrollbars();
    },
  };
};
