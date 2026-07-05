import type { ReactElement } from 'react';
import { formatPriceRub } from '../config';
import { BackLink, PixelButton } from './ui';

interface AboutScreenProps {
  onBack: () => void;
  onCreate: () => void;
}

const STEPS: ReadonlyArray<{ n: string; text: ReactElement }> = [
  { n: '01', text: <>Вы даёте токен бота и ключ ИИ-провайдера</> },
  {
    n: '02',
    text: (
      <>
        Мы поднимаем для вас <b className="text-ink">отдельный сервер</b> — агент только ваш
      </>
    ),
  },
  { n: '03', text: <>Через ~3 минуты бот отвечает вам в Telegram</> },
];

export function AboutScreen({ onBack, onCreate }: AboutScreenProps): ReactElement {
  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ НАЗАД" onClick={onBack} />
      <h2 className="text-sm tracking-wide uppercase">Что такое Hermes</h2>
      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        <b className="text-ink">Hermes</b> — открытый ИИ-агент от Nous Research (209 000 ★ на
        GitHub). Это не просто чат-бот: он <b className="text-ink">помнит</b> ваши разговоры и
        задачи, <b className="text-ink">учится</b> на них и умеет{' '}
        <b className="text-ink">действовать</b> — искать в интернете, работать с файлами, выполнять
        поручения по расписанию.
      </p>

      {STEPS.map((step) => (
        <div key={step.n} className="flex items-baseline gap-2.5 text-[10px] text-[#cfcfda]">
          <i className="text-accent not-italic">{step.n}</i>
          <span>{step.text}</span>
        </div>
      ))}

      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        Ключи хранятся в зашифрованном виде, сервер не делится ни с кем. Надоело — удалите агента
        одной кнопкой.
      </p>

      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        <PixelButton variant="accent" onClick={onCreate}>
          ▶ Создать агента
        </PixelButton>
        <p className="text-center text-[8px] tracking-wide text-dim">
          от {formatPriceRub()} · без карты для старта не обойтись: нужен ключ ИИ (есть бесплатный
          Groq)
        </p>
      </div>
    </section>
  );
}
