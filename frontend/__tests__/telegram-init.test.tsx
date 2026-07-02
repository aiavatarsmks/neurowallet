/**
 * Регрессия: в обычном браузере telegram-web-app.js объявляет версию 6.0,
 * и методы новее (requestFullscreen 8.0+, цвета 6.1+, свайпы 7.7+)
 * СУЩЕСТВУЮТ, но бросают WebAppMethodUnsupported. Исключение в useEffect
 * роняло всё приложение ("Application error: a client-side exception").
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTelegramInit, useTelegram } from '@/hooks/useTelegram';

function throwUnsupported(): never {
  throw new Error('WebAppMethodUnsupported');
}

/** SDK, каким его видит обычный браузер: version 6.0, всё новое бросает. */
function installLegacyWebApp() {
  const calls: string[] = [];
  const wa = {
    initData: '',
    initDataUnsafe: {},
    version: '6.0',
    isVersionAtLeast: (v: string) => parseFloat(v) <= 6.0,
    ready: () => { calls.push('ready'); },
    expand: () => { calls.push('expand'); },
    close: () => {},
    setHeaderColor: throwUnsupported,
    setBackgroundColor: throwUnsupported,
    setBottomBarColor: throwUnsupported,
    disableVerticalSwipes: throwUnsupported,
    requestFullscreen: () => { calls.push('requestFullscreen'); throwUnsupported(); },
    HapticFeedback: {
      notificationOccurred: throwUnsupported,
      impactOccurred: throwUnsupported,
      selectionChanged: throwUnsupported,
    },
    showAlert: throwUnsupported,
    showConfirm: throwUnsupported,
    MainButton: { setText: () => {}, onClick: () => {}, offClick: () => {}, show: () => {}, hide: () => {}, enable: () => {}, disable: () => {}, showProgress: () => {}, hideProgress: () => {} },
    BackButton: { onClick: () => {}, offClick: () => {}, show: () => {}, hide: () => {} },
  };
  (window as unknown as { Telegram?: unknown }).Telegram = { WebApp: wa };
  return calls;
}

function InitProbe() {
  useTelegramInit();
  return <div data-testid="alive">ok</div>;
}

function HookProbe() {
  const { haptic, alert, ready } = useTelegram();
  haptic.success();
  alert('test');
  ready();
  return <div data-testid="alive2">ok</div>;
}

describe('Telegram SDK guards (plain browser / old clients)', () => {
  let calls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = installLegacyWebApp();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it('useTelegramInit does not crash when SDK methods throw (v6.0)', () => {
    const { getByTestId } = render(<InitProbe />);
    expect(getByTestId('alive').textContent).toBe('ok');
    // базовые вызовы прошли, fullscreen не вызывался (гейт 8.0)
    expect(calls).toContain('ready');
    expect(calls).toContain('expand');
    expect(calls).not.toContain('requestFullscreen');
    // отложенные expand/fullscreen тоже не роняют
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(calls).not.toContain('requestFullscreen');
  });

  it('useTelegram wrappers (haptic/alert/ready) swallow unsupported-method throws', () => {
    const { getByTestId } = render(<HookProbe />);
    expect(getByTestId('alive2').textContent).toBe('ok');
  });
});
