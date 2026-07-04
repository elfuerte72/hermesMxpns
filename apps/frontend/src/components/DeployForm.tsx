import { useEffect, useState, type ReactElement } from 'react';
import type { CreateDeployRequest, LlmProvider } from '@hermes/shared';
import { ApiError, createDeploy, fetchProviders, validateBotToken } from '../api';

interface DeployFormProps {
  onDeployed: (deployId: string) => void;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Что-то пошло не так';
}

export function DeployForm({ onDeployed }: DeployFormProps): ReactElement {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders()
      .then((list) => {
        setProviders(list);
        if (list.length > 0) setProviderId(list[0].id);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  const isCustom = providerId === 'custom';
  const canSubmit =
    botToken.trim().length > 0 &&
    providerId.length > 0 &&
    llmKey.trim().length > 0 &&
    (!isCustom || (baseUrl.trim().length > 0 && model.trim().length > 0)) &&
    !submitting;

  async function handleValidate(): Promise<void> {
    setValidating(true);
    setError(null);
    setBotUsername(null);
    try {
      const { username } = await validateBotToken(botToken.trim());
      setBotUsername(username);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setValidating(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateDeployRequest = {
        bot_token: botToken.trim(),
        llm_provider: providerId,
        llm_key: llmKey.trim(),
        ...(isCustom ? { llm_base_url: baseUrl.trim(), llm_model: model.trim() } : {}),
      };
      const { deploy_id } = await createDeploy(body);
      onDeployed(deploy_id);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <header className="text-center">
        <h1 className="text-xl font-bold text-slate-900">Развернуть Hermes-агента</h1>
        <p className="mt-1 text-sm text-slate-500">Введите данные — мы поднимем сервер за пару минут.</p>
      </header>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Токен Telegram-бота
        <div className="flex gap-2">
          <input
            type="text"
            value={botToken}
            onChange={(e) => {
              setBotToken(e.target.value);
              setBotUsername(null);
            }}
            placeholder="123456:ABC-DEF…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={handleValidate}
            disabled={validating || botToken.trim().length === 0}
            className="shrink-0 rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            {validating ? '…' : 'Проверить'}
          </button>
        </div>
        {botUsername && (
          <span className="text-xs font-normal text-green-600">✓ @{botUsername}</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        LLM-провайдер
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {isCustom && (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Base URL провайдера
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Модель
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model-name"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Ключ LLM-провайдера
        <input
          type="password"
          value={llmKey}
          onChange={(e) => setLlmKey(e.target.value)}
          placeholder="sk-…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          autoComplete="off"
        />
      </label>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? 'Разворачиваем…' : 'Развернуть'}
      </button>
    </form>
  );
}
