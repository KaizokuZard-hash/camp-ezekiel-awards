import { json, shapeResults } from '../_shared.js';

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
      votingClosed: env.VOTING_CLOSED === '1',
      ...shapeResults(tally.results || [], ballots?.n || 0),
    });
  } catch (err) {
    return json({ error: 'query_failed', message: String(err) }, 500);
  }
}
