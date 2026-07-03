/**
 * Приёмка 1.8: conversion event срабатывает после выполнения задач;
 * задачи идемпотентны; воронка завершается ровно один раз.
 * (Граница demo/real enforce'ится гейтами isDemo в send/receive —
 * демо-ветка CryptoSendScreen возвращает фейковый hash до любых chain-вызовов.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { track } from '@/lib/analytics';
import { completeDemoTask, getCompletedTasks, isAllDone, resetDemoTasks, DEMO_TASKS } from '@/lib/demo-guide';

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
}));

const mockedTrack = vi.mocked(track);

describe('demo guide funnel (task 1.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDemoTasks();
  });

  it('tracks each task once (idempotent)', () => {
    completeDemoTask('view_portfolio');
    completeDemoTask('view_portfolio');
    completeDemoTask('view_portfolio');
    const calls = mockedTrack.mock.calls.filter((c) => c[0] === 'demo_task_completed');
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toEqual({ task: 'view_portfolio' });
    expect(getCompletedTasks().size).toBe(1);
    expect(isAllDone()).toBe(false);
  });

  it('fires demo_funnel_completed exactly once after all three tasks', () => {
    for (const task of DEMO_TASKS) completeDemoTask(task);
    expect(isAllDone()).toBe(true);
    expect(mockedTrack.mock.calls.filter((c) => c[0] === 'demo_funnel_completed').length).toBe(1);

    // Повторные вызовы после завершения ничего не дублируют.
    completeDemoTask('demo_send');
    expect(mockedTrack.mock.calls.filter((c) => c[0] === 'demo_funnel_completed').length).toBe(1);
  });

  it('persists progress in localStorage and survives reload', () => {
    completeDemoTask('open_receive');
    expect(getCompletedTasks().has('open_receive')).toBe(true); // читается заново из storage
    resetDemoTasks();
    expect(getCompletedTasks().size).toBe(0);
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('nw_demo_tasks_v1', '{broken json');
    expect(getCompletedTasks().size).toBe(0);
    localStorage.setItem('nw_demo_tasks_v1', JSON.stringify(['fake_task', 'demo_send']));
    expect([...getCompletedTasks()]).toEqual(['demo_send']);
  });
});
