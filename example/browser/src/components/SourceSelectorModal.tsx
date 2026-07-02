import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatAmount } from "../lib/format";
import { D, sum } from "../lib/math";
import type { SourceOption } from "../lib/types";
import {
  AssetRowIcon,
  AssetRowMeta,
  AssetRowValue,
  ChainDots,
  ChevronIcon,
  CopyButton,
  InfoIcon,
} from "./AssetRow";
import { TokenInfoCard } from "./TokenInfoCard";
import { PickerSearch, matchesQuery, type PickerChainOption } from "./PickerSearch";
import { ChainPickerView } from "./ChainPickerView";

type SourceSelectorModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: SourceOption[];
  selectedIds: string[];
  onApply: (ids: string[]) => void;
};

type TokenGroup = {
  symbol: string;
  chainBalances: SourceOption[];
  totalBalance: number;
  totalFiat: number;
};

function groupByToken(sources: SourceOption[]): TokenGroup[] {
  const map = new Map<string, TokenGroup>();
  for (const s of sources) {
    let g = map.get(s.symbol);
    if (!g) {
      g = { symbol: s.symbol, chainBalances: [], totalBalance: 0, totalFiat: 0 };
      map.set(s.symbol, g);
    }
    g.chainBalances.push(s);
    g.totalBalance = D(g.totalBalance).plus(s.balance).toNumber();
    g.totalFiat = D(g.totalFiat).plus(s.value).toNumber();
  }
  for (const g of map.values()) {
    g.chainBalances.sort((a, b) => D(b.value).cmp(D(a.value)));
  }
  return [...map.values()];
}

function sortGroups(groups: TokenGroup[], selectedIds: string[]): TokenGroup[] {
  const selectedSet = new Set(selectedIds);
  const rank = (g: TokenGroup): number =>
    selectedIds.length > 0 && g.chainBalances.some((a) => selectedSet.has(a.id)) ? 0 : 1;
  return [...groups].sort((a, b) => rank(a) - rank(b) || b.totalFiat - a.totalFiat);
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function SourceSelectorModal({
  open,
  onOpenChange,
  sources,
  selectedIds,
  onApply,
}: SourceSelectorModalProps) {
  const allIds = useMemo(() => sources.map((s) => s.id), [sources]);

  const [draft, setDraft] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [orderedGroups, setOrderedGroups] = useState<TokenGroup[]>([]);
  const [query, setQuery] = useState("");
  const [chainFilter, setChainFilter] = useState<number | null>(null);
  const [view, setView] = useState<"main" | "chains">("main");

  useEffect(() => {
    if (!open) return;
    setDraft(selectedIds.length === 0 ? allIds : selectedIds);
    setExpanded(new Set());
    setOrderedGroups(sortGroups(groupByToken(sources), selectedIds));
    setQuery("");
    setChainFilter(null);
    setView("main");
    // Snapshot ordering on open so the list doesn't reshuffle as the user toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const availableChains = useMemo<PickerChainOption[]>(() => {
    const seen = new Map<number, string>();
    for (const s of sources) {
      if (!seen.has(s.chainId)) seen.set(s.chainId, s.chainName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources]);

  const selectedChain = chainFilter !== null
    ? availableChains.find((c) => c.id === chainFilter) ?? null
    : null;

  const filteredGroups = useMemo(() => {
    if (!query && chainFilter === null) return orderedGroups;
    return orderedGroups
      .map((g) => {
        const filteredBalances = g.chainBalances.filter((b) => {
          if (chainFilter !== null && b.chainId !== chainFilter) return false;
          if (!matchesQuery(query, g.symbol, b.chainName, b.tokenAddress)) return false;
          return true;
        });
        if (filteredBalances.length === 0) return null;
        const totalFiat = sum(filteredBalances.map((b) => b.value)).toNumber();
        const totalBalance = sum(filteredBalances.map((b) => b.balance)).toNumber();
        return { ...g, chainBalances: filteredBalances, totalFiat, totalBalance };
      })
      .filter((g): g is TokenGroup => g !== null);
  }, [orderedGroups, query, chainFilter]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  const totalFiat = useMemo(
    () =>
      sum(sources.filter((s) => draftSet.has(s.id)).map((s) => s.value)).toNumber(),
    [sources, draftSet],
  );

  function toggleBalance(id: string) {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  function toggleToken(group: TokenGroup) {
    const ids = group.chainBalances.map((a) => a.id);
    const allSelected = ids.every((id) => draftSet.has(id));
    setDraft((prev) => {
      if (allSelected) {
        const remove = new Set(ids);
        return prev.filter((id) => !remove.has(id));
      }
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return [...next];
    });
  }

  function toggleExpanded(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  function handleApply() {
    if (draft.length === 0) return;
    const isAll = draft.length === allIds.length;
    onApply(isAll ? [] : draft);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-panel src-modal-panel modal-content-centered">
          {view === "chains" ? (
            <ChainPickerView
              chains={availableChains}
              selected={chainFilter}
              onApply={(id) => {
                setChainFilter(id);
                setView("main");
              }}
              onBack={() => setView("main")}
            />
          ) : (
          <>
          <div className="modal-header src-modal-header">
            <div className="src-modal-title">
              <Dialog.Title className="modal-title">Choose assets to send</Dialog.Title>
              <p className="src-modal-subtitle">Select token and chain</p>
            </div>
            <Dialog.Close asChild>
              <button className="ghost-button" type="button" title="Close" aria-label="Close">
                <CloseIcon />
              </button>
            </Dialog.Close>
          </div>

          <div className="src-summary">
            <span className="src-summary-text">
              {draft.length} of {allIds.length} selected
              <span className="bal-dim">${formatAmount(totalFiat, 2)}</span>
            </span>
            <div className="src-summary-actions">
              <button
                type="button"
                className="src-link"
                onClick={() => setDraft(allIds)}
                disabled={draft.length === allIds.length}
              >
                Select all
              </button>
              <button
                type="button"
                className="src-link"
                onClick={() => setDraft([])}
                disabled={draft.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <PickerSearch
            query={query}
            onQueryChange={setQuery}
            chains={availableChains}
            selectedChain={selectedChain}
            onOpenChainPicker={() => setView("chains")}
          />

          <div className="modal-body src-modal-body">
            {orderedGroups.length === 0 ? (
              <p className="modal-empty">No balances available.</p>
            ) : filteredGroups.length === 0 ? (
              <p className="picker-empty">No matches for current filters.</p>
            ) : (
              <div className="src-list">
                {filteredGroups.map((g) => {
                  const ids = g.chainBalances.map((a) => a.id);
                  const selectedCount = ids.reduce(
                    (n, id) => (draftSet.has(id) ? n + 1 : n),
                    0,
                  );
                  const isAll = selectedCount === ids.length;
                  const isNone = selectedCount === 0;
                  const isOpen = expanded.has(g.symbol);
                  const checkboxClass = isAll
                    ? "checked"
                    : !isNone
                      ? "indeterminate"
                      : "";
                  const chainCount = g.chainBalances.length;
                  return (
                    <div
                      key={g.symbol}
                      className={`src-group${isOpen ? " is-open" : ""}`}
                    >
                      <div className="asset-row">
                        <span
                          className={`checkbox ${checkboxClass}`}
                          role="checkbox"
                          aria-checked={isAll ? true : isNone ? false : "mixed"}
                          aria-label={`Select all ${g.symbol} balances`}
                          tabIndex={0}
                          onClick={() => toggleToken(g)}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                              e.preventDefault();
                              toggleToken(g);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="asset-row-toggle"
                          onClick={() => toggleExpanded(g.symbol)}
                          aria-expanded={isOpen}
                        >
                          <AssetRowIcon
                            src={g.chainBalances[0]?.tokenLogo}
                            fallback={g.symbol}
                          />
                          <AssetRowMeta
                            symbol={g.symbol}
                            sub={
                              chainCount === 1 ? (
                                <>
                                  <ChainDots chains={g.chainBalances} max={1} />
                                  {g.chainBalances[0]?.chainName}
                                </>
                              ) : (
                                <>
                                  <ChainDots chains={g.chainBalances} />
                                  {chainCount} chains
                                </>
                              )
                            }
                          />
                          <AssetRowValue
                            amount={`${formatAmount(g.totalBalance)} ${g.symbol}`}
                            usd={`≈ $${formatAmount(g.totalFiat, 2)}`}
                          />
                          <span className="asset-row-chevron" aria-hidden="true">
                            <ChevronIcon open={isOpen} />
                          </span>
                        </button>
                      </div>
                      {isOpen && (
                        <div className="src-group-body">
                          {g.chainBalances.map((a) => {
                            const checked = draftSet.has(a.id);
                            return (
                              <button
                                key={a.id}
                                type="button"
                                className="asset-row asset-row--chain"
                                onClick={() => toggleBalance(a.id)}
                              >
                                <span
                                  className={`checkbox${checked ? " checked" : ""}`}
                                />
                                <AssetRowIcon
                                  size="sm"
                                  src={a.chainLogo}
                                  fallback={a.chainName}
                                />
                                <AssetRowMeta
                                  symbol={
                                    <>
                                      {a.chainName}
                                      <CopyButton value={a.tokenAddress} />
                                      <TokenInfoCard
                                        token={{
                                          symbol: a.symbol,
                                          tokenName: a.tokenName,
                                          tokenLogo: a.tokenLogo,
                                          chainName: a.chainName,
                                          chainLogo: a.chainLogo,
                                          decimals: a.decimals,
                                          contractAddress: a.tokenAddress,
                                        }}
                                      >
                                        <span
                                          className="asset-row-info"
                                          tabIndex={0}
                                          role="button"
                                          aria-label="Token info"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <InfoIcon />
                                        </span>
                                      </TokenInfoCard>
                                    </>
                                  }
                                />
                                <AssetRowValue amount={formatAmount(a.balance)} />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="modal-footer src-modal-footer">
            <button
              type="button"
              className="primary-button"
              disabled={draft.length === 0}
              onClick={handleApply}
            >
              Done ({draft.length})
            </button>
          </div>
          </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
