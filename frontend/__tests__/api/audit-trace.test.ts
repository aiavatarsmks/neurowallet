import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeAuditLog, getTraceId } from '@/lib/server/api-security';
import { mockReq } from './helpers';

const inserts = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const TRACE_ID = '7f000001-aaaa-4bbb-8ccc-000000000001';

describe('trace id propagation (task 1.1)', () => {
  beforeEach(() => {
    inserts.length = 0;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
  });

  it('getTraceId accepts a valid uuid header and rejects garbage', () => {
    expect(getTraceId(mockReq({ headers: { 'x-trace-id': TRACE_ID } }))).toBe(TRACE_ID);
    expect(getTraceId(mockReq({ headers: { 'x-trace-id': 'DROP TABLE users' } }))).toBeNull();
    expect(getTraceId(mockReq())).toBeNull();
  });

  it('writeAuditLog merges the trace id into metadata', async () => {
    await writeAuditLog('user-1', 'test_action', { foo: 'bar' }, mockReq({ headers: { 'x-trace-id': TRACE_ID } }));
    expect(inserts.length).toBe(1);
    expect(inserts[0].metadata).toEqual({ foo: 'bar', trace_id: TRACE_ID });
  });

  it('writeAuditLog leaves metadata untouched without a trace header', async () => {
    await writeAuditLog('user-1', 'test_action', { foo: 'bar' }, mockReq());
    expect(inserts[0].metadata).toEqual({ foo: 'bar' });
  });
});
