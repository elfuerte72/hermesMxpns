import type { ReactElement } from 'react';
import { openTelegramUrl } from '../telegram';
import { BackLink, PixelButton } from './ui';

interface AboutScreenProps {
  onBack: () => void;
  onCreate: () => void;
}

const FEATURES: ReadonlyArray<{ icon: string; title: string; desc: string }> = [
  {
    icon: '🧠',
    title: 'Память',
    desc: 'Помнит ваши задачи и разговоры — не нужно повторять контекст каждый раз',
  },
  {
    icon: '🔍',
    title: 'Веб-поиск',
    desc: 'Сам ищет информацию в интернете, проверяет источники и делает выжимку',
  },
  {
    icon: '📁',
    title: 'Работа с файлами',
    desc: 'Читает, пишет и редактирует документы, код, таблицы и картинки',
  },
  {
    icon: '⏰',
    title: 'Расписание',
    desc: 'Выполняет поручения по таймеру — ежедневные отчёты, мониторинг, дайджесты',
  },
  {
    icon: '🛠️',
    title: 'Инструменты',
    desc: 'Вызывает внешние API, выполняет код в песочнице, работает с базами данных',
  },
  {
    icon: '🔒',
    title: 'Изоляция',
    desc: 'Отдельный сервер только под вас — переписка и ключи не уходят третьим лицам',
  },
];

const STEPS: ReadonlyArray<{ n: string; text: string }> = [
  { n: '01', text: 'Создаёте бота в @BotFather и вставляете токен' },
  { n: '02', text: 'Оплачиваете подписку — мы выдаём ИИ-ключ и поднимаем сервер' },
  { n: '03', text: 'Через ~3 минуты бот отвечает вам в Telegram' },
];

const YOUTUBE_REVIEWS: ReadonlyArray<{ title: string; url: string }> = [
  {
    title: 'Hermes Agent — полный обзор (Eng)',
    url: 'https://www.youtube.com/results?search_query=hermes+agent+nous+research+review',
  },
  {
    title: 'Как работает ИИ-агент в Telegram (Eng)',
    url: 'https://www.youtube.com/results?search_query=hermes+ai+agent+telegram+tutorial',
  },
];

export function AboutScreen({ onBack, onCreate }: AboutScreenProps): ReactElement {
  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ НАЗАД" onClick={onBack} />

      <h2 className="text-sm tracking-wide uppercase">Что такое Hermes</h2>

      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        <b className="text-ink">Hermes</b> — открытый ИИ-агент от{' '}
        <b className="text-ink">Nous Research</b>. Это не просто чат-бот, а автономный помощник,
        который живёт на вашем собственном сервере и работает 24/7 прямо в Telegram.
      </p>

      <div className="border-2 border-edge p-3.5">
        <p className="mb-3 text-[9px] tracking-[0.2em] text-accent uppercase">Что умеет</p>
        <div className="flex flex-col gap-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-2.5">
              <span className="text-sm leading-none">{f.icon}</span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] tracking-wide text-ink uppercase">{f.title}</span>
                <span className="text-[9px] leading-[1.7] text-dim">{f.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-2 border-edge p-3.5">
        <p className="mb-3 text-[9px] tracking-[0.2em] text-accent uppercase">Как это работает</p>
        <div className="flex flex-col gap-2.5">
          {STEPS.map((step) => (
            <div key={step.n} className="flex items-baseline gap-2.5 text-[10px] text-[#cfcfda]">
              <i className="text-accent not-italic">{step.n}</i>
              <span>{step.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-2 border-edge p-3.5">
        <p className="mb-3 text-[9px] tracking-[0.2em] text-accent uppercase">
          Обзоры на YouTube
        </p>
        <div className="flex flex-col gap-2">
          {YOUTUBE_REVIEWS.map((v) => (
            <button
              key={v.url}
              type="button"
              onClick={() => openTelegramUrl(v.url)}
              className="border-2 border-edge p-2.5 text-left text-[9px] tracking-wide text-dim hover:border-accent"
            >
              ▶ {v.title}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] leading-[1.9] text-[#cfcfda]">
        Ключи хранятся в зашифрованном виде, сервер не делится ни с кем. Надоело — удалите агента
        одной кнопкой, сервер исчезнет.
      </p>

      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        <PixelButton variant="accent" onClick={onCreate}>
          ▶ Создать агента
        </PixelButton>
      </div>
    </section>
  );
}
