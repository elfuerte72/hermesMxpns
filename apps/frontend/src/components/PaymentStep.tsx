import { useState, type ReactElement } from 'react';
import { checkSubscription, createDeploy } from '../api';
import { errorMessage } from '../error-messages';
import { openTelegramUrl } from '../telegram';
import { BackLink, PixelButton, StepLine } from './ui';

/** @tribute subscribe entry — operator replaces with the exact creator deep-link. */
const TRIBUTE_SUBSCRIBE_URL = 'https://t.me/tribute';
const PRICE_LABEL = '7900 ₽/мес';

interface PaymentStepProps {
  botToken: string;
  onBack: () => void;
  onDeployed: (deployId: string) => void;
}

export function PaymentStep({ botToken, onBack, onDeployed }: PaymentStepProps): ReactElement {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const { subscription_status } = await checkSubscription();
      if (subscription_status !== 'active') {
        setError(
          'Подписка ещё не активна. Если только что оплатил — подожди минуту и нажми ещё раз.',
        );
        setCreating(false);
        return;
      }
      const { deploy_id } = await createDeploy({ bot_token: botToken.trim() });
      onDeployed(deploy_id);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ ШАГ 1" onClick={onBack} />
      <StepLine step="ШАГ 2" title="/ 2 — ОПЛАТА" />
      <h2 className="text-sm tracking-wide uppercase">Подписка</h2>
      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        Агент стоит <b className="text-ink">{PRICE_LABEL}</b>. Оплата в <b className="text-ink">@tribute</b> —
        рубли или карта «Мир», отмена в один клик. После оплаты ты попадаёшь в закрытый канал «Hermes» —
        это и есть твоя подписка.
      </p>
      <PixelButton variant="outline" onClick={() => openTelegramUrl(TRIBUTE_SUBSCRIBE_URL)}>
        Открыть @tribute →
      </PixelButton>
      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        Оплатил? Жми ниже — проверим подписку и запустим твоего агента. API-ключ мы выдадим сами.
      </p>
      {error && <p className="text-[8px] tracking-wide text-red-400">{error}</p>}
      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        <PixelButton variant="accent" disabled={creating} onClick={() => void handleCreate()}>
          {creating ? 'Запускаем…' : '✓ Я оплатил — создать агента'}
        </PixelButton>
      </div>
    </section>
  );
}
