import type { NormalizedStep } from "./types";

export function getVisibleExecutionSteps(
  steps: NormalizedStep[],
  expanded: boolean,
): NormalizedStep[] {
  const active = steps.find((step) => step.state === "active" || step.state === "submitted");
  if (!active || expanded) return steps;
  return steps.filter(
    (step) => step === active || (step.type === "allowance" && step.state === "done"),
  );
}
