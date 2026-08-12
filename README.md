# The Camp Ezekiel Awards

Anonymous voting site for the Camp Ezekiel Awards. Four categories, five regions,
one ballot per person, live results as the votes land.

**Stack:** static HTML + Cloudflare Pages Functions + Cloudflare D1. No build step,
no dependencies, no Node required to work on it.

| File | What it is |
| --- | --- |
| `index.html` | The ballot + live results page. All CSS/JS inline. |
| `leaderboard.html` | Big-screen leaderboard that auto-rotates through the awards. Point a projector at it. |
| `functions/api/vote.js` | `POST` a ballot, `GET` which categories a ballot already voted in. |
| `functions/api/results.js` | `GET` the live tallies. |
| `functions/_shared.js` | Award/region lists, IP hashing, result shaping. |
| `schema.sql` | The D1 table + indexes. |

## The awards

| id | Award | What it's for |
| --- | --- | --- |
| `fomo` | I Should've Gone To That Camp | Biggest FOMO |
| `stealing` | We're Stealing This Next Year | The idea everyone wishes their region had first |
| `cook` | Who Let Them Cook | Most creative / unexpected / outside-the-box idea |
| `runback` | Run That Back | The activity everyone wants to see return |

Regions: `south`, `midwest`, `northeast`, `southeast`, `west`.

## How anonymity and one-vote-per-person work

- No account, no name, no email. Nothing identifying is collected.
- The browser generates a random UUID (the **ballot token**) and keeps it in
  `localStorage`. It's sent with the vote and stored in the `votes` table. It maps to
  a browser, not a person, and to nothing else.
- A `UNIQUE INDEX (ballot_token, award)` means one vote per category per ballot,
  enforced by the database — not just the UI.
- The voter's IP is **salted and SHA-256 hashed** before storage and used only to cap
  ballots per network. The raw IP is never written down.
- Someone who clears their browser storage can vote again. That's the accepted
  trade-off for not asking anyone to sign in — see *Access codes* below if you want
  it tighter.

## Deploy (no Node needed — all in the Cloudflare dashboard)

### 1. Put it on GitHub

```bash
cd "C:\Users\sharp\Session Folders\camp-ezekiel-awards"
git init
git add .
git commit -m "Camp Ezekiel Awards voting site"
gh repo create camp-ezekiel-awards --public --source=. --push
```

### 2. Create the D1 database

Cloudflare dashboard → **Storage & Databases → D1 → Create database**.
Name it `camp-ezekiel-awards`.

Open the new database's **Console** tab, paste the entire contents of `schema.sql`,
and run it.

### 3. Create the Pages project

Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
Pick the `camp-ezekiel-awards` repo.

- Framework preset: **None**
- Build command: *(leave empty)*
- Build output directory: `/`

Deploy.

### 4. Bind the database — this is the step everything depends on

Pages project → **Settings → Bindings → Add → D1 database**.

- Variable name: **`DB`** (exactly this, uppercase)
- D1 database: `camp-ezekiel-awards`

Add it for **both** Production and Preview, then **redeploy** so the binding takes
effect. Until this is done the site loads fine but voting returns
`{"error":"no_database"}`.

### 5. Settings

Same area of the dashboard, added as environment variables rather than bindings
(Cloudflare has moved this between **Settings → Environment variables** and
**Settings → Bindings** over the years — look in both).

| Variable | Default if unset | Effect |
| --- | --- | --- |
| `VOTE_SALT` | the literal string `camp-ezekiel-awards` | Salts the IP hash. **Set this, as a Secret, before the first vote.** |
| `MAX_VOTES_PER_IP` | `1000` | Distinct ballots allowed per network. `0`, `off` or `unlimited` switches the check off entirely. |
| `VOTING_CLOSED` | unset (voting open) | Exactly `1` freezes voting. |

**Assume a change to any of these needs a redeploy to take effect.** Cloudflare Pages
has historically required a new deployment before updated environment variables reach
your Functions, and the behaviour has shifted between platform versions. Redeploying is
quick — Pages project → **Deployments** → the latest one → **Retry deployment** — and
no git push is needed.

This matters most for `VOTING_CLOSED`, since you may want to flip it live during the
ceremony. **Test that switch end to end at least a day beforehand** so you know whether
your project applies it instantly or needs the retry, and roughly how long it takes.

Full explanations below.

### 6. Custom domain (optional)

Pages project → **Custom domains** → add `awards.southregionyouth.org`.
The DNS is already at Cloudflare, so it's a couple of clicks.

---

## The settings, explained

### `VOTE_SALT` — set this one

The site never stores a raw IP. It stores `SHA-256(salt + ":" + ip)`, which is a
one-way fingerprint used only to count ballots per network.

A hash alone is not enough to protect an IP address. There are only ~4 billion IPv4
addresses, so anyone who knows the salt can hash all of them and build a lookup table
in minutes on a laptop — that turns every `ip_hash` in the database back into a real
IP. And the fallback salt is `camp-ezekiel-awards`, sitting in this public repo.

So: without `VOTE_SALT`, a person who obtains the database can work out which network
each ballot came from. Someone on cellular data has a fairly distinctive IP, which at
a camp can narrow to a person. Setting a long random `VOTE_SALT` that lives only in
the Cloudflare dashboard makes that attack impossible without the salt.

- Add it as a **Secret** (encrypted), not a plaintext variable, so it isn't readable
  from the dashboard afterwards.
- Any long random string works — 32+ characters of gibberish.
- **Set it before the first real vote.** Changing the salt later doesn't break the
  site, but every existing row keeps its old hash, so the per-network counts start
  from scratch and old and new ballots stop matching each other.

### `MAX_VOTES_PER_IP` — sharing a network is fine

**This is not one vote per IP.** It is a ceiling of *N distinct ballots* per network,
counted across all four awards. A household of six on six phones produces six ballots
and is nowhere near any limit. The real one-vote-per-person rule is the ballot token,
which is per browser, not per network.

The ceiling exists only to stop a script hammering the endpoint. Its failure mode is
not cheating, it is **legitimate voters getting blocked** — so it defaults to `1000`
and, if you want, switches off completely:

| Value | Meaning |
| --- | --- |
| unset | `1000` ballots per network |
| `2000` (any positive number) | that many ballots per network |
| `0`, `off`, `unlimited` | no ceiling at all; the check is skipped entirely |

Anything unparseable (`abc`, `-5`, blank) falls back to `1000` rather than blocking
everyone — a typo here can't take voting down.

Turning it off is a perfectly reasonable choice for a church camp vote. You keep the
per-browser one-vote rule either way; you only give up the backstop against someone
scripting thousands of requests. The `ip_hash` column keeps being written regardless,
so you can still spot a flood afterwards in the D1 console:

```sql
SELECT ip_hash, COUNT(DISTINCT ballot_token) AS ballots
FROM votes GROUP BY ip_hash ORDER BY ballots DESC LIMIT 10;
```

Two behaviours worth knowing:

- A ballot already seen on that network is **exempt** from the ceiling, so someone who
  votes in two categories and comes back for the rest is never blocked.
- That exemption is per-network. Start a ballot on WiFi, finish it on cellular, and
  the second half counts as a new ballot on the cellular network. Harmless in practice.

### The real shared-device case

The limitation worth knowing about isn't the network, it's **one browser**. Because the
ballot token lives in `localStorage`, two people sharing a single phone hit "you already
voted" for the second person.

If that comes up at camp, the fix is a **private / incognito window** — it gets its own
storage, so the second person gets a fresh ballot. Switching browsers (Safari → Chrome)
works too. Worth telling organisers in advance; it's the one question likely to come up.

### `VOTING_CLOSED` — freezing the result

Set it to exactly `1` (not `true`, not `yes`). Then:

- `POST /api/vote` returns 403 and records nothing.
- The ballot page's submit button reads **"Voting Closed"** and is disabled.
- Results stay fully visible and the leaderboard keeps working — the numbers just stop
  moving. Use it when you announce the winners so nobody can vote after the reveal.

One wrinkle: a page that was **already open** when you flip the switch still shows an
active button, because the closed state is read on page load. Clicking it fails
cleanly with "Voting has closed." rather than doing anything, and a refresh shows the
correct state. Nobody can sneak a late vote in — they just find out a moment later.

## Replacing `share.jpg`

`share.jpg` is currently the **camp's** link-preview image, copied from
`../camp-ezekiel`. Nothing is broken — but when someone drops the awards link in
WhatsApp or GroupMe, the preview card shows the camp flyer instead of the awards.

To swap it:

1. Drop a new `share.jpg` in this folder (~1200×630 works best).
2. In `index.html`, bump `share.jpg?v=1` to `share.jpg?v=2` in **both** the
   `og:image` and `twitter:image` meta tags.

Step 2 is not optional. WhatsApp and Facebook cache preview images by URL and will
happily keep serving the old picture for weeks if the URL doesn't change.

## Checking on the votes

D1 Console:

```sql
SELECT award, region, COUNT(*) AS votes FROM votes GROUP BY award, region ORDER BY award, votes DESC;
SELECT COUNT(DISTINCT ballot_token) AS ballots FROM votes;
```

Clear test votes before going live:

```sql
DELETE FROM votes;
```

## Access codes (if you want stronger integrity)

Not built. It would mean a `codes` table, handing out one-time codes at camp, and the
API marking a code used without linking it to the ballot row. Ask and it's a small
addition.

## Local preview

`dev-server.py` stands in for Cloudflare — it serves the pages *and* fakes the API
against an in-memory SQLite database built from the real `schema.sql`, so the whole
voting flow works offline with no Node and no D1:

```bash
python dev-server.py
```

Open http://localhost:4321. Votes are discarded when you stop the server. Cloudflare
never runs this file; it's a development aid only.

If you do install Node, `npx wrangler pages dev . --d1 DB=camp-ezekiel-awards` runs the
genuine Functions code instead.
