# Camp Ezekiel Awards — Project Context

Anonymous voting site for the **Camp Ezekiel Awards**: five regions of Forward In Faith
Ministries International — USA Youth & Young Adults compete across four joke-serious
awards, with a live vote counter. Sibling project to the main camp site at
`../camp-ezekiel` (https://southregionyouth.org).

## Architecture

- Static HTML with all CSS/JS inline per page (same convention as `camp-ezekiel`), plus
  **Cloudflare Pages Functions** in `functions/` and a **Cloudflare D1** database.
- No build step, no npm dependencies. Node is *not* installed on this machine — do not
  add tooling that requires it, and prefer Cloudflare dashboard instructions over
  `wrangler` commands when writing docs.
- `index.html` — the ballot (4 award cards × 5 region radio pickers) and the live
  results section. Polls `/api/results` every 7s.
- `leaderboard.html` — big-screen projection view. Auto-rotates through overall + the
  four awards every 9s; arrow keys change slide, space pauses. Polls every 6s.
- `functions/_shared.js` — `AWARDS`/`REGIONS` id lists, salted IP hashing, result
  shaping. **The frontend keeps its own inline copies of these lists — change both.**
- `schema.sql` — one `votes` table, one row per (ballot, award).

## Voting rules (decided by the owner)

- Fully anonymous: no name, no email, no login.
- **One ballot per device, one vote per award.** Enforced by
  `UNIQUE INDEX votes_ballot_award ON votes (ballot_token, award)` — the DB, not the UI.
- Ballot token = `crypto.randomUUID()` in `localStorage` under `ce_awards_ballot_v1`.
- IP is salted-SHA-256 hashed, used only for a per-network ballot *ceiling* — **not** a
  one-vote-per-IP rule. `MAX_VOTES_PER_IP` defaults to 1000 and accepts `0`/`off`/
  `unlimited` to skip the check entirely; unparseable values fall back to the default
  rather than blocking everyone. Households and camp WiFi share one IP, so this errs
  high deliberately: false-blocking a real voter is worse than letting one through.
- Known limitation: two people sharing **one browser** can't both vote (the token is in
  `localStorage`). Workaround is a private/incognito window.
- Partial ballots are allowed: vote in two categories now, come back for the rest. The
  page reloads locked categories from `GET /api/vote?token=…`.

## Awards and regions (ids are load-bearing — used as DB values)

| id | Award |
| --- | --- |
| `fomo` | I Should've Gone To That Camp |
| `stealing` | We're Stealing This Next Year |
| `cook` | Who Let Them Cook |
| `runback` | Run That Back |

Regions: `south`, `midwest`, `northeast`, `southeast`, `west`.

## Design language

People's Choice Awards: black stage, animated spotlight beams, film grain, gold
gradient display type (Playfair Display), marquee bulbs, corner-ornamented cards, gold
confetti burst on submit. Each region has a fixed color used consistently across the
ballot, results bars, and leaderboard:

| Region | Color |
| --- | --- |
| South | `#f5a623` (gold — matches the camp site's Youth palette) |
| Midwest | `#37c98b` |
| North East | `#5b8dff` |
| South East | `#ff6b9d` |
| West | `#a970ff` |

All animation respects `prefers-reduced-motion`.

## Deployment

Separate Cloudflare Pages project from the main camp site. Full setup steps are in
`README.md`. The one thing that breaks everything if missed: the D1 binding must be
named **`DB`** and added to both Production and Preview, followed by a redeploy.

## Assets

`logo.png` and `share.jpg` are copied from `../camp-ezekiel`. `share.jpg` is the *camp*
link-preview image, not an awards-specific one — replace it with awards artwork and bump
the `?v=` query in both `og:image` and `twitter:image` meta tags in `index.html`.
