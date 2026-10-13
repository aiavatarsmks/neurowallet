# NeuroWallet — Спецификация API

> Актуально на 2026-07-02 (после задачи 0.3 Фазы 0). Все endpoints — Next.js
> API routes (`frontend/pages/api/`), задеплоены как serverless-функции Vercel.

## Сводная таблица

| Endpoint | Метод | Auth | Rate limit | Audit-события |
|---|---|---|---|---|
| `/api/tg-auth` | POST | HMAC initData (login) | 10/мин/IP | `tg_auth_login` |
| `/api/neura-chat` | POST | Supabase JWT | 20/мин/user, 200/сутки/user, глобально `NEURA_CHAT_DAILY_MAX` | `ai_chat_requested`, `ai_chat_completed`, `ai_chat_failed` |
| `/api/tx-history` | GET | Supabase JWT | 30/мин/user | `tx_history_requested` |
| `/api/balances` | GET | Supabase JWT | 40/мин/user | — (read-only, опрос каждые 30 с) |
| `/api/tg-notify` | POST | Supabase JWT | 10/мин/user | `telegram_notification_requested/sent/failed` |
| `/api/neuro-id/resolve` | GET | Supabase JWT | 30/мин/user | `neuro_id_resolved` |
| `/api/tg-webhook` | POST | секрет-токен Telegram (fail-closed) | 20/мин/chat | — (нет user_id) |
| `/api/csp-report` | POST | — (шлёт браузер) | 10/мин/IP | — (дедуп-лог) |
| `/api/track` | POST | JWT опционален (anon = pre-auth) | 60/мин/user, 30/мин/IP | — (пишет в analytics_events) |
| `/api/tx-draft` | POST, PATCH | Supabase JWT | 30/мин/user | `tx_draft_created`, `tx_draft_updated` (без адресов/сумм) |
| `/api/recipient-history` | GET | Supabase JWT | 30/мин/user | — (read-only) |
| `/api/risk-event` | POST, PATCH | Supabase JWT | 30/мин/user | `risk_flagged`, `risk_override_confirmed` |
| `/api/contacts` | GET, POST, PATCH, DELETE | Supabase JWT | 30/мин/user | `contact_saved/updated/deleted` (только id+монета) |
| `/api/payment-request` | GET (аноним), POST, PATCH | GET: rate limit по IP; POST/PATCH: JWT | 30/мин/IP; 20/мин/user | `payment_request_created/updated` |
| `/api/health` | GET | нет (для uptime-мониторов) | 30/мин/IP | нет |

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

После проверки HMAC сервер записывает проверенный id в
`app_metadata.telegram_id` (+ `app_metadata.source = 'telegram_mini_app'`)
через admin API (`SUPABASE_SERVICE_ROLE_KEY`). Пишет только при изменении
значения; без service key или при ошибке GoTrue логин всё равно проходит
(лог-предупреждение). `app_metadata` пользователь изменить не может, в отличие
от `user_metadata` (`supabase.auth.updateUser({ data })`), поэтому сервер
определяет Telegram-получателя **только** по `app_metadata.telegram_id`
(`lib/server/telegram-id.ts → getVerifiedTelegramId`; используют
`/api/tg-notify`, `/api/notifications/emit`, `/api/notifications/recap`).
`user_metadata.telegram_id` остаётся чисто информационным.

## POST /api/neura-chat

Прокси к OpenRouter (`openai/gpt-4o-mini`), персона «Нейра». Body:
`{ messages: [{role,content}], walletContext?: {балансы/публичные адреса}, lang?: 'ru'|'en' }`.
`max_tokens: 500`.

Фильтрация входа (`lib/server/neura-chat-input.ts`):
- `messages`: только `role` = `user` | `assistant` и строковый `content`
  (клиентский `system` выкидывается), последние 12, каждое **обрезается** до
  2000 символов (не 400: клиент шлёт весь чат целиком).
- `walletContext`: allowlist. Балансы `eth, btc, sol, trx, ton, usdt, usdtTrc,
  usdtTon` и цены `ethEur, btcEur, solEur, trxEur, tonEur` принимаются только
  как конечные числа (clamp 0..1e12 и 0..1e7), адреса `ethAddr, btcAddr,
  solAddr, tronAddr, tonAddr` только по regex своего чейна (как в tx-history).
  Всё остальное отбрасывается.
- Тело запроса ≤ 256 КБ (Next.js bodyParser, больше → `413`).

Лимиты: 20/мин на пользователя; 200/сутки на пользователя
(`checkDailyBudget('neura-chat-user:<id>')`); глобально
`NEURA_CHAT_DAILY_MAX`/сутки (по умолчанию 5000). Дневные счётчики тратятся
только валидными запросами.

Ответы: `200 { reply }` либо `200 { error }` (дружелюбная ошибка апстрима);
`400` нет валидных messages; `401`; `429 { error }` (минутный лимит, дневной
лимит пользователя или глобальный бюджет; `error`: готовый RU/EN текст для
показа); `500` нет ключа.
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

## GET /api/balances

Балансы TON / USDT-TON и TRX / USDT-TRC20 через серверные ключи провайдеров
(`TONCENTER_API_KEY`, `TRONGRID_API_KEY` — только server-side env). Query: `ton`,
`tron` (опциональны, строгий regex, иначе `400`). Ответ:
`{ ton, usdtTon, trx, usdtTrc }` — числа или `null`. `null`, если ключ сети не
задан или провайдер ответил ошибкой: клиент тогда делает прежний прямой запрос
без ключа. Ключи в ответ не попадают (покрыто тестами).

## POST /api/tg-notify

Telegram-уведомление **самому себе** об отправленной транзакции, только по
шаблону. Свободный текст не принимается: прежний контракт `{ message }`
позволял слать произвольный HTML от официального бота (фишинг) и теперь
получает `400`.

Body:

```json
{ "kind": "tx_sent", "coin": "ETH", "amount": "0.015",
  "to": "0x1234…5678", "hash": "0xabc…", "lang": "ru" }
```

| Поле | Правило |
|---|---|
| `kind` | строго `'tx_sent'` |
| `coin` | `ETH`, `USDT`, `BTC`, `SOL`, `TRX`, `TRC20`, `TON`, `USDT_TON` |
| `amount` | **строка**, `/^\d{1,18}(\.\d{1,18})?$/` (без экспоненты, без знака) |
| `to`, `hash` | строки 1..128 символов из `[A-Za-z0-9:_\-.]` |
| `lang` | `'en'` → английский шаблон, всё остальное → русский |

Текст собирает сервер (`lib/server/tg-notify-template.ts`), каждое значение
HTML-экранируется. Подписи монет: USDT → `USDT (ERC-20)`, TRC20 →
`USDT (TRC-20)`, USDT_TON → `USDT (TON)`, остальные как есть. Адрес
сокращается до `первые 6...последние 4`, хеш до первых 16 символов.

Получатель: только `app_metadata.telegram_id` сессии (см. tg-auth). Поля
`telegramId` в body и `user_metadata.telegram_id` игнорируются.

Ответы: `200 { ok: true }`; `400 { error: 'invalid kind' | 'invalid coin' |
'invalid amount' | 'invalid to' | 'invalid hash' }`; `401`; `403` нет
проверенного Telegram id; `429`; `500` нет токена бота или ошибка Telegram.
Audit: `telegram_notification_requested { telegram_id, kind, coin,
message_chars }`, `..._sent`, `..._failed`; полный адрес и хеш в audit не пишутся.

## GET /api/neuro-id/resolve

Резолв NeuroID → адрес. Query: `neuro_id` (`nw-[a-z0-9]{8,32}`), `coin`
(BTC/ETH/SOL/USDT/TRX/TRC20/TON/USDT_TON). Ищет в `neuro_directory` один
точный `neuro_id` через **service role** (справочник приватный с миграции
0012) и выбирает только колонку адреса запрошенной монеты. `user_id` и
адреса других сетей в ответ не попадают. Строка, у которой `neuro_id` не
выведен из `user_id` (`neuroIdFromUserId`), считается поддельной → `404`
(работает и до применения 0012).

Ответы: `200 { neuro_id, display_name, coin, address, internal, settlement }`;
`400` битый формат; `404` не найден, поддельная строка или нет адреса этой
монеты; `503` на сервере нет `SUPABASE_SERVICE_ROLE_KEY`.

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

## GET /api/health

Проба готовности для uptime-мониторов. Без auth, 30/мин/IP,
`Cache-Control: no-store`. Значения env никогда не возвращаются, только флаги.

```json
{ "ok": true, "time": "2026-10-13T08:00:00.000Z",
  "checks": { "supabase": "ok", "rateLimitStore": "durable", "auditLog": "on" } }
```

- `supabase`: `ok` | `fail`. Пинг PostgREST с anon-ключом
  (`GET /rest/v1/profiles?select=id&limit=1`, RLS отдаёт `[]`), таймаут 2 с.
- `rateLimitStore`: `durable` если заданы `UPSTASH_REDIS_REST_URL` и
  `UPSTASH_REDIS_REST_TOKEN`, иначе `memory`.
- `auditLog`: `on` если задан `SUPABASE_SERVICE_ROLE_KEY`, иначе `off`.

Ответы: `200` при `ok: true`; `503` с тем же телом при `ok: false`
(Supabase недоступен); `405` не-GET; `429`.
