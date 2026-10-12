// Generates demo-data.json: a plausible, deterministic year of contributions
// in the same shape as the contributions API. Run with:
//   node scripts/make-demo-data.mjs [end-date YYYY-MM-DD]

import { writeFileSync } from 'node:fs';

let seed = 20251012;
function rand() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const end = new Date(`${process.argv[2] || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const start = new Date(end);
start.setUTCFullYear(start.getUTCFullYear() - 1);

const days = [];
let momentum = 0.5;
let vacation = 0;
for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay();
  const weekend = dow === 0 || dow === 6;
  // Momentum drifts so the year has busy stretches and quiet ones.
  momentum = Math.min(1, Math.max(0.1, momentum + (rand() - 0.5) * 0.25));
  if (vacation === 0 && rand() < 0.012) vacation = 5 + Math.floor(rand() * 9);

  let count = 0;
  if (vacation > 0) {
    vacation--;
  } else {
    const p = weekend ? 0.3 * momentum : 0.35 + 0.6 * momentum;
    if (rand() < p) {
      const base = weekend ? 3 : 7;
      count = 1 + Math.floor(Math.pow(rand(), 2.2) * base * (0.5 + momentum * 2));
      if (rand() < 0.02) count += 15 + Math.floor(rand() * 25); // launch days
    }
  }
  days.push({ date: d.toISOString().slice(0, 10), count });
}

// Levels follow GitHub's quartile-ish buckets.
const max = Math.max(...days.map((d) => d.count));
const contributions = days.map((d) => ({
  ...d,
  level: d.count === 0 ? 0 : Math.min(4, 1 + Math.floor((d.count / max) * 4)),
}));
const total = days.reduce((s, d) => s + d.count, 0);

writeFileSync(
  new URL('../demo-data.json', import.meta.url),
  JSON.stringify({ username: 'demo', total: { lastYear: total }, contributions }) + '\n',
);
console.log(`Wrote ${days.length} days, ${total} contributions, max ${max}`);
