#!/usr/bin/env node
/**
 * scripts/audit-gate.mjs
 *
 * CI security gate: fails on any high/critical npm advisory, except the ones
 * explicitly allowlisted below with a reason and an expiry date.
 *
 * Why not plain `npm audit --audit-level=high`: some advisories have no patched
 * release at all (e.g. `braces`, pulled in only by the Tailwind 3 build
 * toolchain). Plain audit would keep CI red forever, which teaches everyone to
 * ignore it. An allowlist keeps the gate strict for everything else and makes
 * every exception visible, justified and time-boxed (expired entry → CI fails
 * again and forces a re-check).
 *
 * Usage (from a workspace dir, e.g. frontend/): node ../scripts/audit-gate.mjs
 */
import { execSync } from 'node:child_process';

const ALLOWLIST = [
  {
    id: 'GHSA-vfj7-8cjw-p6xm',
    pkg: 'braces',
    reason:
      'Build-time only: tailwindcss@3 → chokidar/fast-glob/micromatch → braces. ' +
      'Patterns come from our own tailwind config, never from users; nothing ' +
      'ships to the browser or runs on Vercel at request time. No patched braces ' +
      'release exists. Remove after the Tailwind 4 migration.',
    expires: '2027-01-31',
  },
];

const BLOCKING = new Set(['high', 'critical']);

function runAudit() {
  try {
    return execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    if (e && typeof e.stdout === 'string' && e.stdout.trim().startsWith('{')) return e.stdout;
    throw e;
  }
}

const report = JSON.parse(runAudit());
const vulns = report.vulnerabilities ?? {};
const today = new Date().toISOString().slice(0, 10);

/** Direct advisories only (objects in `via`), deduplicated by GHSA id. */
const advisories = new Map();
for (const [pkg, v] of Object.entries(vulns)) {
  for (const via of v.via ?? []) {
    if (typeof via !== 'object' || !via) continue;
    const id = String(via.url ?? '').split('/').pop() || `${pkg}:${via.source}`;
    if (!advisories.has(id)) advisories.set(id, { id, pkg: via.name ?? pkg, severity: via.severity, title: via.title, url: via.url });
  }
}

const blocking = [];
const allowed = [];
for (const a of advisories.values()) {
  if (!BLOCKING.has(a.severity)) continue;
  const entry = ALLOWLIST.find((x) => x.id === a.id && x.pkg === a.pkg);
  if (!entry) { blocking.push(a); continue; }
  if (entry.expires < today) { blocking.push({ ...a, title: `${a.title} (allowlist entry expired ${entry.expires})` }); continue; }
  allowed.push({ ...a, entry });
}

for (const a of allowed) {
  console.log(`ALLOWED  ${a.severity.padEnd(8)} ${a.pkg}  ${a.id}  until ${a.entry.expires}\n         ${a.entry.reason}`);
}
if (blocking.length) {
  console.error(`\nBLOCKED: ${blocking.length} high/critical advisory(ies) without an allowlist entry:`);
  for (const a of blocking) console.error(`  ${a.severity.padEnd(8)} ${a.pkg}  ${a.id}  ${a.title}\n           ${a.url}`);
  process.exit(1);
}
console.log(`\naudit-gate: OK (${advisories.size} advisories total, 0 blocking high/critical)`);
