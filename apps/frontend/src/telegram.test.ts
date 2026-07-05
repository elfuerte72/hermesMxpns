import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInitData, hapticImpact, initTelegram, openBotChat } from './telegram';

afterEach(() => {
  delete window.Telegram;
  vi.unstubAllGlobals();
});

describe('getInitData', () => {
  it('returns the Telegram initData when present', () => {
    window.Telegram = { WebApp: { initData: 'abc=1&hash=x', ready: () => {}, expand: () => {} } };
    expect(getInitData()).toBe('abc=1&hash=x');
  });

  it('falls back to empty string outside Telegram', () => {
    expect(getInitData()).toBe('');
  });
});

describe('initTelegram', () => {
  it('signals ready and expands when the bridge exists', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    window.Telegram = { WebApp: { initData: '', ready, expand } };
    initTelegram();
    expect(ready).toHaveBeenCalled();
    expect(expand).toHaveBeenCalled();
  });

  it('is a no-op outside Telegram', () => {
    expect(() => initTelegram()).not.toThrow();
  });
});

describe('hapticImpact', () => {
  it('forwards the style to the Telegram bridge', () => {
    const impactOccurred = vi.fn();
    window.Telegram = {
      WebApp: {
        initData: '',
        ready: () => {},
        expand: () => {},
        HapticFeedback: { impactOccurred },
      },
    };
    hapticImpact('light');
    expect(impactOccurred).toHaveBeenCalledWith('light');
  });

  it('defaults to a light impact', () => {
    const impactOccurred = vi.fn();
    window.Telegram = {
      WebApp: {
        initData: '',
        ready: () => {},
        expand: () => {},
        HapticFeedback: { impactOccurred },
      },
    };
    hapticImpact();
    expect(impactOccurred).toHaveBeenCalledWith('light');
  });

  it('is a no-op outside Telegram', () => {
    expect(() => hapticImpact()).not.toThrow();
  });

  it('is a no-op when the bridge has no HapticFeedback', () => {
    window.Telegram = { WebApp: { initData: '', ready: () => {}, expand: () => {} } };
    expect(() => hapticImpact()).not.toThrow();
  });
});

describe('openBotChat', () => {
  it('uses the Telegram deep-link opener when available', () => {
    const openTelegramLink = vi.fn();
    window.Telegram = {
      WebApp: { initData: '', ready: () => {}, expand: () => {}, openTelegramLink },
    };
    openBotChat('coolbot');
    expect(openTelegramLink).toHaveBeenCalledWith('https://t.me/coolbot');
  });

  it('falls back to window.open outside Telegram', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    openBotChat('coolbot');
    expect(open).toHaveBeenCalledWith('https://t.me/coolbot', '_blank');
  });
});
