/** Minimal typing over the Telegram Web App JS bridge (window.Telegram.WebApp). */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id?: number; username?: string } };
  ready: () => void;
  expand: () => void;
  openTelegramLink?: (url: string) => void;
  colorScheme?: 'light' | 'dark';
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * Raw initData for the Authorization header. Falls back to VITE_DEV_INIT_DATA
 * when running outside a Telegram client (dev).
 */
export function getInitData(): string {
  const webApp = getWebApp();
  if (webApp?.initData) return webApp.initData;
  return import.meta.env.VITE_DEV_INIT_DATA ?? '';
}

/** Signal readiness and expand to full height. Safe outside Telegram. */
export function initTelegram(): void {
  const webApp = getWebApp();
  webApp?.ready();
  webApp?.expand();
}

/** Open a chat with the given bot, via Telegram when available. */
export function openBotChat(username: string): void {
  const url = `https://t.me/${username}`;
  const webApp = getWebApp();
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank');
  }
}
