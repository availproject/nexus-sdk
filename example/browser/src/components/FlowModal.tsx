import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Collapsible from "@radix-ui/react-collapsible";
import { formatTokenBalance } from "@avail-project/nexus-core/utils";
import type {
  ExecutionProgressState,
  NormalizedStep,
  ProgressHeader,
  ProgressResult,
} from "../lib/types";
import type {
  SwapIntentViewModel,
  BridgeIntentViewModel,
  SwapAndExecuteIntentViewModel,
  BridgeAndExecuteIntentViewModel,
} from "../lib/nexus";
import { AssetRowIcon } from "./AssetRow";
import {
  IntentHero,
  LineItem,
  LineItemAccordion,
  CoverageRow,
  GasIcon,
  TokenIcon,
} from "./IntentModalShell";
import { getTokenLogoUrl } from "../lib/logos";
import { D, pctOf, sum, toFixed, trimDp } from "../lib/math";
import { truncateAddress } from "../lib/format";

/* ── Shared icons ─────────────────────────────────────────────────── */

function CheckMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CrossMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/* ── Constants ────────────────────────────────────────────────────── */

const OP_TITLES: Record<ExecutionProgressState["operationType"], string> = {
  swap: "Swap",
  bridge: "Bridge",
  swapAndExecute: "Swap & Execute",
  bridgeAndExecute: "Bridge & Execute",
};

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmt(value: string): string {
  return formatTokenBalance(value, {
    significantDigits: 4,
    maxFractionDigits: 6,
    zeroCompress: true,
    approxTilde: true,
    trimTrailingZeros: true,
  });
}

function durationSeconds(state: ExecutionProgressState): number | null {
  if (!state.startedAt || !state.completedAt) return null;
  return Math.max(0, Math.round((state.completedAt - state.startedAt) / 1000));
}

function formatAgo(now: number, completedAt?: number): string | null {
  if (!completedAt) return null;
  const elapsed = Math.max(0, Math.floor((now - completedAt) / 1000));
  if (elapsed < 60) return `${elapsed} sec ago`;
  const mins = Math.floor(elapsed / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ago`;
}

function statusSubText(step: NormalizedStep): string | undefined {
  if (step.state === "active") {
    // "Approve in wallet" only fires when the SDK explicitly tells us the
    // wallet popup is showing — server-side / on-chain steps (bridge_fill,
    // vault_deposit, destination_swap, request_submission, …) just say
    // "Working…" instead of misleading the user about a wallet prompt.
    if (step.rawState === "wallet_prompted") return "Approve in wallet";
    return "Waiting for confirmation…";
  }
  if (step.state === "submitted") return "Confirming on-chain…";
  return undefined;
}

function formatImpact(value: number): string {
  const abs = Math.abs(value);
  return `${value > 0 ? "-" : "+"}${abs.toFixed(4)}%`;
}

function impactClass(value: number): string {
  if (Math.abs(value) < 0.5) return "intent-impact-low";
  if (value > 2) return "intent-impact-high";
  return "intent-impact-med";
}

/* ── Intent bodies ────────────────────────────────────────────────── */

function SwapIntentBody({ intent }: { intent: SwapIntentViewModel }) {
  const srcTotal = D(intent.sourcesTotal);
  const destValue = D(intent.destination.value);
  const buffer = D(intent.buffer);
  const srcExclBuffer = srcTotal.minus(buffer);
  const impactExclBuffer = srcExclBuffer.gt(0)
    ? srcExclBuffer.minus(destValue).div(srcExclBuffer).mul(100).toNumber()
    : 0;
  const impactInclBuffer = srcTotal.gt(0)
    ? srcTotal.minus(destValue).div(srcTotal).mul(100).toNumber()
    : 0;

  const sourceSymbols = [...new Set(intent.sources.map((s) => s.tokenSymbol))].join(", ");
  const chainDotItems = intent.sources.map((s) => ({
    chainId: s.chainId,
    chainName: s.chainName,
    chainLogo: s.chainLogo,
  }));
  const totalFees = toFixed(sum([intent.buffer, intent.bridgeFees?.total]), 2);

  return (
    <>
      <IntentHero
        amount={fmt(intent.destination.amount)}
        symbol={intent.destination.tokenSymbol}
        usd={`$${intent.destination.value}`}
        chainName={intent.destination.chainName}
        chainLogo={intent.destination.chainLogo ?? undefined}
        tokenLogo={getTokenLogoUrl(
          intent.destination.tokenSymbol,
          undefined,
          intent.destination.chainId,
        )}
        chip={{
          chains: chainDotItems,
          countLabel: `${intent.sources.length} source${intent.sources.length === 1 ? "" : "s"}`,
          totalLabel: `$${intent.sourcesTotal}`,
        }}
      />

      <div className="intent-line-items">
        <LineItemAccordion
          label="You Swap"
          sub={sourceSymbols}
          value={`$${intent.sourcesTotal}`}
        >
          {intent.sources.map((s, i) => (
            <SourceRow key={`${s.chainId}-${s.tokenSymbol}-${i}`} s={s} />
          ))}
        </LineItemAccordion>

        <LineItemAccordion
          size="secondary"
          label="Total Fees"
          sub="Buffer & bridge fees"
          value={`$${totalFees}`}
        >
          <LineItem size="secondary" label="Buffer" value={`$${intent.buffer}`} />
          <LineItem size="secondary" label="Bridge fees" value={`$${intent.bridgeFees?.total ?? "0.00"}`} />
        </LineItemAccordion>

        <LineItemAccordion
          size="secondary"
          label="Price Impact"
          sub={`${intent.destination.tokenSymbol} · estimated`}
          value={
            <span className={impactClass(impactExclBuffer)}>{formatImpact(impactExclBuffer)}</span>
          }
        >
          <LineItem
            size="secondary"
            label="Expected"
            sub="excl. buffer"
            value={<span className={impactClass(impactExclBuffer)}>{formatImpact(impactExclBuffer)}</span>}
          />
          <LineItem
            size="secondary"
            label="Worst case"
            sub="incl. buffer"
            value={<span className={impactClass(impactInclBuffer)}>{formatImpact(impactInclBuffer)}</span>}
          />
        </LineItemAccordion>

        <LineItem
          size="secondary"
          label="Swap Buffer"
          sub="Temporary buffer collected to ensure successful swaps. Excess funds are refunded."
          value={`$${intent.buffer}`}
        />

        {intent.destination.gas && (
          <LineItem
            size="secondary"
            label="Destination gas"
            sub="Native token on destination"
            value={`${fmt(intent.destination.gas.amount)} ${intent.destination.gas.tokenSymbol}`}
            valueSub={`$${intent.destination.gas.value}`}
          />
        )}
      </div>
    </>
  );
}

function BridgeIntentBody({ intent }: { intent: BridgeIntentViewModel }) {
  const sourceSymbols = [...new Set(intent.sources.map((s) => s.tokenSymbol))].join(", ");
  const chainDotItems = intent.sources.map((s) => ({
    chainId: s.chainId,
    chainName: s.chainName,
    chainLogo: s.chainLogo,
  }));

  return (
    <>
      <IntentHero
        amount={fmt(intent.destination.amount)}
        symbol={intent.token.symbol}
        chainName={intent.destination.chainName}
        chainLogo={intent.destination.chainLogo ?? undefined}
        tokenLogo={intent.token.logo ?? getTokenLogoUrl(intent.token.symbol)}
        chip={{
          chains: chainDotItems,
          countLabel: `${intent.sources.length} source${intent.sources.length === 1 ? "" : "s"}`,
          totalLabel: `$${intent.sourcesTotal}`,
        }}
      />

      <div className="intent-line-items">
        <LineItemAccordion label="You Send" sub={sourceSymbols} value={`$${intent.sourcesTotal}`}>
          {intent.sources.map((s, i) => (
            <SourceRow key={`${s.chainId}-${s.tokenSymbol}-${i}`} s={s} />
          ))}
        </LineItemAccordion>

        <LineItemAccordion size="secondary" label="Total Fees" sub="Network & protocol" value={`$${intent.fees.total}`}>
          <LineItem size="secondary" label="CA Gas" value={`$${intent.fees.caGas}`} />
          <LineItem size="secondary" label="Protocol" value={`$${intent.fees.protocol}`} />
          <LineItem size="secondary" label="Solver" value={`$${intent.fees.solver}`} />
        </LineItemAccordion>

        {D(intent.destination.nativeAmount).gt(0) && (
          <LineItem
            size="secondary"
            label="Destination gas"
            sub="Native token on destination"
            value={`${fmt(intent.destination.nativeAmount)} ${intent.destination.nativeToken.symbol}`}
            valueSub={`≈ ${fmt(intent.destination.nativeAmountInToken)} ${intent.token.symbol}`}
          />
        )}
      </div>
    </>
  );
}

function CompositeIntentBody({
  intent,
  actionLabel,
}: {
  intent: SwapAndExecuteIntentViewModel | BridgeAndExecuteIntentViewModel;
  actionLabel?: string;
}) {
  const exec = intent.executeRequirement;
  const hasFunding = intent.kind === "swapAndExecute" ? intent.swapRequired : intent.bridgeRequired;
  const shortfall = hasFunding
    ? intent.kind === "swapAndExecute" && intent.swapRequired
      ? intent.shortfall
      : intent.kind === "bridgeAndExecute" && intent.bridgeRequired
        ? intent.shortfall
        : undefined
    : undefined;

  const tokenSufficient = !hasFunding || !shortfall || D(shortfall.token.amount).lte(0);
  const gasSufficient = !hasFunding || !shortfall || D(shortfall.gas.amount).lte(0);
  const allSufficient = tokenSufficient && gasSufficient;

  const tokenPct = pctOf(intent.available.token.amount, exec.token.amount);
  const gasPct = pctOf(intent.available.gas.amount, exec.gas.amount);

  const funding = intent.kind === "swapAndExecute" ? intent.swap : intent.bridge;
  const showFunding = !allSufficient && funding !== undefined;

  return (
    <>
      <IntentHero
        amount={fmt(exec.token.amount)}
        symbol={exec.token.symbol}
        usd={`$${exec.token.value}`}
        chainName={exec.chainName}
        chainLogo={exec.chainLogo ?? undefined}
        tokenLogo={getTokenLogoUrl(exec.token.symbol)}
        eyebrow={actionLabel ?? "Execute"}
        subline={<span className="intent-hero-contract">{truncateAddress(exec.contractAddress)}</span>}
      />

      <div className="intent-line-items">
        <CoverageRow
          status={allSufficient ? "sufficient" : "shortfall"}
          title={allSufficient ? "Token & gas covered" : undefined}
          bars={[
            {
              label: `${exec.token.symbol}`,
              haveLabel: fmt(intent.available.token.amount),
              shortfallLabel: fmt(shortfall?.token.amount ?? "0"),
              pct: tokenPct,
              icon: <TokenIcon />,
            },
            {
              label: `${exec.gas.symbol}`,
              haveLabel: fmt(intent.available.gas.amount),
              shortfallLabel: fmt(shortfall?.gas.amount ?? "0"),
              pct: gasPct,
              icon: <GasIcon />,
            },
          ]}
        />

        {showFunding && funding && (
          <LineItemAccordion
            label={intent.kind === "swapAndExecute" ? "You Swap" : "You Send"}
            sub={[...new Set(funding.sources.map((s) => s.tokenSymbol))].join(", ")}
            value={`${funding.sources.length} source${funding.sources.length === 1 ? "" : "s"}`}
            defaultOpen
          >
            {funding.sources.map((s, i) => (
              <SourceRow key={`${s.chainId}-${s.tokenSymbol}-${i}`} s={s} />
            ))}
          </LineItemAccordion>
        )}

        <LineItem
          size="secondary"
          label="Gas"
          sub="Execution gas on destination"
          value={`${fmt(exec.gas.amount)} ${exec.gas.symbol}`}
          valueSub={`$${exec.gas.value}`}
        />

        {exec.tokenApproval && (
          <LineItem
            size="secondary"
            label="Approval"
            sub={`Allow contract to spend ${exec.tokenApproval.symbol}`}
            value={`${fmt(exec.tokenApproval.amount)} ${exec.tokenApproval.symbol}`}
          />
        )}

        {showFunding && intent.kind === "swapAndExecute" && intent.swap && (
          <>
            {intent.swap.buffer && (
              <LineItem
                size="secondary"
                label="Swap Buffer"
                sub="Temporary buffer collected to ensure successful swaps. Excess funds are refunded."
                value={`$${intent.swap.buffer}`}
              />
            )}
            {intent.swap.bridgeFees && (
              <LineItem
                size="secondary"
                label="Bridge Fees"
                sub="Network & protocol"
                value={`$${intent.swap.bridgeFees.total}`}
              />
            )}
          </>
        )}

        {showFunding && intent.kind === "bridgeAndExecute" && intent.bridge && (
          <LineItemAccordion size="secondary" label="Total Fees" sub="Network & protocol" value={`$${intent.bridge.fees.total}`}>
            <LineItem size="secondary" label="CA Gas" value={`$${intent.bridge.fees.caGas}`} />
            <LineItem size="secondary" label="Protocol" value={`$${intent.bridge.fees.protocol}`} />
            <LineItem size="secondary" label="Solver" value={`$${intent.bridge.fees.solver}`} />
          </LineItemAccordion>
        )}
      </div>
    </>
  );
}

function SourceRow({
  s,
}: {
  s: { chainId: number; chainName: string; chainLogo: string; tokenSymbol: string; amount: string; value?: string };
}) {
  return (
    <div className="intent-source-row">
      <AssetRowIcon
        src={getTokenLogoUrl(s.tokenSymbol, undefined, s.chainId)}
        fallback={s.tokenSymbol}
        badge={{ src: s.chainLogo, fallback: s.chainName }}
      />
      <span className="intent-source-name">
        <span className="intent-source-symbol">{s.tokenSymbol}</span>
        <span className="intent-source-chain">{s.chainName}</span>
      </span>
      <span className="intent-source-value">
        <span>
          {fmt(s.amount)} {s.tokenSymbol}
        </span>
        {s.value !== undefined && <span className="intent-source-usd">${trimDp(s.value, 6)}</span>}
      </span>
    </div>
  );
}

/* ── Progress bodies ──────────────────────────────────────────────── */

function ProgressHero({ header }: { header?: ProgressHeader }) {
  if (!header) return null;
  return (
    <div className="exec-hero">
      <div className="exec-hero-source-symbols">{header.sourceSymbols}</div>
      <div className="exec-hero-amount">{header.amount}</div>
      <img src="/progress-grid.gif" alt="" className="exec-hero-gif" aria-hidden="true" />
      <div className="exec-hero-dest">
        <AssetRowIcon
          size="sm"
          src={header.destTokenLogo}
          fallback={header.destTokenSymbol}
          badge={{ src: header.destChainLogo, fallback: header.destChainName }}
        />
        <span className="exec-hero-dest-amount">{header.amount}</span>
      </div>
      <div className="exec-hero-dest-chain">on {header.destChainName}</div>
    </div>
  );
}

function SuccessHero({ header, duration }: { header?: ProgressHeader; duration: number | null }) {
  if (!header) return null;
  return (
    <div className="exec-success-hero">
      <div className="exec-success-icon">
        <AssetRowIcon src={header.destTokenLogo} fallback={header.destTokenSymbol} />
        <span className="exec-success-check" aria-hidden="true">
          <CheckMark />
        </span>
      </div>
      <div className="exec-success-eyebrow">You received</div>
      <div className="exec-success-amount">
        <span className="exec-success-amount-value">{header.amount}</span>
        <span className="exec-success-amount-symbol">{header.destTokenSymbol}</span>
      </div>
      <div className="exec-success-meta">
        on {header.destChainName}
        {duration !== null && <> · completed in {duration}s</>}
      </div>
    </div>
  );
}

function FailureHero({
  header,
  kind,
  reason,
}: {
  header?: ProgressHeader;
  kind: "cancelled" | "failed";
  reason?: string;
}) {
  if (!header) return null;
  const eyebrow = kind === "cancelled" ? "You cancelled" : "Funds returned";
  return (
    <div className="exec-success-hero">
      <div className="exec-success-icon">
        <AssetRowIcon src={header.destTokenLogo} fallback={header.destTokenSymbol} />
        <span className={`exec-success-check exec-failure-badge exec-failure-badge--${kind}`} aria-hidden="true">
          <CrossMark />
        </span>
      </div>
      <div className="exec-success-eyebrow">{eyebrow}</div>
      <div className="exec-success-amount">
        <span className="exec-success-amount-value">{header.amount}</span>
        <span className="exec-success-amount-symbol">{header.destTokenSymbol}</span>
      </div>
      <div className="exec-success-meta">
        on {header.destChainName}
        {reason && <> · {reason}</>}
      </div>
    </div>
  );
}

function StepRow({
  step,
  expanded,
  onToggle,
  showToggle,
  now,
}: {
  step: NormalizedStep;
  expanded?: boolean;
  onToggle?: () => void;
  showToggle?: boolean;
  now: number;
}) {
  const isActive = step.state === "active" || step.state === "submitted";
  const isDone = step.state === "done";
  const isFailed = step.state === "failed";
  const isPending = step.state === "pending";

  const sub = isActive
    ? statusSubText(step)
    : isPending
      ? "Waiting"
      : isFailed
        ? step.error
        : (formatAgo(now, step.completedAt) ?? undefined);

  const subClass = isActive
    ? "exec-row-sub exec-row-sub--active"
    : isFailed
      ? "exec-row-sub exec-row-sub--failed"
      : "exec-row-sub";

  return (
    <div className={`exec-row exec-row--${step.state}`}>
      <span className="exec-row-icon" aria-hidden="true">
        {isDone && <CheckMark />}
        {isFailed && <CrossMark />}
        {isActive && <span className="exec-row-spinner" />}
      </span>
      <div className="exec-row-text">
        <div className="exec-row-label">{step.label}</div>
        {sub && <div className={subClass}>{sub}</div>}
      </div>
      {showToggle && onToggle && (
        <button
          type="button"
          className="exec-row-toggle"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </button>
      )}
    </div>
  );
}

function ExecutingBody({
  state,
  expanded,
  setExpanded,
  now,
}: {
  state: ExecutionProgressState;
  expanded: boolean;
  setExpanded: (next: boolean | ((prev: boolean) => boolean)) => void;
  now: number;
}) {
  const steps = state.steps;
  const activeStep = steps.find((s) => s.state === "active" || s.state === "submitted");
  const showToggle = activeStep !== undefined && steps.length > 1;
  const visibleSteps = !activeStep || expanded ? steps : [activeStep];

  return (
    <>
      <ProgressHero header={state.header} />
      <div className="exec-steps">
        {visibleSteps.map((s) => {
          const isActive = s === activeStep;
          return (
            <StepRow
              key={s.id}
              step={s}
              expanded={isActive ? expanded : undefined}
              onToggle={isActive && showToggle ? () => setExpanded((p) => !p) : undefined}
              showToggle={isActive && showToggle}
              now={now}
            />
          );
        })}
      </div>
    </>
  );
}

function SourcesAccordion({ result }: { result: ProgressResult }) {
  const sources = result.sources ?? [];
  if (sources.length === 0) return null;
  return (
    <Collapsible.Root className="exec-result-row exec-result-row--accordion">
      <div className="exec-result-row-head">
        <span className="exec-result-label">You Swapped</span>
        <div className="exec-result-value-block">
          {result.sourcesTotal && <span className="exec-result-value">${result.sourcesTotal}</span>}
          <Collapsible.Trigger asChild>
            <button type="button" className="exec-result-toggle">
              <span>{sources.length} asset{sources.length === 1 ? "" : "s"}</span>
              <span className="exec-result-toggle-chevron" aria-hidden="true">
                <ChevronDown />
              </span>
            </button>
          </Collapsible.Trigger>
        </div>
      </div>
      <Collapsible.Content className="collapsible-content">
        <div className="exec-result-expanded">
          {sources.map((s, i) => (
            <div key={`${s.chainId}-${s.tokenSymbol}-${i}`} className="exec-source-row">
              <AssetRowIcon
                src={s.tokenLogo}
                fallback={s.tokenSymbol}
                badge={{ src: s.chainLogo, fallback: s.chainName }}
              />
              <span className="exec-source-name">
                <span className="exec-source-symbol">{s.tokenSymbol}</span>
                <span className="exec-source-chain">on {s.chainName}</span>
              </span>
              <span className="exec-source-value">
                <span>
                  {s.amount} {s.tokenSymbol}
                </span>
                {s.value && <span className="exec-source-usd">${trimDp(s.value, 6)}</span>}
              </span>
            </div>
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function StepsAccordion({ steps, now }: { steps: NormalizedStep[]; now: number }) {
  if (steps.length === 0) return null;
  return (
    <Collapsible.Root className="exec-result-row exec-result-row--accordion">
      <div className="exec-result-row-head">
        <span className="exec-result-label">Steps</span>
        <div className="exec-result-value-block">
          <Collapsible.Trigger asChild>
            <button type="button" className="exec-result-toggle">
              <span>{steps.length} step{steps.length === 1 ? "" : "s"}</span>
              <span className="exec-result-toggle-chevron" aria-hidden="true">
                <ChevronDown />
              </span>
            </button>
          </Collapsible.Trigger>
        </div>
      </div>
      <Collapsible.Content className="collapsible-content">
        <div className="exec-result-expanded">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} now={now} />
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function CompletedBody({
  state,
  duration,
  now,
}: {
  state: ExecutionProgressState;
  duration: number | null;
  now: number;
}) {
  return (
    <>
      <SuccessHero header={state.header} duration={duration} />
      <div className="exec-steps">
        {state.result && <SourcesAccordion result={state.result} />}
        <StepsAccordion steps={state.steps} now={now} />
        {state.resultLinks.map((link) => (
          <div key={link.href} className="exec-result-row">
            <span className="exec-result-label">{link.label}</span>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="exec-result-link"
            >
              View Explorer
              <ExternalLinkIcon />
            </a>
          </div>
        ))}
        {state.result?.feesTotal && (
          <div className="exec-result-row">
            <span className="exec-result-label">Total Fees</span>
            <span className="exec-result-value">${state.result.feesTotal}</span>
          </div>
        )}
      </div>
    </>
  );
}

function FailedBody({ state }: { state: ExecutionProgressState }) {
  const kind = state.failureKind ?? "failed";
  const reason = state.failureReason;
  const links = state.resultLinks;
  return (
    <>
      <FailureHero header={state.header} kind={kind} reason={reason} />
      <div className="exec-steps">
        {kind === "cancelled" ? (
          <div className="exec-failure-note">
            <div className="exec-failure-note-title">No funds moved</div>
            <div className="exec-failure-note-sub">
              Your wallet was untouched. No gas was charged.
            </div>
          </div>
        ) : (
          <>
            <div className="exec-failure-note">
              <div className="exec-failure-note-title">Transaction failed</div>
              <div className="exec-failure-note-sub">{reason ?? "Something went wrong on-chain."}</div>
            </div>
            {links.map((link) => (
              <div key={link.href} className="exec-result-row">
                <span className="exec-result-label">{link.label}</span>
                <a href={link.href} target="_blank" rel="noreferrer" className="exec-result-link">
                  View Explorer
                  <ExternalLinkIcon />
                </a>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

/* ── FlowModal ────────────────────────────────────────────────────── */

export type FlowPhase = "intent" | "executing" | "completed" | "failed";

export type FlowModalProps = {
  intentType: ExecutionProgressState["operationType"];
  intent:
    | SwapIntentViewModel
    | BridgeIntentViewModel
    | SwapAndExecuteIntentViewModel
    | BridgeAndExecuteIntentViewModel
    | null;
  intentPending: boolean;
  intentRefreshing: boolean;
  intentApproved: boolean;
  onApprove: () => void;
  onDeny: () => void;
  actionLabel?: string;
  progressState: ExecutionProgressState | null;
  onDismissProgress: () => void;
};

export function FlowModal({
  intentType,
  intent,
  intentPending,
  intentRefreshing,
  intentApproved,
  onApprove,
  onDeny,
  actionLabel,
  progressState,
  onDismissProgress,
}: FlowModalProps) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick "X sec ago" labels.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Bridge the brief gap between user-clicked-Confirm and the SDK
  // transitioning to "executing". Without this, intentPending flips to false
  // (resetSwapIntent runs synchronously inside `approve…`) while
  // progressState.phase is still "awaiting_approval" / "intent_building" for
  // a few ms — leaving the modal showing no content. We flag the local
  // transition on Confirm click and clear it once progressState catches up.
  const [pendingTransition, setPendingTransition] = useState(false);

  useEffect(() => {
    if (
      progressState?.phase === "executing" ||
      progressState?.phase === "completed" ||
      progressState?.phase === "failed"
    ) {
      setPendingTransition(false);
    }
  }, [progressState?.phase]);

  const handleApprove = () => {
    setPendingTransition(true);
    onApprove();
  };

  // Derive the current visible phase. Pre-execution SDK phases without an
  // approved intent (preparing / intent_building before the intent hook
  // fires) have no slot — modal stays hidden.
  const phase: FlowPhase | null =
    progressState?.phase === "completed"
      ? "completed"
      : progressState?.phase === "failed"
        ? "failed"
        : progressState?.phase === "executing"
          ? "executing"
          : pendingTransition && progressState !== null
            ? "executing"
            : intentPending
              ? "intent"
              : null;

  // Latch the modal open across the brief gap between intent approval and the
  // SDK transitioning to "executing". Without this, the modal would close for
  // a frame while the SDK is still in `awaiting_approval` / `intent_building`.
  const [isOpen, setIsOpen] = useState(false);
  const intentWasPendingRef = useRef(false);

  // Cross-fade phase content. `displayPhase` lags behind `phase` by ~180ms:
  // when the real phase changes, we mark the body as fading out, wait for the
  // opacity transition, then swap content and fade it back in. Result: the
  // content swap (and any height change) happens while the body is invisible.
  // Skip the cross-fade when phase goes null (modal is closing) so the close
  // animation doesn't drag.
  const TRANSITION_MS = 180;
  const [displayPhase, setDisplayPhase] = useState<FlowPhase | null>(null);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (phase === displayPhase) return;
    if (phase === null) {
      setDisplayPhase(null);
      setFadingOut(false);
      return;
    }
    if (displayPhase === null) {
      // First content arriving — no need to fade out something that isn't
      // visible yet; let the body's fade-in keyframe handle the entrance.
      setDisplayPhase(phase);
      setFadingOut(false);
      return;
    }
    setFadingOut(true);
    const t = setTimeout(() => {
      setDisplayPhase(phase);
      setFadingOut(false);
    }, TRANSITION_MS);
    return () => clearTimeout(t);
  }, [phase, displayPhase]);

  useEffect(() => {
    if (phase !== null) {
      setIsOpen(true);
      if (phase === "intent") intentWasPendingRef.current = true;
    } else if (intentWasPendingRef.current && !intentApproved && progressState === null) {
      // Intent was pending and was denied (not approved). Close the modal.
      setIsOpen(false);
      intentWasPendingRef.current = false;
    } else if (progressState === null && !intentApproved) {
      // Nothing active. Close.
      setIsOpen(false);
    }
  }, [phase, intentApproved, progressState]);

  // Header title — operation name, plus a phase-appropriate suffix.
  const opTitle = OP_TITLES[intentType];
  const titleByPhase: Record<FlowPhase, string> = {
    intent: `Confirm ${opTitle}`,
    executing: opTitle,
    completed: `${opTitle} Complete`,
    failed: opTitle,
  };
  const title = phase ? titleByPhase[phase] : opTitle;

  // Dismissability: intent + completed + failed are dismissable; executing is
  // not (the operation is in flight).
  const isDismissable = phase === "intent" || phase === "completed" || phase === "failed";

  const handleDismiss = () => {
    if (phase === "intent") {
      onDeny();
      setIsOpen(false);
    } else if (phase === "completed" || phase === "failed") {
      onDismissProgress();
      setIsOpen(false);
    }
  };

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay flow-modal-overlay" />
        <Dialog.Content
          className="modal-panel flow-modal-panel modal-content-centered"
          onInteractOutside={(e) => {
            if (!isDismissable) e.preventDefault();
            else handleDismiss();
          }}
          onEscapeKeyDown={(e) => {
            if (!isDismissable) e.preventDefault();
            else handleDismiss();
          }}
        >
          <div className="flow-modal-header">
            <Dialog.Title className="flow-modal-title">{title}</Dialog.Title>
            <div className="flow-modal-header-actions">
              {phase === "intent" && (
                <span
                  className={`intent-refresh-pill${intentRefreshing ? " intent-refresh-pill--active" : ""}`}
                >
                  <span className="intent-refresh-dot" aria-hidden="true" />
                  {intentRefreshing ? "Refreshing…" : "Auto-refresh every 20s"}
                </span>
              )}
              {isDismissable && (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={handleDismiss}
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          </div>

          <div className={`flow-modal-body${fadingOut ? " flow-modal-body--fading" : ""}`}>
            {displayPhase === "intent" && intent && (
              <div className="intent-body-card">
                {intentType === "swap" && <SwapIntentBody intent={intent as SwapIntentViewModel} />}
                {intentType === "bridge" && <BridgeIntentBody intent={intent as BridgeIntentViewModel} />}
                {(intentType === "swapAndExecute" || intentType === "bridgeAndExecute") && (
                  <CompositeIntentBody
                    intent={intent as SwapAndExecuteIntentViewModel | BridgeAndExecuteIntentViewModel}
                    actionLabel={actionLabel}
                  />
                )}
              </div>
            )}
            {displayPhase === "executing" && progressState && (
              <ExecutingBody
                state={progressState}
                expanded={expanded}
                setExpanded={setExpanded}
                now={now}
              />
            )}
            {displayPhase === "completed" && progressState && (
              <CompletedBody
                state={progressState}
                duration={durationSeconds(progressState)}
                now={now}
              />
            )}
            {displayPhase === "failed" && progressState && <FailedBody state={progressState} />}
          </div>

          <div className={`flow-modal-footer${fadingOut ? " flow-modal-footer--fading" : ""}`}>
            {displayPhase === "intent" && (
              <button
                className="intent-button intent-button-primary"
                type="button"
                onClick={handleApprove}
                disabled={intentRefreshing}
              >
                Confirm
              </button>
            )}
            {(displayPhase === "completed" || displayPhase === "failed") && (
              <button
                className="exec-dismiss-button"
                type="button"
                onClick={handleDismiss}
              >
                {displayPhase === "completed" ? "Done" : "Close"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

