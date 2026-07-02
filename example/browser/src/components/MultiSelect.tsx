import { useCallback, useEffect, useRef, useState } from "react";

type Option = { value: string; label: string; detail?: string; icon?: string };

type MultiSelectProps = {
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  id?: string;
};

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select...",
  id,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (open) setFocusedIndex(0);
  }, [open]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const allSelected = options.length > 0 && selected.length === options.length;

  function toggleAll() {
    onChange([]);
  }

  const summary =
    selected.length === 0 || selected.length === options.length
      ? placeholder
      : options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(", ");

  // Items: index 0 = "All sources", index 1..N = options
  const totalItems = options.length + 1;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, totalItems - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex === 0) {
            toggleAll();
          } else if (focusedIndex > 0) {
            toggle(options[focusedIndex - 1]!.value);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(totalItems - 1);
          break;
      }
    },
    [open, focusedIndex, totalItems, options, selected],
  );

  useEffect(() => {
    if (open && listRef.current && focusedIndex >= 0) {
      const item = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [open, focusedIndex]);

  const listboxId = id ? `${id}-listbox` : undefined;

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        id={id}
        className="dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span className="dropdown-value">{summary}</span>
        <svg
          className={`dropdown-chevron${open ? " open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          className="dropdown-menu"
          role="listbox"
          id={listboxId}
          aria-multiselectable="true"
          aria-activedescendant={focusedIndex >= 0 && id ? `${id}-opt-${focusedIndex}` : undefined}
        >
          <li
            id={id ? `${id}-opt-0` : undefined}
            role="option"
            aria-selected={allSelected}
            className={`dropdown-item multi${allSelected ? " active" : ""}${focusedIndex === 0 ? " focused" : ""}`}
            onClick={toggleAll}
            onMouseEnter={() => setFocusedIndex(0)}
          >
            <span className={`checkbox${allSelected ? " checked" : ""}`} aria-hidden="true" />
            <span>All sources</span>
          </li>
          {options.map((o, i) => {
            const isActive = selected.includes(o.value);
            const itemIndex = i + 1;
            return (
              <li
                key={o.value}
                id={id ? `${id}-opt-${itemIndex}` : undefined}
                role="option"
                aria-selected={isActive}
                className={`dropdown-item multi${isActive ? " active" : ""}${focusedIndex === itemIndex ? " focused" : ""}`}
                onClick={() => toggle(o.value)}
                onMouseEnter={() => setFocusedIndex(itemIndex)}
              >
                <span className={`checkbox${isActive ? " checked" : ""}`} aria-hidden="true" />
                {o.icon && <img src={o.icon} alt={o.label} className="multi-icon" />}
                <span className="multi-label">
                  {o.label}
                  {o.detail && <span className="multi-detail">{o.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
