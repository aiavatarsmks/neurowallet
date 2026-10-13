#!/usr/bin/env node
/**
 * tools/argon/argon.mjs — proposal-only client for Gemini 4 Argon (Vertex AI).
 *
 * Meant to be run LOCALLY (the owner's Mac) by a developer or by Claude Code
 * acting under the owner's permissions. It never applies anything: it sends a
 * task brief plus the listed repo files to Argon and saves Argon's answer
 * (a JSON proposal with edits) under .argon/proposals/. Whoever runs it reads
 * the proposal, applies what is correct, runs the tests and opens a PR.
 *
 * Auth: a short-lived token from the owner's gcloud profile
 *   CLOUDSDK_CONFIG=<GEMINI_GCLOUD_CONFIG> gcloud auth print-access-token
 * No keys are stored anywhere by this script.
 *
 * Config (environment, or KEY=VALUE lines in <repo>/.env.local, gitignored):
 *   GEMINI_PROJECT        GCP project id (required)
 *   GEMINI_LOCATION       default 'global'
 *   GEMINI_GCLOUD_CONFIG  gcloud profile folder (required)
 *   GEMINI_MODEL          default 'gemini-4-argon'
 *   ARGON_BUDGET_USD      hard ceiling for all calls in .argon/ledger.jsonl, default 300
 *   ARGON_TASK_BUDGET_USD ceiling per task id, default 30
 *
 * Usage:
 *   node tools/argon/argon.mjs propose docs/argon-tasks/<id>.md [--feedback <file>] [--max-out 65536]
 *   node tools/argon/argon.mjs spent
 *
 * Pricing is counted at the post-promo rate ($4 per 1M input, $20 per 1M output
 * incl. thinking), so the real bill is never above the ledger. A call is refused
 * BEFORE it is sent when spent + its worst-case cost would pass a ceiling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const STATE = path.join(REPO, '.argon');
const LEDGER = path.join(STATE, 'ledger.jsonl');
const PRICE_IN = 4 / 1e6;
const PRICE_OUT = 20 / 1e6;

// ── config ──────────────────────────────────────────────────────────────────
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(GEMINI_[A-Z_]+|ARGON_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(REPO, '.env.local'));
loadEnvFile(path.join(REPO, 'frontend', '.env.local'));

const CFG = {
  project: process.env.GEMINI_PROJECT,
  location: process.env.GEMINI_LOCATION ?? 'global',
  gcloudConfig: process.env.GEMINI_GCLOUD_CONFIG,
  model: process.env.GEMINI_MODEL ?? 'gemini-4-argon',
  budget: Number(process.env.ARGON_BUDGET_USD ?? 300),
  taskBudget: Number(process.env.ARGON_TASK_BUDGET_USD ?? 30),
};

// ── ledger ──────────────────────────────────────────────────────────────────
function totals() {
  let spent = 0, calls = 0;
  const byTask = {};
  if (fs.existsSync(LEDGER)) {
    for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      spent += r.cost; calls += 1;
      byTask[r.task] = (byTask[r.task] ?? 0) + r.cost;
    }
  }
  return { spent, calls, byTask, left: CFG.budget - spent };
}

// ── auth ────────────────────────────────────────────────────────────────────
function accessToken() {
  if (!CFG.gcloudConfig) throw new Error('GEMINI_GCLOUD_CONFIG is not set (see tools/argon/README.md)');
  const out = execFileSync('gcloud', ['auth', 'print-access-token'], {
    env: { ...process.env, CLOUDSDK_CONFIG: CFG.gcloudConfig },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!out.startsWith('ya29.')) throw new Error('gcloud did not return an access token');
  return out;
}

// ── prompt ──────────────────────────────────────────────────────────────────
const SYSTEM = (id) => `You are a senior TypeScript engineer proposing a change to NeuroWallet, a NON-CUSTODIAL multichain crypto wallet that runs as a Telegram Mini App (Next.js 15 pages router, React 18, TypeScript strict, Tailwind 3, vitest + Testing Library, Supabase). Real users hold real funds. Another engineer reviews your proposal line by line, applies it and runs the tests, so be precise and honest about risks.

Rules:
1. Seed phrases and private keys never leave the browser and never go to the server, logs, analytics or the AI assistant (Neura). Never weaken encryption, PIN or signing checks.
2. Any change in how money moves or how keys are stored ships behind a feature flag NEXT_PUBLIC_<NAME>_ENABLED that defaults to OFF; with the flag OFF behaviour stays exactly as before.
3. Demo mode (isDemo) never touches a real chain, real keys or real balances.
4. No new npm dependencies unless the task explicitly allows one. Server routes use Supabase JWT + rate limit like the existing ones.
5. Behaviour changes come with vitest tests (mock fetch and providers, no live network; '// @vitest-environment node' for pure Node modules when jsdom gets in the way).
6. User-visible strings go into frontend/lib/i18n.ts in BOTH 'ru' and 'en', appended at the very END of each dictionary under a comment line '// ── argon-${id} ──'. Russian copy is plain and short. Never use the em dash character (U+2014) in any new text, RU or EN.
7. No window.alert/confirm/prompt (they break the Telegram WebView). Every localStorage access in try/catch.
8. Minimal, focused diffs in the style of the surrounding code. Do not reformat unrelated code.

Answer with ONLY a JSON object (no markdown fences):
{"summary": "<what the change does, 3-8 lines>",
 "edits": [
   {"path": "<repo-relative path>", "op": "replace", "search": "<exact text copied from the CURRENT file, unique in it, with 2-3 lines of context>", "replace": "<new text>"},
   {"path": "<repo-relative path>", "op": "write", "content": "<full file content, for new files or small files rewritten entirely>"},
   {"path": "<repo-relative path>", "op": "delete"}
 ],
 "tests": "<which tests you added or changed and what they prove>",
 "risks": "<what could go wrong; what the reviewer must check first>"}`;

function parseTask(file) {
  const text = fs.readFileSync(file, 'utf8');
  const id = path.basename(file).replace(/\.md$/, '');
  const filesSection = text.split(/^## Files\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const files = [...filesSection.matchAll(/^\s*-\s+`([^`]+)`/gm)].map((m) => m[1]);
  return { id, text, files };
}

function fileBlock(p) {
  const abs = path.join(REPO, p);
  return fs.existsSync(abs)
    ? `=== FILE: ${p} ===\n${fs.readFileSync(abs, 'utf8')}\n=== END FILE: ${p} ===\n`
    : `=== FILE: ${p} === (does not exist yet)\n`;
}

// ── call ────────────────────────────────────────────────────────────────────
async function propose(taskFile, { feedbackFile, maxOut }) {
  if (!CFG.project) throw new Error('GEMINI_PROJECT is not set (see tools/argon/README.md)');
  const task = parseTask(taskFile);
  let prompt = `${task.text}\n\n## Current content of the relevant files\n${task.files.map(fileBlock).join('\n')}`;
  if (feedbackFile) {
    prompt += `\n\n## Feedback on your previous proposal\nThe files above are the CURRENT state (your earlier edits that were accepted are already in them). Propose only the fixes needed:\n\n${fs.readFileSync(feedbackFile, 'utf8')}`;
  }
  const system = SYSTEM(task.id);

  const worst = ((prompt.length + system.length) / 2.5) * PRICE_IN + maxOut * PRICE_OUT;
  const t = totals();
  if (t.spent + worst > CFG.budget) throw new Error(`budget: spent $${t.spent.toFixed(2)} of $${CFG.budget}, this call could cost up to $${worst.toFixed(2)}`);
  if ((t.byTask[task.id] ?? 0) + worst > CFG.taskBudget) throw new Error(`task budget: ${task.id} spent $${(t.byTask[task.id] ?? 0).toFixed(2)} of $${CFG.taskBudget}`);

  const url = `https://aiplatform.googleapis.com/v1/projects/${CFG.project}/locations/${CFG.location}/publishers/google/models/${CFG.model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { maxOutputTokens: maxOut, temperature: 0.2, responseMimeType: 'application/json' },
  });

  let data;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });
    const raw = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 10_000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Vertex AI HTTP ${res.status}: ${raw.slice(0, 600)}`);
    data = JSON.parse(raw);
    break;
  }

  const u = data.usageMetadata ?? {};
  const inTok = u.promptTokenCount ?? 0, outTok = u.candidatesTokenCount ?? 0, thoughts = u.thoughtsTokenCount ?? 0;
  const cost = inTok * PRICE_IN + (outTok + thoughts) * PRICE_OUT;
  fs.mkdirSync(path.join(STATE, 'proposals'), { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), task: task.id, model: CFG.model, in: inTok, out: outTok, thoughts, cost: Number(cost.toFixed(6)) }) + '\n');

  const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(STATE, 'proposals', `${task.id}-${stamp}.json`);
  fs.writeFileSync(out, text);
  const after = totals();
  console.log(JSON.stringify({
    task: task.id, proposal: path.relative(REPO, out), finish: data.candidates?.[0]?.finishReason,
    cost_usd: Number(cost.toFixed(4)), tokens: { in: inTok, out: outTok, thinking: thoughts },
    spent_usd: Number(after.spent.toFixed(2)), left_usd: Number(after.left.toFixed(2)),
  }, null, 2));
}

// ── cli ─────────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
try {
  if (cmd === 'propose' && rest[0]) {
    await propose(rest[0], { feedbackFile: flag('--feedback'), maxOut: Number(flag('--max-out') ?? 65536) });
  } else if (cmd === 'spent') {
    const t = totals();
    console.log(JSON.stringify({ spent_usd: Number(t.spent.toFixed(2)), left_usd: Number(t.left.toFixed(2)), calls: t.calls, by_task: t.byTask }, null, 2));
  } else {
    console.log('usage: node tools/argon/argon.mjs propose docs/argon-tasks/<id>.md [--feedback <file>] [--max-out N]\n       node tools/argon/argon.mjs spent');
    process.exit(2);
  }
} catch (e) {
  console.error(`argon: ${e.message}`);
  process.exit(1);
}
