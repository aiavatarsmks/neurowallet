import { describe, it, expect } from 'vitest';
import {
  validateToolCall, registryIsReadPrepareOnly, TOOL_REGISTRY, type ToolSchema,
} from '@/lib/tool-firewall';

describe('tool-firewall — deny by default', () => {
  it('rejects an unknown tool', () => {
    const r = validateToolCall('sign_and_send', { to: 'x' });
    expect(r).toEqual({ ok: false, reason: 'unknown_tool', detail: 'sign_and_send' });
  });
  it('rejects a missing required param', () => {
    const r = validateToolCall('prepare_send', { asset: 'TON', amount: '1000' }); // no recipient
    expect(r).toMatchObject({ ok: false, reason: 'missing_param', detail: 'recipient' });
  });
  it('rejects a wrong-typed param', () => {
    const r = validateToolCall('prepare_send', { asset: 'TON', amount: 1000, recipient: 'a' }); // amount must be string
    expect(r).toMatchObject({ ok: false, reason: 'bad_type', detail: 'amount' });
  });
  it('rejects an undeclared (smuggled) param', () => {
    const r = validateToolCall('get_portfolio', { evil: true });
    expect(r).toMatchObject({ ok: false, reason: 'unexpected_param', detail: 'evil' });
  });
});

describe('tool-firewall — accepts valid calls', () => {
  it('accepts a well-formed prepare_send (returns the schema, does NOT execute)', () => {
    const r = validateToolCall('prepare_send', { asset: 'TON', amount: '1000', recipient: 'addr-B' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tool.sideEffect).toBe('prepare');
  });
  it('accepts a read tool with an optional param omitted', () => {
    expect(validateToolCall('get_balance', {}).ok).toBe(true);
    expect(validateToolCall('get_balance', { asset: 'TON' }).ok).toBe(true);
  });
});

describe('tool-firewall — safety invariant', () => {
  it('the registry never exposes an executing/signing tool', () => {
    expect(registryIsReadPrepareOnly()).toBe(true);
  });
  it('would flag a registry that smuggled in an execute tool', () => {
    const bad: ToolSchema[] = [
      ...TOOL_REGISTRY,
      { name: 'broadcast', sideEffect: 'execute' as never, params: [] },
    ];
    expect(registryIsReadPrepareOnly(bad)).toBe(false);
  });
});
