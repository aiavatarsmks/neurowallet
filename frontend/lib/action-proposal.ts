/**
 * lib/action-proposal.ts — the "Action Proposals" + "Explainability" pillars of
 * the Нейра architecture (CLAUDE.md), pure and testable. It GLUES the two moat
 * cores — the Tool Firewall (lib/tool-firewall) and the Policy Engine
 * (lib/policy-engine) — into a single structured proposal the confirm sheet
 * renders. It builds data ONLY: it never signs, broadcasts, or moves funds.
 *
 * Pipeline: intent → tool firewall (validate the tool call) → policy engine
 * (evaluate the action) → proposal (this file) → user confirmation → signer.
 * The signer is downstream and out of scope here.
 */

import { validateToolCall, type FirewallResult } from './tool-firewall';
import {
  evaluateAction,
  type ProposedAction,
  type Policy,
  type PolicyDecision,
  type EvalMode,
} from './policy-engine';

export type ProposalStatus = 'ready' | 'needs_confirmation' | 'blocked';

export interface ActionProposal {
  toolName: string;
  status: ProposalStatus;
  firewall: FirewallResult;
  /** null when the firewall blocked the call before any policy evaluation. */
  policy: PolicyDecision | null;
  /** Human-readable, safe explanation lines (no amounts/addresses leaked). */
  explanation: string[];
}

/** Turn the firewall + policy outcome into user-facing "why" lines. */
export function explainProposal(status: ProposalStatus, policy: PolicyDecision | null, firewall: FirewallResult): string[] {
  if (!firewall.ok) return [`Blocked before evaluation: tool call rejected (${firewall.reason}).`];
  if (!policy) return ['Blocked.'];
  if (policy.reasons.length === 0) return ['Allowed: no policy objected.'];
  const lines = policy.reasons.map((r) => r.message);
  if (status === 'blocked') lines.unshift('This action is blocked by your policies:');
  else if (status === 'needs_confirmation') lines.unshift('Please confirm — your policies ask to double-check:');
  return lines;
}

/**
 * Build a structured, explainable action proposal. Pure + deterministic. Runs
 * the tool firewall first (an invalid tool call never reaches policy), then the
 * policy engine, and derives a status: firewall-reject or policy-deny → blocked;
 * policy-confirm → needs_confirmation; otherwise ready. Executes nothing.
 */
export function buildProposal(
  toolName: string,
  args: Record<string, unknown>,
  action: ProposedAction,
  policies: Policy[],
  mode: EvalMode = 'user',
): ActionProposal {
  const firewall = validateToolCall(toolName, args);
  if (!firewall.ok) {
    return {
      toolName,
      status: 'blocked',
      firewall,
      policy: null,
      explanation: explainProposal('blocked', null, firewall),
    };
  }

  const policy = evaluateAction(action, policies, mode);
  const status: ProposalStatus =
    policy.effect === 'deny' ? 'blocked' : policy.effect === 'confirm' ? 'needs_confirmation' : 'ready';

  return { toolName, status, firewall, policy, explanation: explainProposal(status, policy, firewall) };
}

/** A proposal may proceed to the signer only when nothing blocks it and, if the
 * policies asked, the user has confirmed. Never true for a blocked proposal. */
export function canProceed(proposal: ActionProposal, userConfirmed: boolean): boolean {
  if (proposal.status === 'blocked') return false;
  if (proposal.status === 'needs_confirmation') return userConfirmed;
  return true;
}
