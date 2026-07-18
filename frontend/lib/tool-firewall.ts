/**
 * lib/tool-firewall.ts — pure "Tool Firewall" for Нейра (CLAUDE.md architecture
 * pillar; part of 3.2). No secrets, no network — safe on client and server,
 * fully testable.
 *
 * THE invariant this enforces: an LLM may only ever invoke an allowlisted,
 * DETERMINISTIC tool, and only tools whose side effect is `read` or `prepare` —
 * **never `execute`/sign**. Signing/moving funds is NOT part of the AI tool
 * surface at all; a prepared action still goes intent → tool firewall → policy
 * engine (lib/policy-engine) → explicit user confirmation → signer. This module
 * validates the tool call itself (name + params); it does not execute anything.
 *
 * Deny by default: an unknown tool, a missing required param, a wrong type, or an
 * unexpected extra param → rejected.
 */

export type ParamType = 'string' | 'number' | 'boolean';
export interface ToolParam {
  name: string;
  type: ParamType;
  required: boolean;
}
export interface ToolSchema {
  name: string;
  /** `read` = pure lookup; `prepare` = build an UNSIGNED draft for review. Never signs. */
  sideEffect: 'read' | 'prepare';
  params: ToolParam[];
}

/**
 * Starter registry of SAFE tools (read/prepare only). Deliberately contains no
 * execute/sign tool — that surface does not exist for the AI. Extend per the
 * final command design; the firewall mechanism is independent of the set.
 */
export const TOOL_REGISTRY: readonly ToolSchema[] = [
  { name: 'get_balance', sideEffect: 'read', params: [{ name: 'asset', type: 'string', required: false }] },
  { name: 'get_portfolio', sideEffect: 'read', params: [] },
  { name: 'resolve_recipient', sideEffect: 'read', params: [{ name: 'query', type: 'string', required: true }] },
  { name: 'explain_tx', sideEffect: 'read', params: [{ name: 'trace_id', type: 'string', required: true }] },
  {
    name: 'prepare_send', // returns an UNSIGNED draft for the review/confirm flow
    sideEffect: 'prepare',
    params: [
      { name: 'asset', type: 'string', required: true },
      { name: 'amount', type: 'string', required: true }, // smallest-unit string
      { name: 'recipient', type: 'string', required: true },
    ],
  },
];

export type FirewallResult =
  | { ok: true; tool: ToolSchema }
  | { ok: false; reason: 'unknown_tool' | 'missing_param' | 'bad_type' | 'unexpected_param'; detail: string };

function registryByName(registry: readonly ToolSchema[]): Map<string, ToolSchema> {
  return new Map(registry.map((t) => [t.name, t]));
}

/**
 * Validate an LLM-proposed tool call against the registry. Pure + deterministic.
 * Rejects unknown tools, missing required params, wrong types, and any param not
 * declared in the schema (no smuggling). Never executes the tool.
 */
export function validateToolCall(
  name: string,
  args: Record<string, unknown>,
  registry: readonly ToolSchema[] = TOOL_REGISTRY,
): FirewallResult {
  const tool = registryByName(registry).get(name);
  if (!tool) return { ok: false, reason: 'unknown_tool', detail: name };

  const allowed = new Set(tool.params.map((p) => p.name));
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) return { ok: false, reason: 'unexpected_param', detail: key };
  }
  for (const p of tool.params) {
    const v = args[p.name];
    if (v === undefined || v === null) {
      if (p.required) return { ok: false, reason: 'missing_param', detail: p.name };
      continue;
    }
    if (typeof v !== p.type) return { ok: false, reason: 'bad_type', detail: p.name };
  }
  return { ok: true, tool };
}

/** Safety invariant helper: the registry must never expose an executing tool. */
export function registryIsReadPrepareOnly(registry: readonly ToolSchema[] = TOOL_REGISTRY): boolean {
  return registry.every((t) => t.sideEffect === 'read' || t.sideEffect === 'prepare');
}
