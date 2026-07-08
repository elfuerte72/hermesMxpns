import { useEffect, useState, type ReactElement } from 'react';
import type { DeployView, LlmProvider, TopupTierView } from '@hermes/shared';
import {
  deleteDeploy,
  fetchProviders,
  getDeploy,
  getTopupTiers,
  restartDeploy,
  topupDeploy,
  updateBotToken,
  updateLlmKey,
} from '../api';
import { STATUS_BADGE_CLASS, STATUS_LABELS } from '../deploy-status';
import { errorMessage, llmKeyErrorMessage } from '../error-messages';
import { hapticImpact, openBotChat, openTelegramUrl } from '../telegram';
import { providerMeta } from './ProviderStep';
import { BackLink, PixelButton, PixelInput } from './ui';

interface AgentDetailScreenProps {
  deployId: string;
  onBack: () => void;
  onDeleted: () => void;
}

type RestartState = 'idle' | 'confirm' | 'pending' | 'done';

export function AgentDetailScreen({
  deployId,
  onBack,
  onDeleted,
}: AgentDetailScreenProps): ReactElement {
  const [deploy, setDeploy] = useState<DeployView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restartState, setRestartState] = useState<RestartState>('idle');
  const [restartError, setRestartError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [llmOpen, setLlmOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [botTokenOpen, setBotTokenOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getDeploy(deployId)
      .then((view) => {
        if (active) setDeploy(view);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [deployId]);

  const status = deploy?.status ?? 'pending';
  const ready = status === 'ready';

  async function handleRestart(): Promise<void> {
    hapticImpact('medium');
    setRestartState('pending');
    setRestartError(null);
    try {
      await restartDeploy(deployId);
      setRestartState('done');
    } catch (err) {
      setRestartError(errorMessage(err));
      setRestartState('idle');
    }
  }

  async function handleDelete(): Promise<void> {
    hapticImpact('heavy');
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDeploy(deployId);
      onDeleted();
    } catch (err) {
      setDeleteError(errorMessage(err));
      setDeleting(false);
    }
  }

  if (deleteConfirm) {
    return (
      <section className="flex flex-1 flex-col gap-5">
        <BackLink label="◄ НАЗАД" onClick={() => setDeleteConfirm(false)} />
        <h2 className="text-sm tracking-wide text-alarm uppercase">Удалить агента?</h2>
        <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
          Сервер будет удалён <b className="text-alarm">безвозвратно</b>. Агент перестанет отвечать,
          данные восстановить нельзя. Точно?
        </p>
        {deleteError && <p className="text-[8px] tracking-wide text-alarm">{deleteError}</p>}
        <div className="mt-auto flex flex-col gap-2.5 pb-3">
          <PixelButton
            variant="accent"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="border-alarm bg-alarm"
          >
            {deleting ? 'Удаляем…' : 'Да, удалить сервер'}
          </PixelButton>
          <PixelButton variant="outline" disabled={deleting} onClick={() => setDeleteConfirm(false)}>
            Отмена
          </PixelButton>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ НАЗАД" onClick={onBack} />

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm tracking-wide uppercase">@{deploy?.bot_username ?? '…'}</h2>
        <span className={`text-[9px] tracking-wide ${STATUS_BADGE_CLASS[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {deploy?.bot_token_status === 'invalid' && (
        <p className="border-2 border-alarm p-2.5 text-[9px] tracking-wide text-alarm">
          ⚠ Токен бота невалиден — возможно, бот удалён в @BotFather. Смени токен ниже, VPS и ключи
          сохранятся.
        </p>
      )}

      {loadError && <p className="text-[8px] tracking-wide text-alarm">{loadError}</p>}

      {ready && deploy && (
        <PixelButton variant="ok" onClick={() => openBotChat(deploy.bot_username)}>
          Открыть @{deploy.bot_username}
        </PixelButton>
      )}

      <RestartBlock
        ready={ready}
        state={restartState}
        error={restartError}
        onAsk={() => {
          hapticImpact('light');
          setRestartState('confirm');
        }}
        onCancel={() => setRestartState('idle')}
        onConfirm={() => void handleRestart()}
      />

      <LlmKeyBlock
        deployId={deployId}
        ready={ready}
        open={llmOpen}
        onToggle={() => {
          hapticImpact('light');
          setLlmOpen((v) => !v);
        }}
        onUpdated={(view) => setDeploy(view)}
      />

      <TopupBlock
        deployId={deployId}
        ready={ready}
        open={topupOpen}
        onToggle={() => {
          hapticImpact('light');
          setTopupOpen((v) => !v);
        }}
      />

      <BotTokenBlock
        deployId={deployId}
        ready={ready}
        open={botTokenOpen}
        onToggle={() => {
          hapticImpact('light');
          setBotTokenOpen((v) => !v);
        }}
        onUpdated={() => void getDeploy(deployId).then(setDeploy).catch(() => {})}
      />

      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        <PixelButton
          variant="outline"
          onClick={() => {
            hapticImpact('light');
            setDeleteConfirm(true);
          }}
          className="border-alarm text-alarm"
        >
          Удалить агента
        </PixelButton>
      </div>
    </section>
  );
}

interface RestartBlockProps {
  ready: boolean;
  state: RestartState;
  error: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function RestartBlock({
  ready,
  state,
  error,
  onAsk,
  onCancel,
  onConfirm,
}: RestartBlockProps): ReactElement {
  return (
    <div className="flex flex-col gap-2.5">
      {state === 'idle' && (
        <PixelButton variant="outline" disabled={!ready} onClick={onAsk}>
          Перезапустить агента
        </PixelButton>
      )}
      {state === 'confirm' && (
        <>
          <p className="text-center text-[10px] text-dim">Точно перезапустить?</p>
          <div className="flex gap-2.5">
            <PixelButton variant="accent" className="flex-1" onClick={onConfirm}>
              Да
            </PixelButton>
            <PixelButton variant="outline" className="flex-1" onClick={onCancel}>
              Отмена
            </PixelButton>
          </div>
        </>
      )}
      {state === 'pending' && (
        <PixelButton variant="outline" disabled>
          Перезапускаем…
        </PixelButton>
      )}
      {state === 'done' && (
        <p className="text-center text-[9px] tracking-wide text-ok">✓ агент перезапускается</p>
      )}
      {error && <p className="text-[8px] tracking-wide text-alarm">{error}</p>}
    </div>
  );
}

interface LlmKeyBlockProps {
  deployId: string;
  ready: boolean;
  open: boolean;
  onToggle: () => void;
  onUpdated: (view: DeployView) => void;
}

type LlmState = 'idle' | 'saving' | 'success';

function LlmKeyBlock({ deployId, ready, open, onToggle, onUpdated }: LlmKeyBlockProps): ReactElement {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [state, setState] = useState<LlmState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || providers.length > 0) return;
    fetchProviders()
      .then(setProviders)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [open, providers.length]);

  const provider = providers.find((p) => p.id === providerId);
  const isCustom = providerId === 'custom';
  const needsModel = provider ? provider.default_model === '' : isCustom;
  const fieldsFilled =
    apiKey.trim().length > 0 &&
    providerId.length > 0 &&
    (!isCustom || baseUrl.trim().length > 0) &&
    (!needsModel || model.trim().length > 0);
  const canSubmit = ready && fieldsFilled && state !== 'saving';

  function reset(): void {
    setState('idle');
    setError(null);
  }

  async function handleSubmit(): Promise<void> {
    hapticImpact('medium');
    setState('saving');
    setError(null);
    try {
      await updateLlmKey(deployId, {
        provider_id: providerId,
        api_key: apiKey.trim(),
        ...(isCustom ? { base_url: baseUrl.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      setState('success');
      setApiKey('');
      getDeploy(deployId)
        .then(onUpdated)
        .catch(() => {});
    } catch (err) {
      setError(llmKeyErrorMessage(err));
      setState('idle');
    }
  }

  if (!open) {
    return (
      <PixelButton variant="outline" onClick={onToggle}>
        Сменить LLM-ключ
      </PixelButton>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-2 border-edge p-3.5">
      <button
        type="button"
        onClick={onToggle}
        className="text-left text-[10px] tracking-wide text-dim uppercase"
      >
        ▾ Сменить LLM-ключ
      </button>

      <div className="flex flex-col gap-2">
        {providers.map((p) => {
          const meta = providerMeta(p);
          const selected = p.id === providerId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProviderId(p.id);
                reset();
              }}
              className={`flex items-center justify-between gap-2 border-2 p-3 text-left text-[10px] ${
                selected ? 'border-accent' : 'border-edge'
              }`}
            >
              <span>
                {selected && <span className="text-accent">► </span>}
                {meta.label}
              </span>
              <span className="text-right text-[9px] text-dim">{meta.note}</span>
            </button>
          );
        })}
      </div>

      {providerId && (
        <>
          {isCustom && (
            <PixelInput
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                reset();
              }}
              placeholder="https://api.example.com/v1"
            />
          )}
          {needsModel && (
            <PixelInput
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                reset();
              }}
              placeholder="openai/gpt-4o-mini"
            />
          )}
          <PixelInput
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              reset();
            }}
            placeholder="Вставь новый API-ключ…"
          />
          <p className="text-[8px] leading-relaxed text-dim">
            Ключ показывается один раз при создании — вставь новый целиком.
          </p>
        </>
      )}

      {state === 'success' && (
        <p className="text-[8px] tracking-wide text-ok">✓ ключ обновлён · агент перезапускается</p>
      )}
      {error && <p className="text-[8px] tracking-wide text-alarm">{error}</p>}

      <PixelButton variant="accent" disabled={!canSubmit} onClick={() => void handleSubmit()}>
        {state === 'saving' ? 'Проверяем ключ…' : 'Сохранить ключ'}
      </PixelButton>
    </div>
  );
}

interface TopupBlockProps {
  deployId: string;
  ready: boolean;
  open: boolean;
  onToggle: () => void;
}

type TopupState = 'idle' | 'pending' | 'success';

function TopupBlock({ deployId, ready, open, onToggle }: TopupBlockProps): ReactElement {
  const [tiers, setTiers] = useState<TopupTierView[]>([]);
  const [selected, setSelected] = useState<TopupTierView | null>(null);
  const [state, setState] = useState<TopupState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || tiers.length > 0) return;
    getTopupTiers()
      .then(setTiers)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [open, tiers.length]);

  async function handleTopup(): Promise<void> {
    if (!selected) return;
    hapticImpact('medium');
    setState('pending');
    setError(null);
    try {
      await topupDeploy(deployId, selected.amount_usd);
      setState('success');
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  }

  if (!ready) return <></>;

  if (!open) {
    return (
      <PixelButton variant="outline" onClick={onToggle}>
        Пополнить токены
      </PixelButton>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-2 border-edge p-3.5">
      <button
        type="button"
        onClick={onToggle}
        className="text-left text-[10px] tracking-wide text-dim uppercase"
      >
        ▾ Пополнить токены
      </button>

      {tiers.length === 0 && (
        <p className="text-[8px] leading-relaxed text-dim">Доплата пока не настроена.</p>
      )}

      <div className="flex flex-col gap-2">
        {tiers.map((t) => {
          const isActive = selected?.amount_usd === t.amount_usd;
          return (
            <button
              key={t.amount_usd}
              type="button"
              onClick={() => {
                setSelected(t);
                setState('idle');
                setError(null);
              }}
              className={`flex items-center justify-between gap-2 border-2 p-3 text-left text-[10px] ${
                isActive ? 'border-accent' : 'border-edge'
              }`}
            >
              <span>
                {isActive && <span className="text-accent">► </span>}+${t.amount_usd}
              </span>
              <span className="text-[9px] text-dim">${t.price_usd}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <PixelButton variant="outline" onClick={() => openTelegramUrl(selected.subscribe_url)}>
          Оплатить ${selected.price_usd} в @tribute →
        </PixelButton>
      )}

      {state === 'success' && (
        <p className="text-[8px] tracking-wide text-ok">✓ лимит поднят · агент работает дальше</p>
      )}
      {error && <p className="text-[8px] tracking-wide text-alarm">{error}</p>}

      <PixelButton
        variant="accent"
        disabled={!selected || state === 'pending'}
        onClick={() => void handleTopup()}
      >
        {state === 'pending' ? 'Пополняем…' : '✓ Я оплатил — поднять лимит'}
      </PixelButton>
    </div>
  );
}

interface BotTokenBlockProps {
  deployId: string;
  ready: boolean;
  open: boolean;
  onToggle: () => void;
  onUpdated: () => void;
}

type BotTokenState = 'idle' | 'saving' | 'success';

function BotTokenBlock({
  deployId,
  ready,
  open,
  onToggle,
  onUpdated,
}: BotTokenBlockProps): ReactElement {
  const [token, setToken] = useState('');
  const [state, setState] = useState<BotTokenState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    hapticImpact('medium');
    setState('saving');
    setError(null);
    try {
      await updateBotToken(deployId, token.trim());
      setState('success');
      setToken('');
      onUpdated();
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  }

  if (!ready) return <></>;

  if (!open) {
    return (
      <PixelButton variant="outline" onClick={onToggle}>
        Сменить токен бота
      </PixelButton>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-2 border-edge p-3.5">
      <button
        type="button"
        onClick={onToggle}
        className="text-left text-[10px] tracking-wide text-dim uppercase"
      >
        ▾ Сменить токен бота
      </button>
      <p className="text-[8px] leading-relaxed text-dim">
        Если удалил бота в @BotFather — создай нового и вставь новый токен сюда. VPS и ключи
        сохранятся, агент перезапустится с новым ботом.
      </p>
      <PixelButton variant="outline" onClick={() => openTelegramUrl('https://t.me/botfather')}>
        Открыть @BotFather →
      </PixelButton>
      <PixelInput
        type="text"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setState('idle');
          setError(null);
        }}
        placeholder="123456:ABC-DEF…"
      />
      {state === 'success' && (
        <p className="text-[8px] tracking-wide text-ok">✓ токен обновлён · агент перезапускается</p>
      )}
      {error && <p className="text-[8px] tracking-wide text-alarm">{error}</p>}
      <PixelButton
        variant="accent"
        disabled={token.trim().length === 0 || state === 'saving'}
        onClick={() => void handleSubmit()}
      >
        {state === 'saving' ? 'Сохраняем…' : 'Сохранить токен'}
      </PixelButton>
    </div>
  );
}
