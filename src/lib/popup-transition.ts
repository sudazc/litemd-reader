import { cubicOut } from "svelte/easing";
import { fade, fly } from "svelte/transition";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function fadeTransition(node: Element, options: { duration?: number } = {}) {
  const duration = options.duration ?? 120;
  return fade(node, {
    duration: prefersReducedMotion() ? Math.min(duration, 80) : duration,
  });
}

export function panelTransition(
  node: Element,
  options: { duration?: number; x?: number } = {},
) {
  const duration = options.duration ?? 160;
  if (prefersReducedMotion()) {
    return fade(node, { duration: Math.min(duration, 80) });
  }

  return fly(node, {
    x: Math.sign(options.x ?? 8) * Math.min(Math.abs(options.x ?? 8), 8),
    duration,
    easing: cubicOut,
  });
}

export function popupTransition(
  node: Element,
  options: { duration?: number; y?: number } = {},
) {
  const duration = options.duration ?? 150;
  if (prefersReducedMotion()) {
    return fade(node, { duration: Math.min(duration, 80) });
  }

  const distance = options.y ?? 8;

  return {
    duration,
    easing: cubicOut,
    css: (progress: number) => {
      const scale = 0.97 + progress * 0.03;
      const offset = (1 - progress) * distance;
      return `opacity:${progress};transform:translate3d(0,${offset}px,0) scale(${scale});`;
    },
  };
}

export function shiftTransition(
  _node: Element,
  options: { duration?: number; y?: number; scale?: number } = {},
) {
  if (prefersReducedMotion()) return { duration: 0 };

  const distance = options.y ?? 8;
  const initialScale = options.scale ?? 0.98;

  return {
    duration: options.duration ?? 160,
    easing: cubicOut,
    css: (progress: number) => {
      const scale = initialScale + (1 - initialScale) * progress;
      const offset = (1 - progress) * distance;
      return `opacity:${progress};transform:translate3d(0,${offset}px,0) scale(${scale});`;
    },
  };
}
