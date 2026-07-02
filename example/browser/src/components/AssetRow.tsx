import { useEffect, useRef, useState, type ReactNode } from "react";
import { getFallbackTokenLogoDataUri } from "@avail-project/nexus-core";

export type ChainDotItem = {
  chainId: number;
  chainName: string;
  chainLogo: string;
};

/** Returns whether to render the <img> or its fallback. Flips to false if the
    image's onError fires (broken/404 URL). Resets when src changes. */
export function useImageOk(src?: string) {
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [src]);
  return {
    show: Boolean(src) && !errored,
    onError: () => setErrored(true),
  };
}

/**
 * Image with auto-fallback to the SDK's generated circular token logo.
 * If `src` is missing or fails to load, renders a deterministic SVG circle
 * with the symbol's first character (or up to 3 chars) on a gradient.
 * One source of truth for "show this token/chain's icon, gracefully."
 */
export function LogoImg({ src, fallback, className }: { src?: string; fallback: string; className?: string }) {
  const { show, onError } = useImageOk(src);
  const url = show ? src : getFallbackTokenLogoDataUri(fallback);
  return <img className={className} src={url} alt="" onError={show ? onError : undefined} />;
}

function ChainDot({ chain }: { chain: ChainDotItem }) {
  return (
    <span className="chain-dot">
      <LogoImg src={chain.chainLogo} fallback={chain.chainName} />
    </span>
  );
}

export function ChainDots({ chains, max = 3 }: { chains: ChainDotItem[]; max?: number }) {
  const seen = new Set<number>();
  const unique = chains.filter((c) => {
    if (seen.has(c.chainId)) return false;
    seen.add(c.chainId);
    return true;
  });
  const visible = unique.slice(0, max);
  return (
    <span className="chain-dots" aria-hidden="true">
      {visible.map((c) => (
        <ChainDot key={c.chainId} chain={c} />
      ))}
    </span>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: open ? "rotate(180deg)" : undefined,
        transition: "transform 0.2s ease",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Inline icon-only button that copies `value` to the clipboard and flips to a
 * checkmark for 1.5s. Stops click propagation so it can be nested inside a
 * clickable row without firing the row's onClick.
 */
export function CopyButton({ value, label = "Copy address" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function doCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[copy] failed", err);
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    doCopy();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      doCopy();
    }
  }

  // Rendered as a <span role="button"> instead of <button> so it can be safely
  // nested inside parent clickable rows (which are themselves <button>s).
  return (
    <span
      role="button"
      tabIndex={0}
      className={`copy-btn${copied ? " copy-btn--copied" : ""}`}
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </span>
  );
}

export function InfoIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function AssetRowIcon({
  size,
  src,
  fallback,
  badge,
}: {
  size?: "sm";
  src?: string;
  fallback: string;
  /** Optional small overlay in the lower-right — usually a chain logo on top of a token icon. */
  badge?: { src?: string; fallback: string };
}) {
  const sm = size === "sm";
  return (
    <span className={`asset-row-icon${sm ? " asset-row-icon--sm" : ""}`}>
      <LogoImg src={src} fallback={fallback} />
      {badge && (
        <span className="asset-row-icon-badge">
          <LogoImg src={badge.src} fallback={badge.fallback} />
        </span>
      )}
    </span>
  );
}

export function AssetRowMeta({ symbol, sub }: { symbol: ReactNode; sub?: ReactNode }) {
  return (
    <span className="asset-row-meta">
      <span className="asset-row-symbol">{symbol}</span>
      {sub && <span className="asset-row-sub">{sub}</span>}
    </span>
  );
}

export function AssetRowValue({ amount, usd }: { amount: ReactNode; usd?: string }) {
  return (
    <span className="asset-row-value">
      <span className="asset-row-amount">{amount}</span>
      {usd && <span className="asset-row-usd">{usd}</span>}
    </span>
  );
}
