/**
 * hooks/useTelegram.ts
 * Thin wrapper around the Telegram Web App SDK.
 * Safe to call on web too — returns isInTelegram=false when not inside Telegram.
 */

import { useEffect, useRef } from 'react';

// Extend Window for Telegram WebApp type
declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface TelegramWebApp {
  initData:       string;
  initDataUnsafe: {
    user?: {
      id:         number;
      first_name: string;
      last_name?: string;
      username?:  string;
      photo_url?: string;
      language_code?: string;
    };
    auth_date: number;
    hash:      string;
  };
  version:        string;
  colorScheme:    'light' | 'dark';
  themeParams: {
    bg_color?:          string;
    text_color?:        string;
    hint_color?:        string;
    link_color?:        string;
    button_color?:      string;
    button_text_color?: string;
  };
  isExpanded:     boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  MainButton: {
    text:     string;
    color:    string;
    textColor: string;
    isVisible: boolean;
    isActive:  boolean;
    setText:  (text: string) => void;
    onClick:  (fn: () => void) => void;
    offClick: (fn: () => void) => void;
    show:     () => void;
    hide:     () => void;
    enable:   () => void;
    disable:  () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  BackButton: {
    isVisible: boolean;
    onClick:   (fn: () => void) => void;
    offClick:  (fn: () => void) => void;
    show:      () => void;
    hide:      () => void;
  };
  ready:         () => void;
  expand:        () => void;
  close:         () => void;
  requestFullscreen?: () => void;
  exitFullscreen?:    () => void;
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?:  () => void;
  showAlert:     (message: string, callback?: () => void) => void;
  showConfirm:   (message: string, callback: (ok: boolean) => void) => void;
  showPopup:     (params: object, callback?: (id: string) => void) => void;
  HapticFeedback: {
    impactOccurred:    (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged:  () => void;
  };
  setHeaderColor:      (color: string) => void;
  setBackgroundColor:  (color: string) => void;
  setBottomBarColor?:  (color: string) => void;
  enableClosingConfirmation:  () => void;
  disableClosingConfirmation: () => void;
}

function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

export function useTelegram() {
  const webApp        = getWebApp();
  const isInTelegram  = !!(webApp?.initData);
  const tgUser        = webApp?.initDataUnsafe?.user ?? null;

  return {
    webApp,
    isInTelegram,
    tgUser,
    initData: webApp?.initData ?? '',

    // Lifecycle
    ready:  () => webApp?.ready(),
    expand: () => webApp?.expand(),
    close:  () => webApp?.close(),

    // Haptics
    haptic: {
      success: () => webApp?.HapticFeedback.notificationOccurred('success'),
      error:   () => webApp?.HapticFeedback.notificationOccurred('error'),
      tap:     () => webApp?.HapticFeedback.impactOccurred('light'),
    },

    // Alerts
    alert:   (msg: string) => webApp?.showAlert(msg),
    confirm: (msg: string, cb: (ok: boolean) => void) => webApp?.showConfirm(msg, cb),

    // MainButton helpers
    mainButton: {
      show:     (text: string, onClick: () => void) => {
        if (!webApp) return;
        webApp.MainButton.setText(text);
        webApp.MainButton.onClick(onClick);
        webApp.MainButton.show();
        webApp.MainButton.enable();
      },
      hide:     () => webApp?.MainButton.hide(),
      loading:  () => { webApp?.MainButton.showProgress(); webApp?.MainButton.disable(); },
      done:     (text: string) => { webApp?.MainButton.setText(text); webApp?.MainButton.enable(); webApp?.MainButton.hideProgress(); },
    },

    // BackButton helpers
    backButton: {
      show: (onClick: () => void) => {
        if (!webApp) return;
        webApp.BackButton.onClick(onClick);
        webApp.BackButton.show();
      },
      hide: () => webApp?.BackButton.hide(),
    },

    // Theme
    colorScheme: webApp?.colorScheme ?? 'dark',
    themeParams: webApp?.themeParams ?? {},
  };
}

// One-time initialization hook — call in _app.tsx
export function useTelegramInit() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;

    let cancelled = false;
    const timers: number[] = [];

    const init = (attempt = 0) => {
      if (cancelled || initialized.current) return;

      const wa = getWebApp();
      if (!wa) {
        if (attempt < 12) {
          timers.push(window.setTimeout(() => init(attempt + 1), 120));
        }
        return;
      }

      initialized.current = true;

      wa.ready();
      wa.setHeaderColor('#080C09');
      wa.setBackgroundColor('#080C09');
      wa.setBottomBarColor?.('#080C09');
      wa.disableVerticalSwipes?.();
      wa.expand();
      wa.requestFullscreen?.();

      // iOS Telegram can apply the first expand before layout is stable.
      timers.push(window.setTimeout(() => wa.expand(), 80));
      timers.push(window.setTimeout(() => wa.expand(), 350));
      timers.push(window.setTimeout(() => wa.requestFullscreen?.(), 500));
    };

    init();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);
}
