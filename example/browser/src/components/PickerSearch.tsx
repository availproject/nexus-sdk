import { ChainLogo, GlobeIcon } from "./ChainPickerView";

export type PickerChainOption = {
  id: number;
  name: string;
};

type PickerSearchProps = {
  query: string;
  onQueryChange: (q: string) => void;
  chains: PickerChainOption[];
  selectedChain: PickerChainOption | null;
  onOpenChainPicker: () => void;
  placeholder?: string;
};

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function PickerSearch({
  query,
  onQueryChange,
  chains,
  selectedChain,
  onOpenChainPicker,
  placeholder = "Search token, chain or address",
}: PickerSearchProps) {
  return (
    <div className="picker-search">
      <span className="picker-search-icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        className="picker-search-text"
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
      />
      {chains.length > 1 && (
        <button
          type="button"
          className="picker-search-chain"
          onClick={onOpenChainPicker}
          aria-haspopup="dialog"
        >
          {selectedChain ? (
            <ChainLogo chainId={selectedChain.id} name={selectedChain.name} />
          ) : (
            <span className="chain-row-icon chain-row-icon--all">
              <GlobeIcon />
            </span>
          )}
          <span className="picker-search-chain-label">
            {selectedChain?.name ?? "All chains"}
          </span>
          <ChevronDown />
        </button>
      )}
    </div>
  );
}

/** Case-insensitive substring match against any of the given fields. */
export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}
