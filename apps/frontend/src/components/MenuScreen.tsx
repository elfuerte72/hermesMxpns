import type { ReactElement } from 'react';
import logo from '../assets/logo.png';
import { formatPriceRub } from '../config';
import { PixelButton } from './ui';

interface MenuScreenProps {
  onCreate: () => void;
  onAbout: () => void;
}

export function MenuScreen({ onCreate, onAbout }: MenuScreenProps): ReactElement {
  return (
    <section className="flex flex-1 flex-col gap-5">
      <div className="flex justify-between text-[10px] tracking-[0.2em] text-dim uppercase">
        <span>HERMES</span>
        <span>v1.0</span>
      </div>

      <div className="mt-[8vh] text-center">
        <h1 className="sr-only">Hermes Agent</h1>
        <img src={logo} alt="Hermes Agent" className="mx-auto w-[272px] max-w-[82%]" />
        <p className="mt-3 text-[11px] tracking-[0.14em] text-dim uppercase">
          Твой ИИ-агент в Telegram
        </p>
      </div>

      <div className="mt-auto mb-[8vh] flex flex-col gap-3.5">
        <PixelButton variant="accent" onClick={onCreate}>
          ▶ Создать агента
        </PixelButton>
        <PixelButton onClick={onAbout}>Об агенте</PixelButton>
        <p className="text-center text-[9px] leading-relaxed text-dim">
          Свой сервер + агент — <b className="text-accent">от {formatPriceRub()}</b>
          <br />
          оплата после успешного запуска
        </p>
      </div>
    </section>
  );
}
