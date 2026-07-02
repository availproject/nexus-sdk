import { useEffect, useState } from "react";

export type ChartPalette = {
  primary: string;
  primaryLight: string;
  accent: string;
  accentLight: string;
  success: string;
  warning: string;
  danger: string;
  text: string;
  muted: string;
  line: string;
  panel: string;
  panel2: string;
};

const FALLBACK: ChartPalette = {
  primary: "#7c3aed",
  primaryLight: "#a78bfa",
  accent: "#ec4899",
  accentLight: "#f472b6",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  text: "#f3f4f6",
  muted: "#94a3b8",
  line: "rgba(148, 163, 184, 0.22)",
  panel: "#181a20",
  panel2: "#13161c",
};

function readPalette(): ChartPalette {
  if (typeof window === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => {
    const value = cs.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    primary: get("--primary", FALLBACK.primary),
    primaryLight: get("--primary-light", FALLBACK.primaryLight),
    accent: get("--accent", FALLBACK.accent),
    accentLight: get("--accent-light", FALLBACK.accentLight),
    success: get("--success", FALLBACK.success),
    warning: get("--warning", FALLBACK.warning),
    danger: get("--danger", FALLBACK.danger),
    text: get("--text", FALLBACK.text),
    muted: get("--muted", FALLBACK.muted),
    line: get("--line-strong", FALLBACK.line),
    panel: get("--panel", FALLBACK.panel),
    panel2: get("--panel-2", FALLBACK.panel2),
  };
}

/**
 * Returns the resolved CSS-variable palette, refreshed whenever the
 * `<html data-palette=… data-theme=…>` attributes change. Lets recharts
 * stay in sync with the active theme without a hard reload.
 */
export function useChartTheme(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(() => readPalette());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setPalette(readPalette());
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-palette", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
}
