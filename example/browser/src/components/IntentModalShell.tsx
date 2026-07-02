import { type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  AssetRowIcon,
  ChainDots,
  ChevronIcon,
  type ChainDotItem,
} from "./AssetRow";

/* ── Icons ─────────────────────────────────────────────────────── */

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function GasIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.135 13.578V7.623h.404a.41.41 0 01.404.408v3.788c0 .972.772 1.758 1.73 1.758.956 0 1.729-.786 1.729-1.758V4.534c0-.38-.159-.729-.404-.972l-1.414-1.428a.638.638 0 00-.921 0 .677.677 0 000 .942l.912.933c.337.525.492.7.492 1.73v6.09a.404.404 0 01-.404.408.41.41 0 01-.404-.408V8.04c0-.971-.772-1.758-1.729-1.758h-.395V3.038c0-.603-.474-1.079-1.071-1.079H2.472c-.589 0-1.072.486-1.072 1.079v10.54H1.27a.671.671 0 00-.667.68c0 .378.298.68.667.68h7.998a.671.671 0 00.667-.68.671.671 0 00-.667-.68h-.132zM3.323 3.3h3.89c.324 0 .587.262.587.592v2.866c0 .33-.263.593-.588.593H3.323a.588.588 0 01-.588-.593V3.892c0-.33.263-.592.588-.592z" fill="currentColor"/>
    </svg>
  );
}

export function TokenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zM12.75 6a.75.75 0 00-1.5 0v.816a3.836 3.836 0 00-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 01-.921-.421l-.879-.66a.75.75 0 00-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 001.5 0v-.81a4.124 4.124 0 001.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 00-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 00.933-1.175l-.415-.33a3.836 3.836 0 00-1.719-.755V6z"/>
    </svg>
  );
}

/* ── Intent hero ───────────────────────────────────────────────── */

export type IntentHeroChip = {
  chains: ChainDotItem[];
  countLabel: string;
  totalLabel?: string;
  onClick?: () => void;
};

type IntentHeroProps = {
  amount: string;
  symbol: string;
  usd?: string;
  chainName: string;
  chainLogo?: string;
  tokenLogo?: string;
  /** Extra label above the amount, e.g. an action like "Deposit to Aave V3" */
  eyebrow?: ReactNode;
  /** Extra muted line below the amount, e.g. truncated contract address */
  subline?: ReactNode;
  chip?: IntentHeroChip;
};

export function IntentHero({
  amount,
  symbol,
  usd,
  chainName,
  chainLogo,
  tokenLogo,
  eyebrow,
  subline,
  chip,
}: IntentHeroProps) {
  return (
    <div className="intent-hero">
      {eyebrow && <div className="intent-hero-eyebrow">{eyebrow}</div>}
      <div className="intent-hero-icon">
        <AssetRowIcon
          src={tokenLogo}
          fallback={symbol}
          badge={{ src: chainLogo, fallback: chainName }}
        />
      </div>
      <div className="intent-hero-amount">
        <span className="intent-hero-amount-value">{amount}</span>
        <span className="intent-hero-amount-symbol">{symbol}</span>
      </div>
      <div className="intent-hero-sub">
        {usd && <span>≈ {usd}</span>}
        {usd && <span className="intent-hero-sep">·</span>}
        <span>on {chainName}</span>
      </div>
      {subline && <div className="intent-hero-subline">{subline}</div>}
      {chip && (
        <button
          type="button"
          className="intent-hero-chip"
          onClick={chip.onClick}
          disabled={!chip.onClick}
        >
          <ChainDots chains={chip.chains} />
          <span>{chip.countLabel}</span>
          {chip.totalLabel && (
            <>
              <span className="intent-hero-chip-sep">·</span>
              <span className="intent-hero-chip-total">{chip.totalLabel}</span>
            </>
          )}
          {chip.onClick && (
            <span className="intent-hero-chip-chevron" aria-hidden="true">
              <ChevronIcon open={false} />
            </span>
          )}
        </button>
      )}
    </div>
  );
}

/* ── Line items ────────────────────────────────────────────────── */

type LineItemProps = {
  label: ReactNode;
  /** Small muted line under the label (e.g. "USDC, ETH" or "Network & protocol") */
  sub?: ReactNode;
  value: ReactNode;
  /** Small line under the value (e.g. token-equivalent amount) */
  valueSub?: ReactNode;
  /** "primary" = bigger headline weight (You Swap / You Send).
      "secondary" = quieter (fees, buffer, price impact). Default primary. */
  size?: "primary" | "secondary";
};

export function LineItem({ label, sub, value, valueSub, size = "primary" }: LineItemProps) {
  return (
    <div className={`intent-line intent-line--${size}`}>
      <div className="intent-line-label-block">
        <span className="intent-line-label">{label}</span>
        {sub && <span className="intent-line-sub">{sub}</span>}
      </div>
      <div className="intent-line-value-block">
        <span className="intent-line-value">{value}</span>
        {valueSub && <span className="intent-line-value-sub">{valueSub}</span>}
      </div>
    </div>
  );
}

type LineItemAccordionProps = LineItemProps & {
  defaultOpen?: boolean;
  children: ReactNode;
};

export function LineItemAccordion({
  label,
  sub,
  value,
  valueSub,
  size = "primary",
  defaultOpen = false,
  children,
}: LineItemAccordionProps) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      className={`intent-line intent-line--${size} intent-line--accordion`}
    >
      <div className="intent-line-row">
        <div className="intent-line-label-block">
          <span className="intent-line-label">{label}</span>
          {sub && <span className="intent-line-sub">{sub}</span>}
        </div>
        <div className="intent-line-value-block">
          <span className="intent-line-value">{value}</span>
          {valueSub && <span className="intent-line-value-sub">{valueSub}</span>}
          <Collapsible.Trigger asChild>
            <button type="button" className="intent-line-toggle">
              <span className="intent-line-toggle-label-open">Hide Details</span>
              <span className="intent-line-toggle-label-closed">View Details</span>
              <span className="intent-line-toggle-chevron" aria-hidden="true">
                <ChevronIcon open />
              </span>
            </button>
          </Collapsible.Trigger>
        </div>
      </div>
      <Collapsible.Content className="collapsible-content">
        <div className="intent-line-expanded">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/* ── Coverage row (composite modals) ───────────────────────────── */

type CoverageBar = {
  label: string;
  /** Formatted "Available: X" value — what the user already has. */
  haveLabel: string;
  /** Formatted "Required: X" value — the additional amount still needed
   *  (i.e. `need - have`, not the full need). */
  shortfallLabel: string;
  pct: number;
  icon?: ReactNode;
};

type CoverageRowProps = {
  status: "sufficient" | "shortfall";
  title?: ReactNode;
  detail?: ReactNode;
  bars?: CoverageBar[];
};

export function CoverageRow({ status, title, detail, bars }: CoverageRowProps) {
  return (
    <div className={`coverage-row coverage-row--${status}`}>
      {title && (
        <div className="coverage-row-head">
          <span className="coverage-row-icon" aria-hidden="true">
            {status === "sufficient" ? <CheckIcon /> : <AlertIcon />}
          </span>
          <span className="coverage-row-title">{title}</span>
          {detail && <span className="coverage-row-detail">{detail}</span>}
        </div>
      )}
      {bars && bars.length > 0 && (
        <div className="coverage-bars">
          {bars.map((bar) => (
            <div
              key={bar.label}
              className={`coverage-bar coverage-bar--${bar.pct >= 100 ? "ok" : "low"}`}
            >
              <div className="coverage-bar-label">
                <span className="coverage-bar-label-text">
                  {bar.icon}
                  {bar.label}
                </span>
                {bar.pct < 100 ? (
                  <span className="coverage-bar-ratio">
                    <span>
                      <span className="coverage-bar-ratio-key">Available:</span>{" "}
                      {bar.haveLabel}
                    </span>
                    <span className="coverage-bar-ratio-sep" aria-hidden="true">·</span>
                    <span>
                      <span className="coverage-bar-ratio-key">Required:</span>{" "}
                      {bar.shortfallLabel}
                    </span>
                  </span>
                ) : (
                  <span className="coverage-bar-ok-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                )}
              </div>
              <div className="coverage-bar-track">
                <div
                  className="coverage-bar-fill"
                  style={{ width: `${Math.min(100, Math.max(0, bar.pct))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
