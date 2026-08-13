import {
  AWARDS,
  REGIONS,
  json,
  hashIp,
  isValidToken,
  maxPerIp,
  shapeResults,
} from '../_shared.js';

// GET /api/vote?token=... — which awards has this ballot already voted in?
// Lets a returning voter finish a partly-filled ballot instead of starting over.
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'no_database' }, 503);

  const token = new URL(request.url).searchParams.get('token');
  if (!isValidToken(token)) return json({ ok: true, voted: [] });

  const rows = await env.DB.prepare(
    'SELECT award, region FROM votes WHERE ballot_token = ?'
  ).bind(token).all();

  return json({
    ok: true,
    votingClosed: env.VOTING_CLOSED === '1',
    voted: (rows.results || []).map((r) => ({ award: r.award, region: r.region })),
  });
}

// POST /api/vote — body: { token: "<uuid>", votes: { "<award>": "<region>", ... } }
export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json({ error: 'no_database', message: 'D1 binding "DB" is not configured.' }, 503);
  }
  if (env.VOTING_CLOSED === '1') {
    return json({ error: 'voting_closed', message: 'Voting is closed.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const { token, votes } = body || {};
  if (!isValidToken(token)) {
    return json({ error: 'bad_token', message: 'Missing or malformed ballot token.' }, 400);
  }
  if (!votes || typeof votes !== 'object') {
    return json({ error: 'bad_votes' }, 400);
  }

  // Only known award/region pairs make it past here.
  const picks = [];
  for (const [award, region] of Object.entries(votes)) {
    if (!AWARDS.includes(award)) {
      return json({ error: 'unknown_award', award }, 400);
    }
    if (!REGIONS.includes(region)) {
      return json({ error: 'unknown_region', region }, 400);
    }
    picks.push([award, region]);
  }
  if (picks.length === 0) {
    return json({ error: 'empty_ballot', message: 'Pick at least one award.' }, 400);
  }

  const ipHash = await hashIp(request, env);

  // Flood control: a ceiling on distinct ballots from one address, counted across all
  // awards. A household or a camp WiFi puts many legitimate voters behind one IP, so
  // this is high on purpose — and skipped entirely (two fewer queries) when switched off.
  const ceiling = maxPerIp(env);
  if (ceiling !== Infinity) {
    const seen = await env.DB.prepare(
      'SELECT COUNT(DISTINCT ballot_token) AS n FROM votes WHERE ip_hash = ?'
    ).bind(ipHash).first();

    // A ballot already seen on this network is exempt, so someone returning to finish
    // a partly-filled ballot is never turned away by the ceiling.
    const alreadyCounted = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM votes WHERE ip_hash = ? AND ballot_token = ?'
    ).bind(ipHash, token).first();

    const isNewBallotHere = (alreadyCounted?.n || 0) === 0;

    if (isNewBallotHere && (seen?.n || 0) >= ceiling) {
      return json({
        error: 'rate_limited',
        message: 'Too many ballots from this network. Try again later or tell an organiser.',
      }, 429);
    }
  }

  // The unique index on (ballot_token, award) does the real enforcement of
  // "one vote per award per ballot"; INSERT OR IGNORE turns a repeat into a no-op.
  const statement = env.DB.prepare(
    'INSERT OR IGNORE INTO votes (ballot_token, award, region, ip_hash) VALUES (?, ?, ?, ?)'
  );

  let recorded = 0;
  try {
    const results = await env.DB.batch(
      picks.map(([award, region]) => statement.bind(token, award, region, ipHash))
    );
    recorded = results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
  } catch (err) {
    // Log the real error for `wrangler pages deployment tail`, but never echo internal
    // detail (SQL text, schema names) back to the caller.
    console.error('vote insert failed:', err);
    return json({ error: 'insert_failed', message: 'Could not record your vote.' }, 500);
  }

  // Hand back fresh tallies so the page can reveal results without a second round trip.
  const tally = await env.DB.prepare(
    'SELECT award, region, COUNT(*) AS votes FROM votes GROUP BY award, region'
  ).all();
  const ballots = await env.DB.prepare(
    'SELECT COUNT(DISTINCT ballot_token) AS n FROM votes'
  ).first();

  return json({
    ok: true,
    recorded,
    duplicates: picks.length - recorded,
    ...shapeResults(tally.results || [], ballots?.n || 0),
  });
}
