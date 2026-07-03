/**
 * components/DemoGuide.tsx — карточка guided demo (задача 1.8).
 * Видна только в демо-режиме на главной: 3 задачи от Нейры → CTA создать
 * настоящий кошелёк. Conversion-события — в аналитику.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { track } from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { DEMO_TASKS, DEMO_GUIDE_EVENT, getCompletedTasks, type DemoTask } from '@/lib/demo-guide';

const TASK_I18N: Record<DemoTask, string> = {
  view_portfolio: 'demoTaskPortfolio',
  open_receive: 'demoTaskReceive',
  demo_send: 'demoTaskSend',
};

export const DemoGuide: React.FC = () => {
  const router = useRouter();
  const { isDemo } = useAuth();
  const { t } = useLanguage();
  const [done, setDone] = useState<Set<DemoTask>>(new Set());

  useEffect(() => {
    if (!isDemo) return;
    const sync = () => setDone(new Set(getCompletedTasks()));
    sync();
    window.addEventListener(DEMO_GUIDE_EVENT, sync);
    return () => window.removeEventListener(DEMO_GUIDE_EVENT, sync);
  }, [isDemo]);

  if (!isDemo) return null;
  const allDone = DEMO_TASKS.every((task) => done.has(task));

  const convert = () => {
    track('demo_convert_clicked');
    router.push('/auth');
  };

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2.5"
      style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.18)' }}
    >
      <p className="text-[#00FF7F] text-xs font-semibold">{t('demoGuideTitle')}</p>
      {DEMO_TASKS.map((task) => (
        <div key={task} className="flex items-center gap-2 text-xs">
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
            style={done.has(task)
              ? { background: '#00FF7F', color: '#080C09' }
              : { border: '1.5px solid rgba(0,255,127,0.3)', color: 'transparent' }}
          >
            ✓
          </span>
          <span style={{ color: done.has(task) ? '#7FBF9A' : '#fff', textDecoration: done.has(task) ? 'line-through' : 'none' }}>
            {t(TASK_I18N[task] as Parameters<typeof t>[0])}
          </span>
        </div>
      ))}
      {allDone && (
        <button
          onClick={convert}
          className="mt-1 py-3 rounded-xl text-xs font-bold transition-all active:scale-95"
          style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 16px rgba(0,255,127,0.3)' }}
        >
          {t('demoGuideCta')}
        </button>
      )}
    </div>
  );
};

export default DemoGuide;
