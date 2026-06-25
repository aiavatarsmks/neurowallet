import React, { useState, useRef, useEffect } from 'react';
import { fetchRealBalances, WalletBalances } from '@/lib/crypto/balances';

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

const FALLBACK_RESPONSE =
  'AI временно недоступен, попробуй чуть позже.';

async function getResponse(
  history: { from: 'neura' | 'user'; text: string }[],
  walletContext?: WalletBalances & { ethAddr?: string; btcAddr?: string; solAddr?: string; tronAddr?: string },
): Promise<string> {
  try {
    const res = await fetch('/api/neura-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history.map((m) => ({
          role: m.from === 'user' ? 'user' : 'assistant',
          content: m.text,
        })),
        walletContext,
      }),
    });
    const data = await res.json();
    if (data.error) return data.error;
    return data.reply ?? FALLBACK_RESPONSE;
  } catch {
    return FALLBACK_RESPONSE;
  }
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
  onFirstMessage?: () => void;
}

export const NeuraChat: React.FC<NeuraChatProps> = ({ onAvatarState, avatarHeight = 160, onFirstMessage }) => {
  const [messages, setMessages] = useState<Message[]>([OPENING]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasUserMessages, setHasUserMessages] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const walletCtxRef = useRef<(WalletBalances & { ethAddr?: string; btcAddr?: string; solAddr?: string; tronAddr?: string }) | undefined>(undefined);

  // Load wallet balances once for Neira context
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ethAddr  = localStorage.getItem('wallet_eth_address')  || '';
    const solAddr  = localStorage.getItem('wallet_sol_address')  || '';
    const btcAddr  = localStorage.getItem('wallet_btc_address')  || '';
    const tronAddr = localStorage.getItem('wallet_tron_address') || '';
    if (!ethAddr) return;
    fetchRealBalances(ethAddr, solAddr, btcAddr, tronAddr)
      .then((b) => {
        walletCtxRef.current = { ...b, ethAddr, solAddr, btcAddr, tronAddr };
      })
      .catch(() => {/* silent */});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = (text: string) => {
    if (!text.trim() || isTyping) return;
    if (!hasUserMessages) {
      setHasUserMessages(true);
      onFirstMessage?.();
    }
    const userMsg: Message = { id: Date.now().toString(), from: 'user', text: text.trim(), timestamp: now() };
    const historyForApi = [...messages, userMsg];
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setIsTyping(true);
    onAvatarState?.('thinking');

    getResponse(historyForApi, walletCtxRef.current).then((response) => {
      const neuraMsg: Message = { id: (Date.now() + 1).toString(), from: 'neura', text: response, timestamp: now() };
      setMessages((m) => [...m, neuraMsg]);
      setIsTyping(false);
      onAvatarState?.('talking');
      setTimeout(() => onAvatarState?.('idle'), 2500);
    });
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
