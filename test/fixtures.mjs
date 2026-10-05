import { createRecord, prepareRevision } from '../skills/decision-harness/scripts/core.mjs';
export const NOW = '2026-10-04T12:00:00.000Z';
export function completeRecord(mode = 'screen') {
  const r = createRecord({ title: 'Example / 示例', prompt: 'Choose a small verifiable tool', mode, objectives: [{ id: 'feasible', text: 'Can finish a small version', origin: 'user' }] }, 'example', NOW);
  r.criteria = [{ id: 'verifiable', title: '结果能验证', description: 'A concrete test can demonstrate the effect.', objectiveIds: ['feasible'], question: 'What observable result would change?', rationale: 'The user wants to verify usefulness.', status: 'adopted', origin: 'agent' }];
  if (mode === 'screen') {
    r.alternatives = [{ id: 'option-a', title: 'Small check', description: 'A narrow tool.' }];
    r.evidence = [{ id: 'source-a', title: 'Synthetic test fixture', location: 'fixture.txt', kind: 'local', summary: 'Observed a passing documented check.', retrievedAt: NOW }];
    r.assessments = [{ id: 'assessment-a', alternativeId: 'option-a', criterionId: 'verifiable', status: 'supported', claimType: 'judgment', rationale: 'The fixture supplies a check.', evidenceIds: ['source-a'], uncertainty: 'Synthetic example only.' }];
    r.recommendation = { alternativeIds: ['option-a'], rationale: 'Suitable under the stated narrow goal.', tradeoffs: ['Limited scope'], conditions: ['Check real workload before use'], nextChecks: ['Try actual data'] };
  }
  return prepareRevision(createRecord({ title: r.title, prompt: r.prompt, mode }, 'example', NOW), r, { now: NOW });
}
