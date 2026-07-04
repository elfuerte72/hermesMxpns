import { describe, expect, it } from 'vitest';
import type { DeployStatus } from '@hermes/shared';
import { STATUS_LABELS, isTerminal, statusProgress } from './deploy-status';

const ALL: DeployStatus[] = ['pending', 'creating', 'configuring', 'ready', 'failed', 'deleted'];

describe('deploy-status helpers', () => {
  it('has a label for every status', () => {
    for (const s of ALL) expect(STATUS_LABELS[s]).toBeTruthy();
  });

  it('marks only ready/failed/deleted as terminal', () => {
    expect(isTerminal('ready')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('deleted')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('creating')).toBe(false);
    expect(isTerminal('configuring')).toBe(false);
  });

  it('reports monotonic progress along the happy path', () => {
    expect(statusProgress('pending')).toBe(0);
    expect(statusProgress('creating')).toBe(33);
    expect(statusProgress('configuring')).toBe(67);
    expect(statusProgress('ready')).toBe(100);
    expect(statusProgress('failed')).toBe(0);
  });
});
