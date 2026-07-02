import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import type { TokenBalance } from "@avail-project/nexus-core";
import type { NetworkMode, TabConfig } from "../lib/types";
import { BalancesModal } from "./BalancesModal";
import { WalletButton } from "../wallet";

type AppShellProps = {
  children: ReactNode;
  network: NetworkMode;
  onSelectNetwork: (target: NetworkMode) => void;
  forceMayan: boolean;
  onToggleForceMayan: () => void;
  mode: "dark" | "light";
  onToggleMode: () => void;
  tabs: TabConfig[];
  assets: TokenBalance[];
  balancesLoading: boolean;
  onRefreshBalances: () => void;
};

const NETWORK_OPTIONS: readonly NetworkMode[] = ["mainnet", "canary", "testnet"];

function AvailLogo() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(8, 8) scale(0.78)">
        <path
          d="M56.1227 60.2147L63.14 63.6439C64.8833 64.4957 66.9926 63.7382 67.68 61.9237C69.6891 56.6201 71.2689 50.2837 71.8041 43.7601C72.4151 36.314 71.6599 28.7006 68.7035 22.1125L68.6994 22.1143C68.5679 21.8305 68.4344 21.5474 68.2987 21.2652C67.2815 19.3139 65.3761 16.9205 62.5702 15.3369C59.4075 13.552 55.0139 12.7442 49.2484 14.9038C48.0252 15.362 46.78 15.954 45.5312 16.6603C47.0997 19.3288 48.2234 22.9278 48.3126 27.6733C48.3933 31.9623 47.6975 36.024 46.6315 39.6426L57.1558 43.5501C59.2936 44.3439 60.6933 46.4571 60.2941 48.7023C59.7324 51.8611 58.7428 54.9355 57.3594 57.8501C56.9853 58.6381 56.574 59.4293 56.1227 60.2147Z"
          fill="currentColor"
        />
        <path
          d="M21.8652 57.3686C22.7281 57.1088 23.6393 56.7331 24.5957 56.2106C28.6457 53.9979 31.7087 50.3846 33.8862 46.8399C35.3391 44.4748 36.4214 42.1019 37.1526 40.1195C37.443 39.3323 38.3118 38.9052 39.0985 39.1973L55.9179 45.442C57.392 45.9893 58.3207 47.4714 58.0029 49.0114C57.5233 51.335 56.6845 54.1116 55.3586 56.9051C53.2786 61.287 50.0374 65.6341 45.1875 68.3819C41.1801 70.6523 37.0816 71.8235 33.2503 71.9995C29.0759 71.2932 26.3373 69.4813 24.5926 67.0616C22.7454 64.4997 21.9241 61.1329 21.8652 57.3686Z"
          fill="currentColor"
        />
        <path
          d="M32.0031 0.322354C42.3172 -0.88462 49.9809 1.39728 55.798 5.50473C58.8889 7.68718 61.4846 10.4037 63.686 13.4328L63.6624 13.4194C59.9076 11.3004 54.828 10.4605 48.4728 12.841C39.9413 16.0368 30.744 25.0421 25.8474 34.2257C22.6714 40.1824 19.5394 49.3163 19.6578 57.3778C19.7171 61.4186 20.595 65.2918 22.8011 68.3514C23.5691 69.4166 24.4875 70.3684 25.5672 71.1872C17.7107 69.2328 7.82516 63.791 2.49764 51.2475C-2.15156 40.3011 0.0590149 28.184 6.08264 18.4449C12.1155 8.69106 21.8578 1.50958 32.0031 0.322354Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}

export function AppShell({
  children,
  network,
  onSelectNetwork,
  forceMayan,
  onToggleForceMayan,
  mode,
  onToggleMode,
  tabs,
  assets,
  balancesLoading,
  onRefreshBalances,
}: AppShellProps) {
  const [balancesOpen, setBalancesOpen] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<NetworkMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isWide = location.pathname.startsWith("/stress-test");

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  return (
    <div className={`app-frame${isWide ? " app-frame--wide" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <AvailLogo />
          </div>
          <div>
            <h1>Nexus</h1>
            <p className="brand-version">v2</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="network-switcher" role="group" aria-label="Network">
            {NETWORK_OPTIONS.map((option) => {
              const isActive = network === option;
              return (
                <button
                  key={option}
                  className={`ghost-button network-toggle${isActive ? " network-toggle-active" : ""}`}
                  type="button"
                  onClick={() => {
                    if (isActive) return;
                    setPendingNetwork(option);
                  }}
                  aria-pressed={isActive}
                  title={isActive ? `Current network: ${option}` : `Switch to ${option}`}
                  aria-label={isActive ? `Current network: ${option}` : `Switch to ${option}`}
                >
                  <span className={`network-dot ${option}`} />
                  {option}
                </button>
              );
            })}
          </div>
          <span className="topbar-divider" />
          <div className="settings-anchor" ref={settingsRef}>
            <button
              className={`ghost-button settings-trigger${settingsOpen ? " settings-trigger-open" : ""}${forceMayan ? " settings-trigger-flag" : ""}`}
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              title="Developer settings"
              aria-label="Developer settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.05a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {settingsOpen && (
              <div className="settings-popover" role="dialog" aria-label="Developer settings">
                <div className="settings-popover-header">Dev settings</div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={forceMayan}
                  onClick={onToggleForceMayan}
                  className="settings-row"
                  data-checked={forceMayan ? "true" : "false"}
                >
                  <span className="settings-row-text">
                    <span className="settings-row-label">Force Mayan</span>
                    <span className="settings-row-hint">
                      Route every bridge through Mayan instead of the threshold check.
                    </span>
                  </span>
                  <span className="switch" aria-hidden>
                    <span className="switch-thumb" />
                  </span>
                </button>
              </div>
            )}
          </div>
          <span className="topbar-divider" />
          {network === "testnet" && (
            <button
              className="ghost-button"
              type="button"
              onClick={() => navigate("/stress-test")}
              title="Stress test"
              aria-label="Stress test"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </button>
          )}
          <button
            className="ghost-button"
            type="button"
            onClick={() => setBalancesOpen(true)}
            title="View balances"
            aria-label="View balances"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M2 10h20" />
              <path d="M16 14h2" />
            </svg>
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={onToggleMode}
            title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
          >
            {mode === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <WalletButton />
        </div>
      </header>

      <nav className="route-tabs">
        {tabs.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.path}
            className={({ isActive }) =>
              `route-tab${isActive ? " route-tab-active" : ""}`
            }
          >
            {tab.navLabel}
          </NavLink>
        ))}
      </nav>

      <main className="panel panel-main">{children}</main>

      <BalancesModal
        open={balancesOpen}
        onOpenChange={setBalancesOpen}
        assets={assets}
        loading={balancesLoading}
        onRefresh={onRefreshBalances}
      />

      <Dialog.Root
        open={pendingNetwork !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNetwork(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content className="modal-panel network-confirm-panel modal-content-centered">
            <div className="modal-header">
              <Dialog.Title className="modal-title">Switch network</Dialog.Title>
            </div>
            <div className="modal-body network-confirm-body">
              <p>
                This will reinitialize the SDK client for <strong>{pendingNetwork}</strong>.
                Cached balances and in-progress operations will be cleared.
              </p>
            </div>
            <div className="modal-footer intent-actions">
              <button
                className="intent-button intent-button-secondary"
                type="button"
                onClick={() => setPendingNetwork(null)}
              >
                Cancel
              </button>
              <button
                className="intent-button intent-button-primary"
                type="button"
                onClick={() => {
                  if (pendingNetwork) onSelectNetwork(pendingNetwork);
                  setPendingNetwork(null);
                }}
              >
                Switch to {pendingNetwork}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
