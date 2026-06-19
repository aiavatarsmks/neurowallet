import React from 'react';

interface TransferButtonProps {
  onSend?: () => void;
  onReceive?: () => void;
}

export const TransferButton: React.FC<TransferButtonProps> = ({ onSend, onReceive }) => {
  return (
    <div className="flex gap-3 px-6 pb-4">
      <button
        type="button"
        onClick={onSend}
        className="flex-1 py-3.5 rounded-2xl font-semibold text-sm text-white transition-all active:scale-95 flex items-center justify-center gap-2"
        style={{
          background: 'transparent',
          border: '1.5px solid #00FF7F',
          boxShadow: '0 0 16px rgba(0,255,127,0.18)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        Отправить
      </button>

      <button
        type="button"
        onClick={onReceive}
        className="flex-1 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
        style={{
          background: 'rgba(0,255,127,0.08)',
          border: '1.5px solid rgba(0,255,127,0.2)',
          color: '#ffffff',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="8 17 12 21 16 17"/>
          <line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
        </svg>
        Получить
      </button>
    </div>
  );
};

export default TransferButton;
