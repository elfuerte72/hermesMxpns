import { useState, type ReactElement } from 'react';
import { validateBotToken } from '../api';
import { errorMessage } from '../error-messages';
import { BackLink, PixelButton, PixelInput, StepLine } from './ui';

interface BotTokenStepProps {
  botToken: string;
  botUsername: string | null;
  onTokenChange: (token: string) => void;
  onValidated: (username: string | null) => void;
  onBack: () => void;
  onNext: () => void;
}

export function BotTokenStep({
  botToken,
  botUsername,
  onTokenChange,
  onValidated,
  onBack,
  onNext,
}: BotTokenStepProps): ReactElement {
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleValidate(): Promise<void> {
    setValidating(true);
    setError(null);
    try {
      const { username } = await validateBotToken(botToken.trim());
      onValidated(username);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setValidating(false);
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ МЕНЮ" onClick={onBack} />
      <StepLine step="ШАГ 1" title="/ 2 — ТОКЕН БОТА" />
      <h2 className="text-sm tracking-wide uppercase">Подключи своего бота</h2>
      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        Открой <b className="text-ink">@BotFather</b> → «/newbot» → скопируй токен сюда. Бот станет
        лицом твоего агента.
      </p>

      <PixelInput
        type="text"
        value={botToken}
        onChange={(e) => {
          onTokenChange(e.target.value);
          onValidated(null);
          setError(null);
        }}
        placeholder="123456:ABC-DEF…"
      />

      {botUsername && <p className="text-[8px] tracking-wide text-ok">✓ @{botUsername} найден</p>}
      {error && <p className="text-[8px] tracking-wide text-red-400">{error}</p>}

      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        <PixelButton
          variant="accent"
          disabled={validating || botToken.trim().length === 0}
          onClick={() => {
            if (botUsername) onNext();
            else void handleValidate();
          }}
        >
          {validating ? 'Проверяем…' : botUsername ? 'Продолжить ►' : 'Проверить токен'}
        </PixelButton>
      </div>
    </section>
  );
}
