import { useCallback, useMemo } from "react";
import type { NexusClient } from "@avail-project/nexus-core";
import type { TabConfig } from "../lib/types";
import type {
  SwapAndExecuteIntentViewModel,
  SwapIntentViewModel,
} from "../lib/nexus";
import { useOperationForm } from "../hooks/useOperationForm";
import { DestinationSelector, type DestinationOption } from "./DestinationSelector";
import { SourceSelector } from "./SourceSelector";
import { SourceAmountsEditor } from "./SourceAmountsEditor";
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
  onSwapExecIntent: (data: any) => void;
  swapIntentPending: boolean;
  swapIntentApproved: boolean;
  clearSwapIntent: () => void;
  swapExecIntentPending: boolean;
  swapExecIntentApproved: boolean;
  clearSwapExecIntent: () => void;
  swapIntent: SwapIntentViewModel | null;
  swapIntentRefreshing: boolean;
  approveSwapIntent: () => void;
  denySwapIntent: () => void;
  swapExecIntent: SwapAndExecuteIntentViewModel | null;
  swapExecIntentRefreshing: boolean;
  approveSwapExecIntent: () => void;
  denySwapExecIntent: () => void;
};

export function OperationPage({ config, ...sdkProps }: OperationPageProps) {
  const form = useOperationForm({ config, ...sdkProps });
  const isPerSource = config.amountMode === "per-source";

  const handleDismissProgress = useCallback(() => {
    form.closeProgressModal();
    form.resetForm();
  }, [form.closeProgressModal, form.resetForm]);

  const destinationOptions = useMemo<DestinationOption[]>(() => {
    return form.chainOptions.flatMap((chain) => {
      const tokens = config.getTokenOptions(sdkProps.client, chain.id);
      return tokens.map((token) => ({
        id: `${chain.id}:${token.tokenAddress?.toLowerCase()}`,
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

  const selectedDestId = `${form.chainId}:${form.tokenAddress?.toLowerCase()}`;
  const hasValidDestination = destinationOptions.some((o) => o.id === selectedDestId);

  // Deposit tabs pin one lending protocol per destination chain — surface its
  // name in the hero pill + intent eyebrow. Label-only (no status color):
  // DESIGN.md reserves success/warning tints for status, not categories.
  const isDepositTab = config.intentType === "swapAndExecute";
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
                        form.setTokenAddress(opt.tokenAddress);
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
                        form.setTokenAddress(opt.tokenAddress);
                      }}
                      balances={destinationBalances}
                    />
                  </div>
                </div>

                <SourceSelector
                  sources={form.sourceOptions}
                  selectedIds={form.selectedSources}
                  onSelect={form.setSelectedSources}
                />
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
        intent={config.intentType === "swap" ? sdkProps.swapIntent : sdkProps.swapExecIntent}
        intentPending={config.intentType === "swap" ? sdkProps.swapIntentPending : sdkProps.swapExecIntentPending}
        intentRefreshing={config.intentType === "swap" ? sdkProps.swapIntentRefreshing : sdkProps.swapExecIntentRefreshing}
        intentApproved={config.intentType === "swap" ? sdkProps.swapIntentApproved : sdkProps.swapExecIntentApproved}
        onApprove={config.intentType === "swap" ? sdkProps.approveSwapIntent : sdkProps.approveSwapExecIntent}
        onDeny={config.intentType === "swap" ? sdkProps.denySwapIntent : sdkProps.denySwapExecIntent}
        actionLabel={depositProtocol ? `${depositProtocol.label} Supply` : undefined}
        progressState={form.progressState}
        onDismissProgress={handleDismissProgress}
      />
    </div>
  );
}
