import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement } from 'react';

type PixelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'accent' | 'outline' | 'ok';
};

const BUTTON_VARIANTS: Record<NonNullable<PixelButtonProps['variant']>, string> = {
  accent: 'border-accent bg-accent text-bg',
  outline: 'border-ink bg-transparent text-ink',
  ok: 'border-ok bg-ok text-bg',
};

export function PixelButton({
  variant = 'outline',
  className = '',
  type = 'button',
  ...props
}: PixelButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={`border-2 p-4 text-center font-pixel text-xs tracking-wider uppercase focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-dashed focus-visible:outline-accent disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function PixelInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return (
    <input
      className={`w-full border-2 border-edge bg-field p-3.5 font-pixel text-[10px] text-ink placeholder:text-[#5a5a70] focus:border-accent focus:outline-none ${className}`}
      autoComplete="off"
      {...props}
    />
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start text-left text-[11px] tracking-widest text-dim"
    >
      {label}
    </button>
  );
}

export function StepLine({ step, title }: { step: string; title: string }): ReactElement {
  return (
    <div className="text-[10px] tracking-[0.2em] text-dim">
      <b className="text-accent">{step}</b> {title}
    </div>
  );
}
