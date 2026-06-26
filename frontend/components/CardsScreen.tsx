import React from 'react';

export const CardsScreen: React.FC = () => (
  <div className="px-6 pt-2 pb-6 flex flex-col gap-5">
    <h2 className="text-white text-lg font-bold">Мои карты</h2>
    <div
      className="flex flex-col items-center justify-center rounded-3xl py-16 gap-4"
      style={{
        background: 'linear-gradient(135deg, rgba(0,255,127,0.06) 0%, rgba(0,255,127,0.02) 100%)',
        border: '1px solid rgba(0,255,127,0.14)',
      }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(0,255,127,0.08)', border: '1px solid rgba(0,255,127,0.2)' }}
      >
        <span className="text-3xl">💳</span>
      </div>
      <div className="text-center px-6">
        <p className="text-white text-base font-semibold mb-1">Виртуальная карта — скоро</p>
        <p className="text-[#3A6045] text-sm leading-relaxed">
          Мы работаем над выпуском виртуальных карт. Они появятся здесь после запуска.
        </p>
      </div>
    </div>
  </div>
);

export default CardsScreen;
