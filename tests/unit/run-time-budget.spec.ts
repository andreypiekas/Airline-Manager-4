import { test, expect } from '@playwright/test';
import { evaluateRunPhaseBudget } from '../../utils/run-time-budget';

test('phase budget allows work only when the full conservative window remains', () => {
  const allowed = evaluateRunPhaseBudget('ticket-pricing', 1_000, 181_000, 120_000);
  expect(allowed).toMatchObject({ allowed: true, reason: 'TIME_BUDGET_AVAILABLE', remainingMs: 180_000 });

  const blocked = evaluateRunPhaseBudget('ticket-pricing', 61_001, 181_000, 120_000);
  expect(blocked).toMatchObject({ allowed: false, reason: 'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PHASE', remainingMs: 119_999 });
});

test('phase budget is fail-closed for exhausted or invalid evidence', () => {
  expect(evaluateRunPhaseBudget('departures', 200_000, 100_000, 1)).toMatchObject({
    allowed: false,
    reason: 'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PHASE',
    remainingMs: 0,
  });
  expect(evaluateRunPhaseBudget('', Number.NaN, 100_000, 1)).toMatchObject({
    allowed: false,
    reason: 'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PHASE',
    remainingMs: 0,
  });
});
