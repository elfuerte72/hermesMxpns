import { useEffect, useState, type ReactElement } from 'react';
import type { DeployStatus, DeployView } from '@hermes/shared';
import { getDeploy } from '../api';
import { STATUS_LABELS, isTerminal, statusProgress } from '../deploy-status';
import { hapticImpact, openBotChat } from '../telegram';
import robot from '../assets/robot.png';
import { PixelButton } from './ui';

interface DeployStatusViewProps {
  deployId: string;
  onReset: () => void;
}

const POLL_MS = 3000;
const RETRY_MS = 5000;

const CHECKLIST: ReadonlyArray<DeployStatus> = ['pending', 'creating', 'configuring', 'ready'];

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
        if (view.status === 'ready') hapticImpact('light');
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
  const stageIndex = CHECKLIST.indexOf(status);

  function checklistIcon(index: number): { icon: string; className: string } {
    if (ready || index < stageIndex) return { icon: '✓', className: 'text-ok' };
    if (index === stageIndex) return { icon: '⚡', className: 'text-accent animate-blink' };
    return { icon: '○', className: 'text-dim' };
  }

  return (
    <section className="flex flex-1 flex-col gap-5">
      <div className="flex justify-between text-[10px] tracking-[0.2em] text-dim uppercase">
        <span>HERMES</span>
        <span>ДЕПЛОЙ</span>
      </div>

      <div className="mt-4 text-center">
        <img
          src={robot}
          alt="Hermes robot"
          className={`mx-auto w-[104px] ${failed ? 'opacity-60' : 'animate-bob'}`}
        />
      </div>

      <h2 className={`text-center text-sm tracking-wide uppercase ${failed ? 'text-red-400' : ''}`}>
        {STATUS_LABELS[status]}
      </h2>

      <div className="flex flex-col gap-2.5 border-2 border-edge bg-field p-3.5">
        {CHECKLIST.map((stage, index) => {
          const { icon, className } = checklistIcon(index);
          return (
            <div key={stage} className="flex items-baseline gap-2.5 text-[10px]">
              <span className={className}>{icon}</span>
              <span className={index <= stageIndex || ready ? 'text-ink' : 'text-dim'}>
                {STATUS_LABELS[stage]}
              </span>
            </div>
          );
        })}
      </div>

      <div className="h-4 w-full border-2 border-edge bg-field">
        <div
          className={`h-full transition-all duration-500 ${failed ? 'bg-red-500' : ready ? 'bg-ok' : 'bg-accent'}`}
          style={{
            width: `${failed ? 100 : progress}%`,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(18,18,26,.35) 0 6px, transparent 6px 12px)',
          }}
        />
      </div>

      {error && !ready && !failed && (
        <p className="text-center text-[8px] tracking-wide text-dim">Переподключаемся… ({error})</p>
      )}

      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        {ready && deploy && (
          <PixelButton variant="ok" onClick={() => openBotChat(deploy.bot_username)}>
            Открыть @{deploy.bot_username}
          </PixelButton>
        )}
        {failed && (
          <>
            <p className="text-center text-[9px] leading-relaxed text-dim">
              Что-то пошло не так при развёртывании. Попробуйте ещё раз или напишите в поддержку.
            </p>
            <PixelButton variant="accent" onClick={onReset}>
              Начать заново
            </PixelButton>
          </>
        )}
      </div>
    </section>
  );
}
