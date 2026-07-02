# Stress Test Notes

## Purpose
The stress test page (`/stress-test`) is a dedicated UI for running multiple bridge operations against the Nexus SDK using selectable load models. It is intended for **testnet only** and uses a private key to auto-sign approvals and intents.

## Key UX Requirements
- Stress test page is only available once a wallet is connected.
- Users paste a **disposable testnet private key** to avoid manual approvals.
- Prominent disclaimer shown: **never use real funds or mainnet keys**.
- Inputs are a reusable “control bar” layout (non-hacky CSS).
- Run Status area should take the bulk of the page.
- Report should be clean and aligned.

## Defaults
- Token: `USDC`
- Amount: `0.0001`
- Total Requests: `20`
- Load model defaults: Batch mode with `Batch Size: 5` and `Delay: 1000 ms`
- Destinations: random selection from selected chains
- Source chains: auto-selected by SDK

## UI Behavior
- Load model selector drives which model-specific fields are shown.
- Shared fields always visible: token, amount, total requests.
- Destination chain selector is multi-select and placed at the end of the control bar.
- Run Status shows a progress bar, status chips, and per-operation rows with timing + intent link.
- Test report shows aggregate stats and a configuration summary for the chosen model.

## Status Tracking
- `queued` | `running` | `approved` | `signed` | `deposited` | `fulfilled` | `failed`
- Status chips and row badges should stay aligned and readable at a glance.

## CSS/Structure
- `control-bar` / `control-field` / `control-actions` is the reusable layout.
- Report rows use grid alignment for destination chain stats.
- Disclaimer uses a coral warning style (red-adjacent but softer).

## Known Issues/Areas to Revisit
- Run Status layout may need further refinement.

## Files
- UI + logic: `example/browser/src/pages/StressTest.tsx`
- Styles: `example/browser/src/App.css`
