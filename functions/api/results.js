import { json, shapeResults, votingClosedNow, closesAtIso } from '../_shared.js';

// GET /api/results — live tallies. Polled by the ballot page and the leaderboard.
export async function onRequestGet({ env }) {
  if (!env.DB) {
    return json({ error: 'no_database', message: 'D1 binding "DB" is not configured.' }, 503);
  }

  try {
    const tally = await env.DB.prepare(
      'SELECT award, region, COUNT(*) AS votes FROM votes GROUP BY award, region'
    ).all();

    const ballots = await env.DB.prepare(
      'SELECT COUNT(DISTINCT ballot_token) AS n FROM votes'
    ).first();

    return json({
      ok: true,
      votingClosed: votingClosedNow(env),
      closesAt: closesAtIso(env),
      ...shapeResults(tally.results || [], ballots?.n || 0),
    });
  } catch (err) {
    // Logged for `wrangler pages deployment tail`; not exposed to the caller.
    console.error('results query failed:', err);
    return json({ error: 'query_failed', message: 'Could not load results.' }, 500);
  }
}
