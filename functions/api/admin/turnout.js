import { REGIONS, json } from '../../_shared.js';

/**
 * GET /api/admin/turnout — organiser-only turnout metrics.
 *
 * Answers "how many people from each region voted", nothing more. The turnout table
 * carries no ballot token and no vote data, so this endpoint cannot reveal how any
 * region voted even if the key leaks. That is by design, not by omission.
 *
 * Auth: set an ADMIN_KEY secret, then send it as
 *     Authorization: Bearer <key>        (preferred — stays out of history and logs)
 *     X-Admin-Key: <key>
 *     ?key=<key>                         (convenient in a browser, but the key lands
 *                                         in browser history and any proxy log)
 *
 * With no ADMIN_KEY configured the endpoint is disabled outright rather than left
 * open — a metrics URL on a public site will be found eventually, and obscurity is
 * not access control.
 */

// Length-independent comparison, so response timing can't be used to guess the key.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Compare a fixed-size digest so differing lengths don't short-circuit.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function presentedKey(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = request.headers.get('X-Admin-Key');
  if (header) return header.trim();
  return new URL(request.url).searchParams.get('key') || '';
}

export async function onRequestGet({ request, env }) {
  // Same opaque 404 whether the key is wrong or the feature is off, so probing
  // reveals nothing about whether this endpoint exists.
  const deny = () => new Response('Not found', { status: 404 });

  if (!env.ADMIN_KEY) return deny();
  if (!safeEqual(presentedKey(request), env.ADMIN_KEY)) return deny();
  if (!env.DB) return json({ error: 'no_database' }, 503);

  try {
    const rows = await env.DB.prepare(
      'SELECT region, COUNT(*) AS voters FROM turnout GROUP BY region'
    ).all();

    const byRegion = Object.fromEntries(REGIONS.map((r) => [r, 0]));
    for (const row of rows.results || []) {
      if (row.region in byRegion) byRegion[row.region] = row.voters;
    }

    const declared = Object.values(byRegion).reduce((sum, n) => sum + n, 0);

    // Ballots that voted without declaring a region (e.g. cast before this feature
    // existed) still count toward the total, so the two numbers won't always match.
    const ballots = await env.DB.prepare(
      'SELECT COUNT(DISTINCT ballot_token) AS n FROM votes'
    ).first();

    const first = await env.DB.prepare('SELECT MIN(created_at) AS t FROM turnout').first();
    const last  = await env.DB.prepare('SELECT MAX(created_at) AS t FROM turnout').first();

    return json({
      ok: true,
      byRegion,
      declaredVoters: declared,
      totalBallots: ballots?.n || 0,
      undeclaredVoters: Math.max(0, (ballots?.n || 0) - declared),
      firstVoteAt: first?.t || null,
      latestVoteAt: last?.t || null,
      note: 'Turnout only. This data cannot be linked to how anyone voted.',
    });
  } catch (err) {
    console.error('turnout query failed:', err);
    return json({ error: 'query_failed', message: 'Could not load turnout.' }, 500);
  }
}
