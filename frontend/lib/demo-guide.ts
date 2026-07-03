/**
 * lib/demo-guide.ts — guided demo воронка (задача 1.8).
 *
 * Три задачи демо-режима: посмотреть портфель, открыть экран получения,
 * пройти демо-отправку с review. Прогресс в localStorage; conversion-события
 * уходят в аналитику АНОНИМНО (session_id, /api/track поддерживает pre-auth).
 * Граница demo/real не здесь: она enforce'ится гейтами isDemo в send/receive
 * (демо не выполняет ни одного chain-действия и ни одного wallet-API вызова).
 */

import { track } from './analytics';

export type DemoTask = 'view_portfolio' | 'open_receive' | 'demo_send';

export const DEMO_TASKS: readonly DemoTask[] = ['view_portfolio', 'open_receive', 'demo_send'];

const KEY = 'nw_demo_tasks_v1';
export const DEMO_GUIDE_EVENT = 'nw-demo-guide-update';

export function getCompletedTasks(): Set<DemoTask> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((t): t is DemoTask => DEMO_TASKS.includes(t)) : []);
  } catch {
    return new Set();
  }
}

export function isAllDone(): boolean {
  const done = getCompletedTasks();
  return DEMO_TASKS.every((t) => done.has(t));
}

/** Идемпотентно отмечает задачу; трекает выполнение и завершение воронки. */
export function completeDemoTask(task: DemoTask): void {
  if (typeof window === 'undefined') return;
  const done = getCompletedTasks();
  if (done.has(task)) return;

  done.add(task);
  localStorage.setItem(KEY, JSON.stringify([...done]));
  track('demo_task_completed', { task });
  if (DEMO_TASKS.every((t) => done.has(t))) {
    track('demo_funnel_completed');
  }
  window.dispatchEvent(new Event(DEMO_GUIDE_EVENT));
}

export function resetDemoTasks(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(DEMO_GUIDE_EVENT));
}
