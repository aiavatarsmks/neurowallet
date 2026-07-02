# NeuroWallet — Спецификация API

> Актуально на 2026-07-02 (после задачи 0.3 Фазы 0). Все endpoints — Next.js
> API routes (`frontend/pages/api/`), задеплоены как serverless-функции Vercel.

## Сводная таблица

| Endpoint | Метод | Auth | Rate limit | Audit-события |
|---|---|---|---|---|
| `/api/tg-auth` | POST | HMAC initData (login) | 10/мин/IP | `tg_auth_login` |
| `/api/neura-chat` | POST | Supabase JWT | 20/мин/user | `ai_chat_requested`, `ai_chat_completed`, `ai_chat_failed` |
| `/api/tx-history` | GET | Supabase JWT | 30/мин/user | `tx_history_requested` |
| `/api/tg-notify` | POST | Supabase JWT | 10/мин/user | `telegram_notification_requested/sent/failed` |
| `/api/neuro-id/resolve` | GET | Supabase JWT | 30/мин/user | `neuro_id_resolved` |
| `/api/tg-webhook` | POST | секрет-токен Telegram (fail-closed) | 20/мин/chat | — (нет user_id) |
| `/api/csp-report` | POST | — (шлёт браузер) | 10/мин/IP | — (дедуп-лог) |

Общие правила:
- **Auth**: заголовок `Authorization: Bearer <supabase_access_token>`; невалидный/отсутствующий → `401`.
- **Rate limit** → `429`. Ограничитель in-memory per-instance (см. `lib/server/api-security.ts`) — переезд на durable store запланирован в Фазе 1.1.
- Приватные ключи, seed, пароли **не принимаются и не возвращаются** ни одним endpoint'ом.

---

## POST /api/tg-auth

Логин Telegram Mini App. Body: `{ "initData": string }` (сырая строка
`window.Telegram.WebApp.initData`).

Проверки: HMAC-SHA256 подпись (ключ — производная от `TELEGRAM_BOT_TOKEN`),
freshness `auth_date` ≤ 15 минут, наличие `user.id`.

Ответы: `200 { access_token, refresh_token, user: { id, email, name, telegram_id } }`;
`400` нет/битый initData; `401` невалидная подпись или устаревший auth_date;
`429`; `500` неконфигурирован сервер.

## POST /api/neura-chat

Прокси к OpenRouter (`openai/gpt-4o-mini`), персона «Нейра». Body:
`{ messages: [{role,content}], walletContext?: {балансы/публичные адреса}, lang?: 'ru'|'en' }`.
История обрезается до последних 12 сообщений, `max_tokens: 500`.

Ответы: `200 { reply }` либо `200 { error }` (дружелюбная ошибка апстрима);
`400` пустые messages; `401`; `429`; `500` нет ключа.
`OPENROUTER_API_KEY` — server-only, в браузер не попадает.

## GET /api/tx-history

История транзакций по публичным адресам. Query: `eth`, `sol`, `btc`, `tron`,
`ton` (все опциональны). Каждый адрес валидируется строгим regex своего чейна —
иначе `400` (защита от инъекции параметров в upstream-URL).

Источники: Etherscan (ETH + USDT ERC-20), TronGrid (TRX + USDT TRC-20),
Solana RPC, Blockstream, Toncenter. Ответ: `200 { transactions: TxRow[] }`,
где `TxRow = { id, chain, type: 'in'|'out', amount, address, hash, date, fee }` —
ровно 8 полей, сырые поля апстрима и API-ключи не проксируются (покрыто тестом).
Ошибки апстрима глотаются: соответствующий чейн просто отсутствует в выдаче.

## POST /api/tg-notify

Отправка Telegram-уведомления **самому себе**. Body: `{ message: string }`.
Получатель — всегда `telegram_id` из `user_metadata` сессии; legacy-поле
`telegramId` в body игнорируется. Нет привязанного Telegram → `403`.

## GET /api/neuro-id/resolve

Резолв NeuroID → адрес. Query: `neuro_id` (`nw-[a-z0-9]{8,32}`), `coin`
(BTC/ETH/SOL/USDT/TRX/TRC20/TON/USDT_TON). Читает `neuro_directory`
под JWT пользователя (RLS: чтение справочника доступно всем authenticated).

Ответы: `200 { neuro_id, display_name, coin, address, internal, settlement }`;
`400` битый формат; `404` не найден или нет адреса этой монеты.

## POST /api/tg-webhook

Webhook Telegram-бота (`/start`, `/help`, callback «Как это работает»).
**Fail-closed**: без `TELEGRAM_WEBHOOK_SECRET` в env — `500`; несовпадение
заголовка `X-Telegram-Bot-Api-Secret-Token` — `401`. Отправка ответа в
Telegram выполняется ДО ответа на webhook (ограничение Vercel serverless).

## POST /api/csp-report

Приёмник CSP-нарушений (`report-uri`). Без auth (шлёт браузер).
Защита: 10/мин/IP, body ≤ 10 КБ, лог с дедупликацией — пара
(директива, blocked-uri) логируется не чаще раза в час. Всегда `204`
(даже на мусор), `405` на не-POST. Смотреть: Vercel → Functions → `[csp-report]`.
