import type {
  DeployStatus,
  HostingerDockerContainerHealth,
  HostingerDockerContainerState,
  HostingerVmState,
} from '@hermes/shared';

export const STATUS_LABELS: Record<DeployStatus, string> = {
  pending: 'В очереди…',
  creating: 'Создаём сервер…',
  configuring: 'Настраиваем Hermes…',
  ready: 'Работает',
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

/** Live VM state (Hostinger) — shown on the agent detail screen. */
export const VM_STATE_LABELS: Record<HostingerVmState, string> = {
  running: 'Работает',
  starting: 'Запускается…',
  stopping: 'Останавливается…',
  stopped: 'Остановлен',
  creating: 'Создаётся…',
  initial: 'Готовится…',
  error: 'Ошибка',
  suspending: 'Приостанавливается…',
  unsuspending: 'Возобновляется…',
  suspended: 'Приостановлен',
  destroying: 'Удаляется…',
  destroyed: 'Удалён',
  recreating: 'Пересоздаётся…',
  restoring: 'Восстанавливается…',
  recovery: 'Восстановление…',
  stopping_recovery: 'Остановка восстановления…',
};

export const VM_STATE_CLASS: Record<HostingerVmState, string> = {
  running: 'text-ok',
  starting: 'text-accent',
  stopping: 'text-accent',
  stopped: 'text-dim',
  creating: 'text-accent',
  initial: 'text-accent',
  error: 'text-alarm',
  suspending: 'text-accent',
  unsuspending: 'text-accent',
  suspended: 'text-dim',
  destroying: 'text-accent',
  destroyed: 'text-dim',
  recreating: 'text-accent',
  restoring: 'text-accent',
  recovery: 'text-accent',
  stopping_recovery: 'text-accent',
};

/** Live container state (Docker Manager) of the Hermes project. */
export const CONTAINER_STATE_LABELS: Record<HostingerDockerContainerState, string> = {
  created: 'Создан',
  running: 'Работает',
  restarting: 'Перезапускается…',
  exited: 'Остановлен',
  paused: 'На паузе',
  dead: 'Недоступен',
  stopping: 'Останавливается…',
};

export const CONTAINER_STATE_CLASS: Record<HostingerDockerContainerState, string> = {
  created: 'text-dim',
  running: 'text-ok',
  restarting: 'text-accent',
  exited: 'text-dim',
  paused: 'text-dim',
  dead: 'text-alarm',
  stopping: 'text-accent',
};

export const CONTAINER_HEALTH_CLASS: Record<HostingerDockerContainerHealth, string> = {
  starting: 'text-accent',
  healthy: 'text-ok',
  unhealthy: 'text-alarm',
  '': 'text-dim',
};
