import { useEffect, useState, type ReactElement } from 'react';
import type { DeployView } from '@hermes/shared';
import { getDeploy } from '../api';
import { STATUS_LABELS, isTerminal, statusProgress } from '../deploy-status';
import { openBotChat } from '../telegram';

interface DeployStatusViewProps {
  deployId: string;
  onReset: () => void;
}

const POLL_MS = 3000;
const RETRY_MS = 5000;

export function DeployStatusView({ deployId, onReset }: DeployStatusViewProps): ReactElement {
  const [deploy, setDeploy] = useState<DeployView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll(): Promise<void> {
      try {
        const view = await getDeploy(deployId);
        if (!active) return;
        setDeploy(view);
        setError(null);
        if (!isTerminal(view.status)) timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Не удалось получить статус');
        timer = setTimeout(poll, RETRY_MS);
      }
    }

    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [deployId]);

  const status = deploy?.status ?? 'pending';
  const progress = statusProgress(status);
  const failed = status === 'failed';
  const ready = status === 'ready';

  return (
    <section className="flex w-full max-w-sm flex-col gap-5 text-center">
      <h1 className="text-xl font-bold text-slate-900">Статус деплоя</h1>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-red-500' : 'bg-blue-600'}`}
          style={{ width: `${failed ? 100 : progress}%` }}
        />
      </div>

      <p className={`text-base font-medium ${failed ? 'text-red-600' : 'text-slate-700'}`}>
        {STATUS_LABELS[status]}
      </p>

      {error && !ready && !failed && (
        <p className="text-xs text-slate-400">Переподключаемся… ({error})</p>
      )}

      {ready && deploy && (
        <button
          type="button"
          onClick={() => openBotChat(deploy.bot_username)}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Открыть @{deploy.bot_username}
        </button>
      )}

      {failed && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Что-то пошло не так при развёртывании. Попробуйте ещё раз или напишите в поддержку.
          </p>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            Начать заново
          </button>
        </div>
      )}
    </section>
  );
}
