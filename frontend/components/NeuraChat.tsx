import React, { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  from: 'neura' | 'user';
  text: string;
  timestamp: string;
}

const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const QUICK_PROMPTS = [
  'Мои расходы',
  'Мой крипто-портфель',
  'Есть аномалии?',
  'Когда продавать BTC?',
  'Оптимизировать бюджет',
  'Конвертировать в евро',
];

const RESPONSES: Record<string, string> = {
  'мои расходы':
    'За этот месяц ты потратил €847. Рестораны выросли на 23% — €196 vs обычных €160. Самая крупная трата: ужин в Nobu €89. Подписки стабильны: €25.98/мес. Хочешь поставить лимит?',

  'мой крипто-портфель':
    'Твой крипто-портфель: BTC 0.042 → €2 310 (+4.2% сегодня), ETH 1.24 → €2 542 (+1.8%), USDT 110 → €110 (стабильно). Итого: €4 962. За месяц +11.7%. BTC занимает 46% — диверсификация нормальная.',

  'есть аномалии?':
    'Нашла 2 аномалии: ① Подписка Adobe €54 — ты не открывал её 3 месяца. ② Двойное списание Netflix €15.99 в пятницу. Хочешь, я подготовлю черновик оспаривания по Netflix?',

  'когда продавать btc':
    'Анализирую... RSI = 58 (не перекуплен). BTC выше 200-дневной MA. Ближайший резистанс: €59 400. Мой сигнал: удерживай позицию. Если хочешь зафиксировать прибыль — рассмотри продажу 30% при €60K.',

  'оптимизировать бюджет':
    'Три шага: ① Отмени Adobe €54/мес — ты им не пользуешься. ② Spotify: переключись на годовой план, экономия €24/год. ③ Авто-резерв 10% от любого входящего. Итого экономия: €78+. Применить правила?',

  'конвертировать в евро':
    'Текущий курс: 0.042 BTC = €2 310.90, 1.24 ETH = €2 542.36. Если конвертировать всё крипто в EUR — получишь €4 962 (минус комиссия биржи ~0.1%). Хочешь рассчитать сумму после налогов?',

  'налоговый резерв':
    'По твоим данным: €3 600/мес в среднем. Рекомендую откладывать €720/мес (20%). Сейчас в резерве: €0. Хочешь, я настрою авто-перевод каждый месяц?',

  'btc': 'У тебя 0.042 BTC ≈ €2 310. За последние 24ч BTC вырос на +4.2%. Хочешь посмотреть аналитику или конвертировать?',
  'биткоин': 'У тебя 0.042 BTC ≈ €2 310. За последние 24ч BTC вырос на +4.2%. Хочешь посмотреть аналитику или конвертировать?',
  'eth':  'У тебя 1.24 ETH ≈ €2 542 (+1.8% за 24ч). Доступен стейкинг до 5.2% APY — хочешь включить?',
  'ethereum': 'У тебя 1.24 ETH ≈ €2 542 (+1.8% за 24ч). Доступен стейкинг до 5.2% APY — хочешь включить?',
  'usdt': 'У тебя 110 USDT ≈ €110 (стабильно). USDT — хорошая парковка для ликвидности.',
  'крипто': 'Твой крипто-портфель: €4 962 (+11.7% за месяц). BTC, ETH, USDT. Хочешь детали или оптимизацию?',
  'стейкинг': 'ETH стейкинг доступен со ставкой 5.2% APY. С твоими 1.24 ETH это ≈ €132/год. Минимальная блокировка — 30 дней. Запустить?',

  default:
    'Я анализирую твои финансы в реальном времени. Спроси о расходах, крипто-портфеле, аномалиях или бюджете — или скажи что нужно сделать.',
};

function getResponse(text: string): string {
  const lower = text.toLowerCase().trim();
  for (const [key, response] of Object.entries(RESPONSES)) {
    if (key !== 'default' && lower.includes(key)) return response;
  }
  return RESPONSES.default;
}

const OPENING: Message = {
  id: 'opening',
  from: 'neura',
  text: 'Привет! Я Нейра — твой финансовый AI-советник. Уже проанализировала транзакции и крипто-портфель. BTC вырос на 4.2% сегодня, и есть одна аномалия, о которой стоит поговорить. С чего начнём?',
  timestamp: now(),
};

interface NeuraChatProps {
  onAvatarState?: (state: 'idle' | 'talking' | 'thinking') => void;
  avatarHeight?: number;
}

export const NeuraChat: React.FC<NeuraChatProps> = ({ onAvatarState, avatarHeight = 160 }) => {
  const [messages, setMessages] = useState<Message[]>([OPENING]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = (text: string) => {
    if (!text.trim() || isTyping) return;
    const userMsg: Message = { id: Date.now().toString(), from: 'user', text: text.trim(), timestamp: now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setIsTyping(true);
    onAvatarState?.('thinking');

    const delay = 800 + Math.random() * 700;
    setTimeout(() => {
      const response = getResponse(text);
      const neuraMsg: Message = { id: (Date.now() + 1).toString(), from: 'neura', text: response, timestamp: now() };
      setMessages((m) => [...m, neuraMsg]);
      setIsTyping(false);
      onAvatarState?.('talking');
      setTimeout(() => onAvatarState?.('idle'), 2500);
    }, delay);
  };

  // header ~90px, avatar, bottom padding ~100px
  const containerH = `calc(100dvh - ${90 + avatarHeight + 100}px)`;

  return (
    <div className="flex flex-col" style={{ height: containerH, minHeight: '320px' }}>

      {/* Chat header */}
      <div className="px-6 pb-3 flex items-center gap-3 flex-shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(0,255,127,0.12)', border: '1px solid rgba(0,255,127,0.3)' }}
        >
          <span className="text-[#00FF7F] text-xs font-bold">N</span>
        </div>
        <div>
          <p className="text-white text-sm font-semibold">Нейра</p>
          <p className="text-[#3A6045] text-xs">AI финансовый советник</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full bg-[#00FF7F]"
            style={{ boxShadow: '0 0 6px #00FF7F', animation: 'onlinePulse 2s ease-in-out infinite' }}
          />
          <span className="text-[#00FF7F] text-xs">Online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[82%] rounded-2xl px-4 py-3"
              style={
                msg.from === 'neura'
                  ? { background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }
                  : { background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.2)' }
              }
            >
              {msg.from === 'neura' && (
                <p className="text-[#00FF7F] text-[10px] font-semibold mb-1.5 uppercase tracking-wider">Нейра</p>
              )}
              <p className="text-white text-sm leading-relaxed">{msg.text}</p>
              <p className="text-[#3A6045] text-[10px] mt-1.5 text-right">{msg.timestamp}</p>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div
              className="rounded-2xl px-4 py-3.5"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
            >
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-[#00FF7F]"
                    style={{ animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      <div className="px-6 pb-3 flex gap-2 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => sendMessage(p)}
            disabled={isTyping}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 disabled:opacity-40"
            style={{
              background: 'rgba(0,255,127,0.07)',
              border: '1px solid rgba(0,255,127,0.2)',
              color: '#00FF7F',
              whiteSpace: 'nowrap',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="px-6 pb-2 flex-shrink-0">
        <div
          className="flex gap-2 items-center rounded-2xl px-4 py-2.5"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)' }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            placeholder="Спроси Нейру..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-[#3A6045]"
            style={{ caretColor: '#00FF7F' }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:opacity-30"
            style={{ background: '#00FF7F' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#080C09" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes typingDot {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes onlinePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default NeuraChat;
