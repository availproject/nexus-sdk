import { useMemo, useState } from "react";
import { formatAmount } from "../lib/format";
import type { SourceOption } from "../lib/types";
import { SourceSelectorModal } from "./SourceSelectorModal";
import { LogoImg } from "./AssetRow";
import { D, sum } from "../lib/math";

type SourceSelectorProps = {
  sources: SourceOption[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
};

type TokenPill = {
  symbol: string;
  tokenLogo?: string;
  count: number;
  selectedFiat: number;
};

function buildPills(sources: SourceOption[], selectedIds: string[]): TokenPill[] {
  const selectedSet = new Set(selectedIds);
  const sorted = [...sources].sort((a, b) => D(b.value).cmp(D(a.value)));
  const map = new Map<string, TokenPill>();
  for (const s of sorted) {
    if (!selectedSet.has(s.id)) continue;
    let pill = map.get(s.symbol);
    if (!pill) {
      pill = { symbol: s.symbol, tokenLogo: s.tokenLogo, count: 0, selectedFiat: 0 };
      map.set(s.symbol, pill);
    }
    pill.count += 1;
    pill.selectedFiat = D(pill.selectedFiat).plus(s.value).toNumber();
  }
  return [...map.values()].sort((a, b) => b.selectedFiat - a.selectedFiat);
}

function PillLogo({ src, fallback }: { src?: string; fallback: string }) {
  return (
    <span className="src-pill-logo" aria-hidden="true">
      <LogoImg src={src} fallback={fallback} />
    </span>
  );
}

export function SourceSelector({ sources, selectedIds, onSelect }: SourceSelectorProps) {
  const [open, setOpen] = useState(false);

  const totalFiat = useMemo(() => {
    const active = selectedIds.length === 0
      ? sources
      : sources.filter((s) => selectedIds.includes(s.id));
    return sum(active.map((s) => s.value)).toNumber();
  }, [sources, selectedIds]);

  const pills = useMemo(() => buildPills(sources, selectedIds), [sources, selectedIds]);
  const showPills = selectedIds.length > 0 && pills.length > 0;

  return (
    <div className="field field-full">
      <span className="source-selector-label">
        <span>Selected sources</span>
        {sources.length > 0 && (
          <span className="source-selector-total">${formatAmount(totalFiat, 2)}</span>
        )}
      </span>
      {sources.length === 0 ? (
        <div className="empty-state compact">No balances available.</div>
      ) : (
        <>
          <button
            type="button"
            className="src-trigger"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            {showPills ? (
              <span className="src-trigger-pills">
                {pills.map((p) => (
                  <span key={p.symbol} className="src-pill">
                    <PillLogo src={p.tokenLogo} fallback={p.symbol} />
                    <span className="src-pill-chain">{p.symbol}</span>
                    <span className="src-pill-sep">·</span>
                    <span className="src-pill-tokens">
                      {p.count} chain{p.count === 1 ? "" : "s"}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="src-trigger-placeholder">All sources</span>
            )}
            <span className="src-trigger-edit">
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
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Edit
            </span>
          </button>
          <SourceSelectorModal
            open={open}
            onOpenChange={setOpen}
            sources={sources}
            selectedIds={selectedIds}
            onApply={onSelect}
          />
        </>
      )}
    </div>
  );
}
