import { supabase } from './supabase';

/**
 * lib/policies-client.ts — client helpers for the Policy Engine CRUD
 * (/api/policies). Best-effort, never throw. All calls carry the user's JWT;
 * the server enforces RLS + flag gating.
 */

export interface PolicyRow {
  id: string;
  enabled: boolean;
  type: string;
  rule: Record<string, unknown>;
  created_at: string;
}

async function authFetch(init: RequestInit): Promise<Response | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    return await fetch('/api/policies', {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  } catch {
    return null;
  }
}

export async function fetchPolicies(): Promise<PolicyRow[]> {
  const r = await authFetch({ method: 'GET' });
  if (!r || !r.ok) return [];
  const body = (await r.json()) as { policies?: PolicyRow[] };
  return body.policies ?? [];
}

export async function createPolicy(type: string, rule: Record<string, unknown>): Promise<string | null> {
  const r = await authFetch({ method: 'POST', body: JSON.stringify({ type, rule }) });
  if (!r || !r.ok) return null;
  return ((await r.json()) as { id?: string }).id ?? null;
}

export async function togglePolicy(id: string, enabled: boolean): Promise<boolean> {
  const r = await authFetch({ method: 'PATCH', body: JSON.stringify({ id, enabled }) });
  return !!r && r.ok;
}

export async function deletePolicy(id: string): Promise<boolean> {
  const r = await authFetch({ method: 'DELETE', body: JSON.stringify({ id }) });
  return !!r && r.ok;
}
