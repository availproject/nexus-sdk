import { useCallback, useMemo, useState } from "react";
import type { NexusClient } from "@avail-project/nexus-core";
import type { TabConfig } from "../lib/types";
import type {
  BridgeAndExecuteIntentViewModel,
  BridgeIntentViewModel,
  SwapAndExecuteIntentViewModel,
  SwapIntentViewModel,
} from "../lib/nexus";
import { useOperationForm } from "../hooks/useOperationForm";
import { DestinationSelector, type DestinationOption } from "./DestinationSelector";
import { SourceSelector } from "./SourceSelector";
import { SourceAmountsEditor } from "./SourceAmountsEditor";
import { RecipientInput } from "./RecipientInput";
import { FlowModal } from "./FlowModal";
import { getChainLogoUrl, getTokenLogoUrl } from "../lib/logos";
import { flattenBalances } from "../lib/nexus";
import { getDepositProtocol } from "../lib/deposit";

type OperationPageProps = {
  config: TabConfig;
  client: NexusClient | null;
  ready: boolean;
  address?: `0x${string}`;
  onSwapIntent: (data: any) => void;
  onBridgeIntent: (data: any) => void;
  onSwapExecIntent: (data: any) => void;
  onBridgeExecIntent: (data: any) => void;
  swapIntentPending: boolean;
  swapIntentApproved: boolean;
  clearSwapIntent: () => void;
  bridgeIntentPending: boolean;
  bridgeIntentApproved: boolean;
  clearBridgeIntent: () => void;
  swapExecIntentPending: boolean;
  swapExecIntentApproved: boolean;
  clearSwapExecIntent: () => void;
  swapIntent: SwapIntentViewModel | null;
  swapIntentRefreshing: boolean;
  approveSwapIntent: () => void;
  denySwapIntent: () => void;
  bridgeIntent: BridgeIntentViewModel | null;
  bridgeIntentRefreshing: boolean;
  approveBridgeIntent: () => void;
  denyBridgeIntent: () => void;
  swapExecIntent: SwapAndExecuteIntentViewModel | null;
  swapExecIntentRefreshing: boolean;
  approveSwapExecIntent: () => void;
  denySwapExecIntent: () => void;
  bridgeExecIntent: BridgeAndExecuteIntentViewModel | null;
  bridgeExecIntentRefreshing: boolean;
  approveBridgeExecIntent: () => void;
  denyBridgeExecIntent: () => void;
  bridgeExecIntentPending: boolean;
  bridgeExecIntentApproved: boolean;
  clearBridgeExecIntent: () => void;
};

export function OperationPage({ config, ...sdkProps }: OperationPageProps) {
  const form = useOperationForm({ config, ...sdkProps });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isBridge = config.id === "bridge";
  const isPerSource = config.amountMode === "per-source";

  const handleDismissProgress = useCallback(() => {
    form.closeProgressModal();
    form.resetForm();
  }, [form.closeProgressModal, form.resetForm]);

  const destinationOptions = useMemo<DestinationOption[]>(() => {
    return form.chainOptions.flatMap((chain) => {
      const tokens = config.getTokenOptions(sdkProps.client, chain.id);
      return tokens.map((token) => ({
        id: `${chain.id}:${token.symbol}`,
        chainId: chain.id,
        chainName: chain.name,
        chainLogo: getChainLogoUrl(chain.id),
        symbol: token.symbol,
        label: token.label,
        tokenLogo: getTokenLogoUrl(token.symbol, token.tokenAddress, chain.id),
        tokenAddress: token.tokenAddress,
        decimals: token.decimals,
      }));
    });
  }, [form.chainOptions, config, sdkProps.client]);

  const selectedDestId = `${form.chainId}:${form.tokenSymbol}`;
  const hasValidDestination = destinationOptions.some((o) => o.id === selectedDestId);

  // Deposit tabs pin one lending protocol per destination chain — surface its
  // name in the hero pill + intent eyebrow. Label-only (no status color):
  // DESIGN.md reserves success/warning tints for status, not categories.
  const isDepositTab =
    config.intentType === "swapAndExecute" ||
    config.intentType === "bridgeAndExecute";
  const depositProtocol = isDepositTab ? getDepositProtocol(form.chainId) : undefined;

  const destinationBalances = useMemo(
    () => flattenBalances(form.balancesQuery.data ?? []),
    [form.balancesQuery.data],
  );

  return (
    <div className="stack-xl">
      <div className="hero-wrap">
        <section className={`hero-card${config.hero.accentClass ? ` ${config.hero.accentClass}` : ""}`}>
          <div className="card-kicker">
            <span className="icon-badge">{config.hero.icon}</span>
            <span>{config.hero.title}</span>
            {depositProtocol && (
              <span className="meta-pill">{depositProtocol.label}</span>
            )}
          </div>
          <p className="hero-copy">{config.hero.description}</p>

          <div className="form-grid">
            {isPerSource ? (
              <>
                <SourceAmountsEditor
                  sources={form.sourceOptions}
                  selectedIds={form.selectedSources}
                  onSelectedChange={form.setSelectedSources}
                  amounts={form.sourceAmounts}
                  onAmountChange={form.setSourceAmount}
                />
                <div className="receive-card field-full">
                  <span className="receive-label">{config.amountLabel}</span>
                  <div className="receive-row receive-row--output">
                    <span className="receive-amount receive-amount--placeholder" aria-hidden="true">
                      —
                    </span>
                    <DestinationSelector
                      options={destinationOptions}
                      selectedId={selectedDestId}
                      onSelect={(opt) => {
                        form.setChainId(opt.chainId);
                        form.setTokenSymbol(opt.symbol);
                      }}
                      balances={destinationBalances}
                    />
                  </div>
                  <div className="receive-hint">
                    <span className="receive-output-note">
                      Output amount &amp; fees shown at review
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="receive-card field-full">
                  <span className="receive-label">{config.amountLabel}</span>
                  <div className="receive-row">
                    <input
                      id={`${config.id}-amount`}
                      className="receive-amount"
                      value={form.amount}
                      onChange={(e) => form.setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                    />
                    <DestinationSelector
                      options={destinationOptions}
                      selectedId={selectedDestId}
                      onSelect={(opt) => {
                        form.setChainId(opt.chainId);
                        form.setTokenSymbol(opt.symbol);
                      }}
                      balances={destinationBalances}
                    />
                  </div>
                  <div className="receive-hint">
                    {form.maxQuery.isFetching
                      ? <span>Calculating max…</span>
                      : form.maxQuery.error
                        ? <span className="field-error">Max calc failed: {form.maxQuery.error.message}</span>
                        : form.maxQuery.data
                          ? (
                            <button
                              type="button"
                              className="max-link"
                              onClick={() => form.setAmount(form.maxQuery.data!.maxAmount)}
                            >
                              {form.maxQuery.data.maxAmount} {form.maxQuery.data.symbol}
                            </button>
                          )
                          : (
                            <button
                              type="button"
                              className="max-link"
                              onClick={form.fetchMax}
                            >
                              Calculate max
                            </button>
                          )}
                  </div>
                  {isBridge && (
                    <RecipientInput
                      value={form.recipient}
                      onChange={form.setRecipient}
                      defaultAddress={sdkProps.address}
                    />
                  )}
                </div>

                <SourceSelector
                  sources={form.sourceOptions}
                  selectedIds={form.selectedSources}
                  onSelect={form.setSelectedSources}
                />

                {isBridge && (
                  <div className="field field-full">
                    <button
                      type="button"
                      className="advanced-toggle"
                      onClick={() => setAdvancedOpen((p) => !p)}
                    >
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: advancedOpen ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      Advanced
                    </button>
                    {advancedOpen && (
                      <div className="advanced-fields">
                        <div className="field">
                          <label htmlFor="bridge-native-amount">Native amount (destination gas)</label>
                          <input
                            id="bridge-native-amount"
                            value={form.nativeAmount}
                            onChange={(e) => form.setNativeAmount(e.target.value)}
                            inputMode="decimal"
                            placeholder="0.0 (e.g. 0.001 ETH)"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {form.balancesQuery.error && (
              <div className="field-full">
                <span className="field-error">Balance fetch failed: {form.balancesQuery.error.message}</span>
              </div>
            )}
          </div>

          <button
            className="primary-button"
            type="button"
            disabled={
              form.mutation.isPending ||
              !sdkProps.ready ||
              !form.amountValid ||
              !hasValidDestination ||
              form.intentPending
            }
            onClick={() => form.mutation.mutate()}
          >
            {form.mutation.isPending
              ? config.hero.buttonPendingLabel
              : config.hero.buttonLabel}
          </button>
        </section>
      </div>

      <FlowModal
        intentType={config.intentType}
        intent={
          config.intentType === "swap"
            ? sdkProps.swapIntent
            : config.intentType === "bridge"
              ? sdkProps.bridgeIntent
              : config.intentType === "swapAndExecute"
                ? sdkProps.swapExecIntent
                : sdkProps.bridgeExecIntent
        }
        intentPending={
          config.intentType === "swap"
            ? sdkProps.swapIntentPending
            : config.intentType === "bridge"
              ? sdkProps.bridgeIntentPending
              : config.intentType === "swapAndExecute"
                ? sdkProps.swapExecIntentPending
                : sdkProps.bridgeExecIntentPending
        }
        intentRefreshing={
          config.intentType === "swap"
            ? sdkProps.swapIntentRefreshing
            : config.intentType === "bridge"
              ? sdkProps.bridgeIntentRefreshing
              : config.intentType === "swapAndExecute"
                ? sdkProps.swapExecIntentRefreshing
                : sdkProps.bridgeExecIntentRefreshing
        }
        intentApproved={
          config.intentType === "swap"
            ? sdkProps.swapIntentApproved
            : config.intentType === "bridge"
              ? sdkProps.bridgeIntentApproved
              : config.intentType === "swapAndExecute"
                ? sdkProps.swapExecIntentApproved
                : sdkProps.bridgeExecIntentApproved
        }
        onApprove={
          config.intentType === "swap"
            ? sdkProps.approveSwapIntent
            : config.intentType === "bridge"
              ? sdkProps.approveBridgeIntent
              : config.intentType === "swapAndExecute"
                ? sdkProps.approveSwapExecIntent
                : sdkProps.approveBridgeExecIntent
        }
        onDeny={
          config.intentType === "swap"
            ? sdkProps.denySwapIntent
            : config.intentType === "bridge"
              ? sdkProps.denyBridgeIntent
              : config.intentType === "swapAndExecute"
                ? sdkProps.denySwapExecIntent
                : sdkProps.denyBridgeExecIntent
        }
        actionLabel={depositProtocol ? `${depositProtocol.label} Supply` : undefined}
        progressState={form.progressState}
        onDismissProgress={handleDismissProgress}
      />
    </div>
  );
}
