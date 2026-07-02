export type StatusEvent<S extends string> = {
  type: 'status';
  status: S;
};

export type PlanPreviewEvent<TPlan> = {
  type: 'plan_preview';
  plan: TPlan;
};

export type PlanConfirmedEvent<TPlan> = {
  type: 'plan_confirmed';
  plan: TPlan;
};

export type PlanProgressFailedBase<TStep extends { type: string }> = {
  type: 'plan_progress';
  stepType: TStep['type'];
  state: 'failed';
  step: TStep;
  error: string;
};
