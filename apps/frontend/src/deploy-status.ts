import type { DeployStatus } from '@hermes/shared';

export const STATUS_LABELS: Record<DeployStatus, string> = {
  pending: 'В очереди…',
  creating: 'Создаём сервер…',
  configuring: 'Настраиваем Hermes…',
  ready: 'Готово!',
  failed: 'Не удалось развернуть',
  deleted: 'Удалён',
};

/** Text-colour token per status for compact badges (see index.css @theme). */
export const STATUS_BADGE_CLASS: Record<DeployStatus, string> = {
  pending: 'text-accent',
  creating: 'text-accent',
  configuring: 'text-accent',
  ready: 'text-ok',
  failed: 'text-alarm',
  deleted: 'text-dim',
};

const TERMINAL_STATUSES: readonly DeployStatus[] = ['ready', 'failed', 'deleted'];
const PROGRESS_ORDER: readonly DeployStatus[] = ['pending', 'creating', 'configuring', 'ready'];

/** True once the deploy has reached a state that no longer changes. */
export function isTerminal(status: DeployStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 0–100 progress for the status bar (failed/deleted collapse to 0). */
export function statusProgress(status: DeployStatus): number {
  const index = PROGRESS_ORDER.indexOf(status);
  if (index < 0) return 0;
  return Math.round((index / (PROGRESS_ORDER.length - 1)) * 100);
}
