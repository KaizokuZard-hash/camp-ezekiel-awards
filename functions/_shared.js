// Shared constants + helpers for the Camp Ezekiel Awards API.
// The frontend keeps its own copy of these lists inline (per this project's
// no-build-step convention) — if you add an award or a region, update BOTH.

export const AWARDS = ['fomo', 'stealing', 'cook', 'runback'];

export const REGIONS = ['south', 'midwest', 'northeast', 'southeast', 'west'];

// A whole household — or a whole camp on one WiFi — shares a single public IP, so this
// ceiling is deliberately high. It exists only to stop a script hammering the endpoint;
// real dedup is the per-browser ballot token. Blocking a real voter is far worse than
// letting a borderline one through, so this errs high.
// Override with a MAX_VOTES_PER_IP environment variable in the Pages dashboard.
const DEFAULT_MAX_PER_IP = 1000;

// Returns Infinity when the check is switched off, so callers can skip the lookup
// entirely. `0`, `off` and `unlimited` all mean "no ceiling" — anyone setting 0 means
// "no limit", never "reject everybody".
export function maxPerIp(env) {
  const raw = String(env.MAX_VOTES_PER_IP ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'unlimited') return Infinity;

  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PER_IP;
}

// Voting is closed if the manual switch is on, or the deadline has passed.
//
// A bad VOTING_CLOSES_AT value leaves voting OPEN rather than closing it. Failing
// open is recoverable — flip VOTING_CLOSED to "1" — whereas failing closed would
// silently block everyone with no obvious cause.
export function votingClosedNow(env) {
  if (env.VOTING_CLOSED === '1') return true;
  const deadline = Date.parse(env.VOTING_CLOSES_AT || '');
  return Number.isFinite(deadline) && Date.now() >= deadline;
}

// The deadline as ISO-8601 for the page to display and count down to, or null.
export function closesAtIso(env) {
  const deadline = Date.parse(env.VOTING_CLOSES_AT || '');
  return Number.isFinite(deadline) ? new Date(deadline).toISOString() : null;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Irreversible, salted hash of the voter's IP. Set VOTE_SALT as a secret in the
// Pages dashboard; without it the hash is still one-way but easier to brute-force.
export async function hashIp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const salt = env.VOTE_SALT || 'camp-ezekiel-awards';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Ballot tokens are crypto.randomUUID() from the browser. Accept only that shape
// so the token column can't be used to smuggle arbitrary data.
export function isValidToken(token) {
  return typeof token === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

// Turns the raw (award, region, count) rows into the shape the frontend renders.
export function shapeResults(rows, ballotCount) {
  const awards = {};
  for (const award of AWARDS) {
    awards[award] = { total: 0, regions: {} };
    for (const region of REGIONS) awards[award].regions[region] = 0;
  }

  for (const row of rows) {
    const award = awards[row.award];
    if (!award || !(row.region in award.regions)) continue;
    award.regions[row.region] = row.votes;
    award.total += row.votes;
  }

  const overall = {};
  for (const region of REGIONS) overall[region] = 0;
  for (const award of AWARDS) {
    for (const region of REGIONS) overall[region] += awards[award].regions[region];
  }

  return {
    awards,
    overall,
    ballots: ballotCount,
    updated: new Date().toISOString(),
  };
}
