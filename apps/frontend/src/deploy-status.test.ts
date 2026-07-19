import { describe, expect, it } from 'vitest';
import type { DeployStatus, HostingerDockerContainerState, HostingerVmState } from '@hermes/shared';
import {
  CONTAINER_STATE_CLASS,
  CONTAINER_STATE_LABELS,
  STATUS_LABELS,
  VM_STATE_CLASS,
  VM_STATE_LABELS,
  isTerminal,
  statusProgress,
} from './deploy-status';

const ALL: DeployStatus[] = ['pending', 'creating', 'configuring', 'ready', 'failed', 'deleted'];

const ALL_VM_STATES: HostingerVmState[] = [
  'running',
  'starting',
  'stopping',
  'stopped',
  'creating',
  'initial',
  'error',
  'suspending',
  'unsuspending',
  'suspended',
  'destroying',
  'destroyed',
  'recreating',
  'restoring',
  'recovery',
  'stopping_recovery',
];

const ALL_CONTAINER_STATES: HostingerDockerContainerState[] = [
  'created',
  'running',
  'restarting',
  'exited',
  'paused',
  'dead',
  'stopping',
];

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

  it('has a label and a badge class for every live VM state', () => {
    for (const s of ALL_VM_STATES) {
      expect(VM_STATE_LABELS[s]).toBeTruthy();
      expect(VM_STATE_CLASS[s]).toMatch(/^text-/);
    }
    expect(VM_STATE_CLASS.running).toBe('text-ok');
    expect(VM_STATE_CLASS.error).toBe('text-alarm');
  });

  it('has a label and a badge class for every container state', () => {
    for (const s of ALL_CONTAINER_STATES) {
      expect(CONTAINER_STATE_LABELS[s]).toBeTruthy();
      expect(CONTAINER_STATE_CLASS[s]).toMatch(/^text-/);
    }
    expect(CONTAINER_STATE_CLASS.running).toBe('text-ok');
    expect(CONTAINER_STATE_CLASS.dead).toBe('text-alarm');
  });
});
