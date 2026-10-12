// Data layer: fetch a user's last-year contribution calendar, or fall back to demo data.
//
// The public API at github-contributions-api.jogruber.de scrapes the profile
// contribution graph, so it needs no token. Its response looks like:
//   { total: { lastYear: 1234 }, contributions: [{ date: "2025-10-12", count: 3, level: 1 }, ...] }

const API = 'https://github-contributions-api.jogruber.de/v4/';
const DEMO_URL = 'demo-data.json';
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function isValidUsername(name) {
  return USERNAME_RE.test(name);
}

/**
 * Load contributions for `username`.
 * Resolves to { username, days, source } where source is 'api' or 'demo',
 * plus `error` when the demo fallback was used.
 */
export async function loadContributions(username, { signal } = {}) {
  if (!isValidUsername(username)) {
    return loadDemo(`"${username}" is not a valid GitHub username`, signal);
  }
  try {
    const res = await fetch(`${API}${encodeURIComponent(username)}?y=last`, { signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !Array.isArray(body.contributions)) {
      const reason = body && body.error ? body.error : `HTTP ${res.status}`;
      throw new Error(res.status === 404 ? `user "${username}" not found` : reason);
    }
    const days = normalize(body.contributions);
    if (!days.length) throw new Error('no contribution data returned');
    return { username, days, source: 'api' };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return loadDemo(err.message || String(err), signal);
  }
}

async function loadDemo(reason, signal) {
  const res = await fetch(DEMO_URL, { signal });
  const body = await res.json();
  return { username: body.username || 'demo', days: normalize(body.contributions), source: 'demo', error: reason };
}

// Sort by date, drop future days and coerce counts to numbers.
function normalize(list) {
  const today = new Date().toISOString().slice(0, 10);
  return list
    .filter((d) => d && typeof d.date === 'string' && d.date <= today)
    .map((d) => ({ date: d.date, count: Math.max(0, Number(d.count) || 0) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Summary numbers shown in the panel. */
export function computeStats(days) {
  let total = 0;
  let best = { count: 0, date: null };
  let active = 0;
  let streak = 0;
  let longest = 0;
  for (const d of days) {
    total += d.count;
    if (d.count > best.count) best = d;
    if (d.count > 0) {
      active++;
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
    }
  }
  return { total, best, active, longest };
}
