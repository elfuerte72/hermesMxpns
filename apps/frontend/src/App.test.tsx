import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  delete window.Telegram;
  vi.unstubAllGlobals();
});

function renderApp(): void {
  act(() => {
    root.render(<App />);
  });
}

function clickButton(text: string): void {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('App routing', () => {
  it('renders the game menu by default', () => {
    renderApp();
    expect(container.textContent).toContain('HERMES');
    expect(container.textContent).toContain('Твой ИИ-агент в Telegram');
    expect(container.textContent).toContain('▶ Создать агента');
    expect(container.textContent).toContain('₽/мес');
  });

  it('navigates menu → step 1 on «Создать агента»', () => {
    renderApp();
    clickButton('Создать агента');
    expect(container.textContent).toContain('ШАГ 1');
    expect(container.textContent).toContain('Подключи своего бота');
    expect(container.textContent).toContain('@BotFather');
  });

  it('navigates menu → about and back', () => {
    renderApp();
    clickButton('Об агенте');
    expect(container.textContent).toContain('Что такое Hermes');
    expect(container.textContent).toContain('Nous Research');
    clickButton('◄ НАЗАД');
    expect(container.textContent).toContain('Твой ИИ-агент в Telegram');
  });

  it('fires a light haptic impact on screen change', () => {
    const impactOccurred = vi.fn();
    window.Telegram = {
      WebApp: {
        initData: '',
        ready: () => {},
        expand: () => {},
        HapticFeedback: { impactOccurred },
      },
    };
    renderApp();
    clickButton('Создать агента');
    expect(impactOccurred).toHaveBeenCalledWith('light');
  });
});
