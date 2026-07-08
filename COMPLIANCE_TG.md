# Telegram Blockchain Guidelines — compliance (задача 2.10)

> **Статус: рамка соответствия ПРИНЯТА (2026-07-08, Максим).** Основание —
> `core.telegram.org/bots/blockchain-guidelines`: multichain TON-кошелёк с
> send/receive других сетей и cross-chain swap ВНУТРИ интерфейса разрешён
> дословно. Чёткого black-letter нарушения нет; закрываем интерпретационный
> риск «TON-based» через позиционирование и продуктовые акценты.
> Telegram — единственный канал дистрибуции, риск бана недопустим.

## Идентичность (позиционирование)

**«TON-кошелёк с AI-защитой, внутри — управление BTC/ETH/SOL/TRX/USDT».**
TON — основа; остальные сети управляются внутри одного интерфейса (не через
внешние приложения). Нейра = слой безопасности, не «умный ассистент».

## Финальная рамка (решение)

1. **Публичные тексты** → identity выше: описание бота и Mini App (BotFather —
   готовые тексты ниже), онбординг, privacy/лендинг. TON-native формулировки.
2. **Продукт:** дефолтная сеть Receive = **TON**; акцент онбординга = TON; на
   главной TON-активы **не ниже** остальных. **Send-пикер НЕ трогаем** —
   USDT TRC-20 остаётся первым (utility, самый используемый).
3. **TON Connect — НЕ внедряем сейчас.** Режим «no external connections»
   explicitly permitted для pure-wallet. Перенесён в план как **пред-условие
   будущих экосистемных интеграций** (когда появится TON-dApp-интероп).
4. **Гигиена (подтверждено аудитом кода):**
   - Ссылок на внешние приложения для управления не-TON активами — **НЕТ**.
   - Каталогов dApp — **НЕТ**.
   - Единственные внешние ссылки — **block explorers** (blockstream/etherscan/
     solscan/tronscan/tonscan) — информационные (статус tx/адреса), **оставляем**
     (`CryptoSendScreen`, `ProfileScreen`, `TxHistory`).
   - **2.9 referral:** награды только за **funded-действия внутри кошелька**,
     НЕ за подключение внешних кошельков (прямой запрет гайдлайнов). Зафиксировано
     в задаче 2.9.

## Что НЕ нарушаем (подтверждено)

| Правило | Статус |
|---|---|
| Эмиссия токенов/NFT — только на TON | Токены не выпускаем ✅ |
| Не-TON wallet-connect вне бриджинга | Мы pure-wallet, к внешним не коннектимся ✅ (exempt) |
| Каталоги не-TON приложений | Нет ✅ |
| Награда за подключение ETH/BTC-кошельков | Не награждаем; 2.9 — только funded ✅ |
| Мультичейн внутри интерфейса | Разрешён дословно ✅ |

## 🤖 Готовые тексты для BotFather

### About (`/setabouttext`, ≤120 симв.)
**RU:** `TON-кошелёк с AI-защитой. Внутри — BTC, ETH, SOL, TRX, USDT. Нейра не даёт ошибиться при отправке.`
**EN:** `TON wallet with AI safety. Inside: BTC, ETH, SOL, TRX, USDT. Neura helps you avoid mistakes.`

### Description (`/setdescription`, ≤512 симв.)
**RU:**
```
NeuroWallet — TON-кошелёк с AI-защитой. Основа — TON; в одном интерфейсе управляешь BTC, ETH, SOL, TRX и USDT (ERC-20 / TRC-20 / TON). Нейра — слой безопасности: симуляция комиссии, проверка адреса (anti-poisoning) и объяснение транзакций простыми словами. Кошелёк, который не даёт ошибиться. Отправляй и получай, создавай платёжные ссылки. Ключи только у тебя — non-custodial.
```
**EN:**
```
NeuroWallet — a TON wallet with AI safety. TON at the core; manage BTC, ETH, SOL, TRX and USDT (ERC-20 / TRC-20 / TON) in one interface. Neura is a safety layer: fee simulation, address anti-poisoning checks and plain-language transaction explanations. A wallet that helps you not make mistakes. Send and receive, create payment links. Your keys only — non-custodial.
```

### Mini App short name / title
`NeuroWallet — TON wallet with AI safety`

> Отправляет Максим сам через @BotFather (`/mybots → NeuroWallet_bot → Edit`).

## Оставшиеся действия (код — в этой сессии)

- [x] Гигиена-аудит внешних ссылок (только block explorers).
- [ ] Receive: дефолтная сеть → TON.
- [ ] Главная: TON-активы не ниже остальных (порядок ассетов).
- [ ] Онбординг / privacy / лендинг: TON-native копирайт.
- [ ] BotFather: применить тексты (Максим).
- [ ] TON Connect — **отложено** (пред-условие экосистемных интеграций, не сейчас).
- [ ] (Опц.) Перечитать первоисточник целиком перед масштабированием; при
      необходимости — запрос в Telegram support на трактовку «TON-based».
