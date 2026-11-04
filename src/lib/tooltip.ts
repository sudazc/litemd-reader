/** 为窗口内带有 title 的控件显示统一样式的工具提示 */
export function tooltipLayer(node: HTMLElement) {
  const titleByTarget = new WeakMap<HTMLElement, string>();
  let hoverTarget: HTMLElement | null = null;
  let focusTarget: HTMLElement | null = null;
  let activeTarget: HTMLElement | null = null;
  let suppressedTarget: HTMLElement | null = null;
  let activeSource: "pointer" | "focus" | null = null;
  let activeTooltipId: string | null = null;
  let tooltipElement: HTMLDivElement | null = null;
  let tooltipTimer: number | undefined;
  let nextTooltipId = 0;

  function tooltipTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const titledElement = target.closest<HTMLElement>("[title]");
    if (titledElement && node.contains(titledElement)) return titledElement;
    let ancestor: Element | null = target;
    while (ancestor && node.contains(ancestor)) {
      if (ancestor instanceof HTMLElement && titleByTarget.has(ancestor)) return ancestor;
      ancestor = ancestor.parentElement;
    }
    if (activeTarget?.contains(target)) return activeTarget;
    if (hoverTarget?.contains(target)) return hoverTarget;
    if (focusTarget?.contains(target)) return focusTarget;
    return null;
  }

  function takeTitle(target: HTMLElement): string {
    const currentTitle = target.getAttribute("title");
    if (currentTitle) {
      titleByTarget.set(target, currentTitle);
      target.removeAttribute("title");
      return currentTitle;
    }
    return titleByTarget.get(target) ?? "";
  }

  function restoreTitle(target: HTMLElement) {
    const title = titleByTarget.get(target);
    if (title && target.isConnected && !target.hasAttribute("title")) {
      target.setAttribute("title", title);
    }
    titleByTarget.delete(target);
  }

  function removeDescription(target: HTMLElement) {
    if (!activeTooltipId) return;
    const remainingIds = (target.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((id) => id && id !== activeTooltipId);
    if (remainingIds.length) target.setAttribute("aria-describedby", remainingIds.join(" "));
    else target.removeAttribute("aria-describedby");
  }

  function clearTooltipTimer() {
    if (tooltipTimer === undefined) return;
    window.clearTimeout(tooltipTimer);
    tooltipTimer = undefined;
  }

  function hideTooltip() {
    clearTooltipTimer();
    if (activeTarget) removeDescription(activeTarget);
    if (tooltipElement) {
      tooltipElement.remove();
      tooltipElement = null;
    }
    activeTooltipId = null;
    activeSource = null;
  }

  function restoreActiveTarget() {
    if (!activeTarget) return;
    removeDescription(activeTarget);
    restoreTitle(activeTarget);
    activeTarget = null;
    activeTooltipId = null;
  }

  function positionTooltip(target: HTMLElement, tooltip: HTMLDivElement) {
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    const modal = target.closest<HTMLElement>('[aria-modal="true"]');

    if (modal) {
      const modalRect = modal.getBoundingClientRect();
      const leftLeft = targetRect.left - tooltipRect.width - margin;
      const rightLeft = targetRect.right + margin;
      const centerY = Math.min(
        Math.max(
          targetRect.top + targetRect.height / 2,
          modalRect.top + margin + tooltipRect.height / 2,
        ),
        modalRect.bottom - margin - tooltipRect.height / 2,
      );

      if (leftLeft >= modalRect.left + margin) {
        tooltip.style.left = `${leftLeft}px`;
        tooltip.style.top = `${centerY}px`;
        tooltip.dataset.placement = "left";
        return;
      }

      if (rightLeft + tooltipRect.width <= modalRect.right - margin) {
        tooltip.style.left = `${rightLeft}px`;
        tooltip.style.top = `${centerY}px`;
        tooltip.dataset.placement = "right";
        return;
      }

      const minCenterX = modalRect.left + margin + tooltipRect.width / 2;
      const maxCenterX = modalRect.right - margin - tooltipRect.width / 2;
      const centerX = Math.min(Math.max(targetRect.left + targetRect.width / 2, minCenterX), maxCenterX);
      const belowTop = targetRect.bottom + margin;
      const aboveTop = targetRect.top - tooltipRect.height - margin;
      const belowFits = belowTop + tooltipRect.height <= modalRect.bottom - margin;
      const aboveFits = aboveTop >= modalRect.top + margin;

      tooltip.style.left = `${centerX}px`;
      tooltip.style.top = belowFits
        ? `${belowTop}px`
        : aboveFits
          ? `${aboveTop}px`
          : `${Math.min(Math.max(targetRect.top, modalRect.top + margin), modalRect.bottom - margin - tooltipRect.height)}px`;
      tooltip.dataset.placement = belowFits ? "below" : "above";
      return;
    }

    const titlebarActions = target.closest<HTMLElement>(".titlebar-actions");
    if (titlebarActions) {
      const actionsRect = titlebarActions.getBoundingClientRect();
      const left = actionsRect.left - tooltipRect.width - margin;
      if (left >= margin) {
        const centerY = Math.min(
          Math.max(targetRect.top + targetRect.height / 2, margin + tooltipRect.height / 2),
          window.innerHeight - margin - tooltipRect.height / 2,
        );
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${centerY}px`;
        tooltip.dataset.placement = "left";
        return;
      }
    }

    if (
      target.closest(
        '[role="menu"], .dropdown-menu, .tab-context-menu, .editor-context-menu, .outline-list, .recent-list',
      )
    ) {
      const rightLeft = targetRect.right + margin;
      const leftLeft = targetRect.left - tooltipRect.width - margin;
      const minCenterY = margin + tooltipRect.height / 2;
      const maxCenterY = window.innerHeight - margin - tooltipRect.height / 2;
      const centeredY = Math.min(Math.max(targetRect.top + targetRect.height / 2, minCenterY), maxCenterY);
      const upperMenu = target.closest('[role="menu"], .dropdown-menu') && targetRect.top < window.innerHeight * 0.35;
      const aboveCenterY = targetRect.top - margin - tooltipRect.height / 2;
      const centerY = upperMenu && aboveCenterY >= minCenterY ? aboveCenterY : centeredY;

      if (rightLeft + tooltipRect.width <= window.innerWidth - margin) {
        tooltip.style.left = `${rightLeft}px`;
        tooltip.style.top = `${centerY}px`;
        tooltip.dataset.placement = "right";
        return;
      }

      if (leftLeft >= margin) {
        tooltip.style.left = `${leftLeft}px`;
        tooltip.style.top = `${centerY}px`;
        tooltip.dataset.placement = "left";
        return;
      }
    }

    const centerX = targetRect.left + targetRect.width / 2;
    const minX = margin + tooltipRect.width / 2;
    const maxX = window.innerWidth - margin - tooltipRect.width / 2;
    tooltip.style.left = `${Math.min(Math.max(centerX, minX), maxX)}px`;

    const aboveTop = targetRect.top - tooltipRect.height - margin;
    const belowTop = targetRect.bottom + margin;
    const placeAbove = aboveTop >= margin || belowTop + tooltipRect.height > window.innerHeight - margin;
    const top = placeAbove ? aboveTop : belowTop;
    tooltip.dataset.placement = placeAbove ? "above" : "below";
    tooltip.style.top = `${Math.min(Math.max(top, margin), window.innerHeight - tooltipRect.height - margin)}px`;
  }

  function showTooltip(target: HTMLElement, title: string) {
    if (!target.isConnected || activeTarget !== target || suppressedTarget === target) return;
    const rootStyle = window.getComputedStyle(node);
    const tooltip = document.createElement("div");
    const tooltipId = `litemd-tooltip-${++nextTooltipId}`;
    tooltip.id = tooltipId;
    tooltip.className = "app-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.dataset.layer = target.closest('[aria-modal="true"]') ? "modal" : "global";
    tooltip.textContent = title;
    tooltip.style.setProperty("--tooltip-text", rootStyle.getPropertyValue("--text").trim());
    tooltip.style.setProperty("--tooltip-surface", rootStyle.getPropertyValue("--surface").trim());
    tooltip.style.setProperty("--tooltip-line", rootStyle.getPropertyValue("--line").trim());
    tooltip.style.setProperty("--tooltip-shadow", rootStyle.getPropertyValue("--shadow-popover").trim());
    tooltip.style.fontFamily = rootStyle.fontFamily;
    document.body.append(tooltip);

    activeTooltipId = tooltipId;
    tooltipElement = tooltip;
    const describedBy = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", [describedBy, tooltipId].filter(Boolean).join(" "));
    positionTooltip(target, tooltip);
    window.requestAnimationFrame(() => {
      if (tooltipElement === tooltip) tooltip.dataset.visible = "true";
    });
  }

  function scheduleTooltip() {
    if (!activeTarget || suppressedTarget === activeTarget || tooltipElement || tooltipTimer !== undefined) return;
    const target = activeTarget;
    const title = takeTitle(target);
    if (!title) return;
    activeSource = target === hoverTarget ? "pointer" : "focus";
    const delay = target === hoverTarget ? 500 : 300;
    tooltipTimer = window.setTimeout(() => {
      tooltipTimer = undefined;
      showTooltip(target, title);
    }, delay);
  }

  function syncActiveTarget() {
    const hoverHasTooltip = hoverTarget && (hoverTarget.hasAttribute("title") || titleByTarget.has(hoverTarget));
    const focusVisible = focusTarget?.matches(":focus-visible") ?? false;
    const focusHasTooltip =
      focusVisible && focusTarget && (focusTarget.hasAttribute("title") || titleByTarget.has(focusTarget));
    const nextTarget =
      hoverHasTooltip && suppressedTarget !== hoverTarget
        ? hoverTarget
        : focusHasTooltip && suppressedTarget !== focusTarget
          ? focusTarget
          : hoverTarget ?? (focusVisible ? focusTarget : null);
    if (nextTarget !== activeTarget) {
      hideTooltip();
      restoreActiveTarget();
      activeTarget = nextTarget;
    }
    if (!activeTarget) return;
    if (suppressedTarget !== activeTarget) scheduleTooltip();
  }

  function suppressCurrentTooltip() {
    if (!activeTarget) return;
    suppressedTarget = activeTarget;
    hideTooltip();
  }

  function handlePointerOver(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    const nextTarget = tooltipTarget(event.target);
    if (nextTarget === hoverTarget) return;
    hoverTarget = nextTarget;
    if (suppressedTarget && suppressedTarget !== hoverTarget && suppressedTarget !== focusTarget) {
      suppressedTarget = null;
    }
    syncActiveTarget();
  }

  function handlePointerOut(event: PointerEvent) {
    if (!hoverTarget || !(event.target instanceof Node) || !hoverTarget.contains(event.target)) return;
    const nextTarget = tooltipTarget(event.relatedTarget);
    if (nextTarget === hoverTarget) return;
    const previousTarget = hoverTarget;
    const pointerTooltipLost = activeTarget === previousTarget && activeSource === "pointer";
    hoverTarget = nextTarget;
    if (pointerTooltipLost && focusTarget === previousTarget) {
      suppressedTarget = previousTarget;
      hideTooltip();
    } else if (suppressedTarget === previousTarget) {
      suppressedTarget = null;
    }
    syncActiveTarget();
  }

  function handleFocusIn(event: FocusEvent) {
    const nextTarget = tooltipTarget(event.target);
    focusTarget = nextTarget;
    if (suppressedTarget && suppressedTarget !== focusTarget && suppressedTarget !== hoverTarget) {
      suppressedTarget = null;
    }
    syncActiveTarget();
  }

  function handleFocusOut(event: FocusEvent) {
    if (!focusTarget || !(event.target instanceof Node) || !focusTarget.contains(event.target)) return;
    const previousTarget = focusTarget;
    focusTarget = tooltipTarget(event.relatedTarget);
    if (suppressedTarget === previousTarget && focusTarget !== previousTarget && hoverTarget !== previousTarget) {
      suppressedTarget = null;
    }
    syncActiveTarget();
  }

  function handlePointerDown() {
    suppressCurrentTooltip();
  }

  function handleKeyDown(event: KeyboardEvent) {
    suppressCurrentTooltip();

    if (!["Tab", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) return;

    window.requestAnimationFrame(() => {
      if (!focusTarget || suppressedTarget !== focusTarget) return;
      suppressedTarget = null;
      syncActiveTarget();
    });
  }

  function handleScroll() {
    suppressCurrentTooltip();
  }

  function handleResize() {
    if (activeTarget && tooltipElement) positionTooltip(activeTarget, tooltipElement);
  }

  function handleWindowBlur() {
    suppressCurrentTooltip();
  }

  node.addEventListener("pointerover", handlePointerOver);
  node.addEventListener("pointerout", handlePointerOut);
  node.addEventListener("focusin", handleFocusIn);
  node.addEventListener("focusout", handleFocusOut);
  node.addEventListener("pointerdown", handlePointerDown);
  node.addEventListener("keydown", handleKeyDown);
  document.addEventListener("scroll", handleScroll, true);
  window.addEventListener("resize", handleResize);
  window.addEventListener("blur", handleWindowBlur);

  return {
    destroy() {
      node.removeEventListener("pointerover", handlePointerOver);
      node.removeEventListener("pointerout", handlePointerOut);
      node.removeEventListener("focusin", handleFocusIn);
      node.removeEventListener("focusout", handleFocusOut);
      node.removeEventListener("pointerdown", handlePointerDown);
      node.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleWindowBlur);
      hideTooltip();
      restoreActiveTarget();
    },
  };
}
