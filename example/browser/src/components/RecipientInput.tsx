import { useEffect, useRef, useState } from "react";

type RecipientInputProps = {
  /** The current value of the recipient field. Empty = use the connected wallet. */
  value: string;
  onChange: (v: string) => void;
  /** Connected wallet address — shown as the default when `value` is empty. */
  defaultAddress?: string;
  label?: string;
};

function isAddressLike(s: string): boolean {
  const v = s.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export function RecipientInput({
  value,
  onChange,
  defaultAddress,
  label = "Recipient",
}: RecipientInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const effective = value || defaultAddress || "";
  const draftIsValid = draft.trim() === "" || isAddressLike(draft);

  function startEdit() {
    setDraft(value || defaultAddress || "");
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    // Empty means "use default" — store as empty string at the form level.
    if (next === "" || next.toLowerCase() === (defaultAddress ?? "").toLowerCase()) {
      onChange("");
    } else if (isAddressLike(next)) {
      onChange(next);
    }
    setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  return (
    <div className="recipient-section">
      <span className="recipient-label">{label}</span>
      {editing ? (
        <div className="recipient-row recipient-row--edit">
          <input
            ref={inputRef}
            className={`recipient-edit-input${draftIsValid ? "" : " is-invalid"}`}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftIsValid) commit();
              if (e.key === "Escape") cancel();
            }}
            placeholder="0x..."
            spellCheck={false}
            autoCorrect="off"
            aria-invalid={!draftIsValid}
          />
          <button
            type="button"
            className="recipient-edit-btn recipient-edit-btn--primary"
            onClick={commit}
            disabled={!draftIsValid}
          >
            Save
          </button>
          <button type="button" className="recipient-edit-btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="recipient-row">
          <span className="recipient-address">
            {effective || "—"}
          </span>
          <button type="button" className="recipient-edit-btn" onClick={startEdit}>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
