# Задача: починить Demo mode и PIN gate

## Контекст

NeuroWallet — Telegram Mini App. Фронтенд: Next.js + Supabase auth.
Репо: `frontend/` внутри этого репозитория.

## Что происходит сейчас (баги)

### Баг 1 — главный: Demo недоступен из Telegram

**Поток:**
1. Пользователь открывает мини-апп
2. `AuthContext` (файл `frontend/contexts/AuthContext.tsx`) обнаруживает `window.Telegram.WebApp.initData`
3. Автоматически делает POST `/api/tg-auth` → получает Supabase session
4. Устанавливает `user = realUser, isLoading = false`
5. `wallet.tsx` видит `user != null` → рендерит wallet
6. Там же PIN gate: `!isDemo && pinRequired && walletPassword === null` → **показывает экран PIN**
7. Пользователь оказывается на экране PIN без возможности перейти в Demo

Кнопка «Режим демо» находится на `pages/auth.tsx` — но пользователь туда НИКОГДА не попадает, потому что TG auth автоматически редиректит на `/wallet`.

**Нужно:** добавить кнопку «Войти в демо» прямо на экран PinEntry.

---

### Баг 2: Demo mode показывает реальные данные

Когда `isDemo === true`, некоторые компоненты всё равно читают реальные адреса/балансы из localStorage и показывают их вместо демо-данных.

---

## Архитектура auth (важно понять перед правкой)

### `frontend/contexts/AuthContext.tsx`

```
AuthState = { user: User|null, isDemo: boolean, isLoading: boolean }

useEffect (runs once on mount):
  if (TG initData exists):
    → fetch /api/tg-auth
    → on success: setState(prev => prev.isDemo ? prev : { user, isDemo:false, isLoading:false })
    → НЕ перезаписывает isDemo если пользователь уже вошёл в демо
  else if (localStorage 'nw_demo' === 'true'):
    → setState({ isDemo: true, ... })
  else:
    → supabase.auth.getSession() → setState(prev => prev.isDemo ? prev : ...)

enterDemo():
  → localStorage.setItem('nw_demo', 'true')
  → setState({ user: null, isDemo: true, isLoading: false })

signOut():
  → localStorage.removeItem('nw_demo')
  → supabase.auth.signOut()
  → setState({ user: null, isDemo: false, isLoading: false })
```

### `frontend/pages/wallet.tsx`

```tsx
// PIN gate effect
useEffect(() => {
  if (isDemo) { setPinRequired(false); return; }
  if (hasWallet && hasPinSetup() && walletPassword === null) setPinRequired(true);
}, [isDemo, walletPassword]);

// PIN gate render — уже защищён !isDemo
if (!isDemo && pinRequired && walletPassword === null) {
  return <PinEntry onSuccess={(pwd) => { setWalletPassword(pwd); setPinRequired(false); }} />;
}
```

---

## Что нужно сделать

### Fix 1 — добавить Demo кнопку в PinEntry (ПРИОРИТЕТ)

Файл: `frontend/components/PinEntry.tsx`

PinEntry получает пропсы:
```tsx
interface PinEntryProps {
  onSuccess: (walletPassword: string) => void;
  // возможно другие пропсы — посмотри в файле
}
```

Нужно:
1. Добавить в пропсы `onDemo?: () => void`
2. Внизу экрана PinEntry добавить кнопку:
   ```
   ─────── или ───────
   ✦ Войти в демо-режим
   ```
   Стиль: прозрачный фон, border `rgba(0,255,127,0.2)`, цвет текста `#3A6045`, размер поменьше чем основные кнопки.

3. В `wallet.tsx`, где рендерится `<PinEntry>`, передать:
   ```tsx
   <PinEntry
     onSuccess={(pwd) => { setWalletPassword(pwd); setPinRequired(false); }}
     onDemo={() => { enterDemo(); }}
   />
   ```
   Где `enterDemo` берётся из `useAuth()`.

4. При нажатии `onDemo` в PinEntry: вызвать `props.onDemo()`.
   В wallet.tsx `enterDemo()` установит `isDemo=true` → PIN gate немедленно исчезнет (useEffect это обрабатывает) → покажется demo wallet.

### Fix 2 — изолировать demo данные

Когда `isDemo === true`, компоненты НЕ должны читать из localStorage:
- `wallet_eth_address`, `wallet_sol_address`, `wallet_btc_address` и т.д.
- `wallet_keystore`, `wallet_pin_blob`

Где встречается `localStorage.getItem('wallet_eth_address')` (и другие адреса) — оберни в `if (!isDemo)`.

Компоненты, требующие проверки:
- `frontend/components/BalanceCard.tsx` — уже имеет `isDemo` логику, проверь
- `frontend/components/WalletScreen.tsx` — показывает реальные адреса/балансы
- `frontend/components/TxHistory.tsx` — показывает реальные транзакции
- `frontend/components/ReceiveScreen.tsx` — показывает реальный адрес
- `frontend/components/CryptoSendScreen.tsx` — читает реальный баланс

Для demo режима показывай заглушки/фейк-данные. Фейк-данные уже есть в:
- `frontend/components/BalanceCard.tsx` — `DEMO_TOTAL`, `DEMO_CRYPTO_ROWS` и т.д.
- `frontend/components/CardsScreen.tsx` — `DEMO_CARD`
- `frontend/components/SendScreen.tsx` — `DEMO_CONTACTS`

Для WalletScreen в demo: вместо реальных адресов показывай `0x1234...abcd` (фейк ETH), не вызывай fetchRealBalances.

---

## Что НЕ трогать

- `frontend/pages/api/tg-auth.ts` — работает корректно
- `frontend/lib/crypto/` — не менять
- `frontend/lib/pin.ts` — не менять  
- `frontend/components/PinSetup.tsx` — не менять
- Логику Supabase auth в AuthContext — там уже всё правильно
- Файл `next.config.js` — не менять

## Проверка

После изменений убедись:

1. `npm --prefix frontend run build` — проходит без ошибок TypeScript
2. Сценарий A — **Demo из PIN экрана**:
   - Открыть `/wallet` → появляется PIN экран
   - Нажать "Войти в демо" → исчезает PIN, показывается wallet с демо-балансом €7,809.50, без реальных данных
3. Сценарий B — **Реальный вход**:
   - Ввести правильный PIN → открывается реальный wallet с реальными балансами
4. Сценарий C — **Demo не пересекается с реальным**:
   - В demo НЕТ реальных ETH-адресов пользователя
   - В demo НЕТ реальных транзакций пользователя
