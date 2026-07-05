import { useEffect, useState, type ReactElement } from 'react';
import type { DeployView } from '@hermes/shared';
import { listDeploys } from '../api';
import { STATUS_BADGE_CLASS, STATUS_LABELS } from '../deploy-status';
import { errorMessage } from '../error-messages';
import { hapticImpact } from '../telegram';
import { PROVIDER_META } from './ProviderStep';
import { BackLink, PixelButton } from './ui';

interface AgentsListScreenProps {
  onOpen: (deployId: string) => void;
  onCreate: () => void;
  onBack: () => void;
}

function providerLabel(id: string): string {
  return PROVIDER_META[id]?.label ?? id.toUpperCase();
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU');
}

export function AgentsListScreen({ onOpen, onCreate, onBack }: AgentsListScreenProps): ReactElement {
  const [deploys, setDeploys] = useState<DeployView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listDeploys()
      .then((rows) => {
        if (active) setDeploys(rows);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  function open(id: string): void {
    hapticImpact('light');
    onOpen(id);
  }

  const isEmpty = deploys !== null && deploys.length === 0;

  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ МЕНЮ" onClick={onBack} />
      <h2 className="text-sm tracking-wide uppercase">Мои агенты</h2>

      {error && <p className="text-[8px] tracking-wide text-alarm">{error}</p>}

      {deploys === null && !error && <p className="text-[10px] text-dim">Загружаем…</p>}

      {isEmpty && (
        <div className="mt-auto mb-[8vh] flex flex-col gap-3.5">
          <p className="text-center text-[10px] leading-relaxed text-dim">У тебя пока нет агентов</p>
          <PixelButton variant="accent" onClick={onCreate}>
            ▶ Создать агента
          </PixelButton>
        </div>
      )}

      {deploys && deploys.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {deploys.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => open(d.id)}
              className="flex flex-col gap-1.5 border-2 border-edge p-3.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px]">@{d.bot_username}</span>
                <span className={`text-[9px] tracking-wide ${STATUS_BADGE_CLASS[d.status]}`}>
                  {STATUS_LABELS[d.status]}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[9px] text-dim">
                <span>{providerLabel(d.llm_provider)}</span>
                <span>{formatDate(d.created_at)}</span>
              </div>
              {d.status === 'ready' && d.vm_ip && (
                <span className="text-[9px] text-dim">IP {d.vm_ip}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
