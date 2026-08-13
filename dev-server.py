"""Local preview server for the Camp Ezekiel Awards site.

Cloudflare D1 and Pages Functions only exist once deployed (or under `wrangler`,
which needs Node). This script stands in for both: it serves the static files and
reimplements /api/vote and /api/results against a throwaway in-memory SQLite
database using the real schema.sql, so the full voting flow works offline.

    python dev-server.py

Then open http://localhost:4321. Votes live in memory only and vanish on exit.
This file is a development aid — Cloudflare never runs it.
"""

import json
import os
import sqlite3
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

REPO = os.path.dirname(os.path.abspath(__file__))
# Only public/ is web-served, matching pages_build_output_dir in wrangler.jsonc.
ROOT = os.path.join(REPO, "public")
PORT = 4321

# Must match functions/_shared.js.
AWARDS = ["fomo", "stealing", "cook", "runback"]
REGIONS = ["south", "midwest", "northeast", "southeast", "west"]

db = sqlite3.connect(":memory:", check_same_thread=False)
with open(os.path.join(REPO, "schema.sql"), encoding="utf-8") as fh:
    db.executescript(fh.read())


def shape():
    """Mirror of shapeResults() in functions/_shared.js."""
    rows = db.execute(
        "SELECT award, region, COUNT(*) FROM votes GROUP BY award, region"
    ).fetchall()

    awards = {a: {"total": 0, "regions": {r: 0 for r in REGIONS}} for a in AWARDS}
    for award, region, votes in rows:
        awards[award]["regions"][region] = votes
        awards[award]["total"] += votes

    overall = {r: sum(awards[a]["regions"][r] for a in AWARDS) for r in REGIONS}
    ballots = db.execute("SELECT COUNT(DISTINCT ballot_token) FROM votes").fetchone()[0]

    return {
        "awards": awards,
        "overall": overall,
        "ballots": ballots,
        "updated": "local",
        "votingClosed": False,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/results":
            return self._json({"ok": True, **shape()})

        if path == "/api/vote":
            token = (parse_qs(urlparse(self.path).query).get("token") or [""])[0]
            rows = db.execute(
                "SELECT award, region FROM votes WHERE ballot_token = ?", (token,)
            ).fetchall()
            return self._json({
                "ok": True,
                "votingClosed": False,
                "voted": [{"award": a, "region": r} for a, r in rows],
            })

        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/vote":
            return self.send_error(404)

        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        token, votes = body.get("token"), body.get("votes") or {}

        if not token:
            return self._json({"error": "bad_token"}, 400)
        for award, region in votes.items():
            if award not in AWARDS:
                return self._json({"error": "unknown_award", "award": award}, 400)
            if region not in REGIONS:
                return self._json({"error": "unknown_region", "region": region}, 400)
        if not votes:
            return self._json({"error": "empty_ballot"}, 400)

        recorded = 0
        for award, region in votes.items():
            cur = db.execute(
                "INSERT OR IGNORE INTO votes (ballot_token, award, region, ip_hash)"
                " VALUES (?, ?, ?, ?)",
                (token, award, region, "local"),
            )
            recorded += cur.rowcount
        db.commit()

        return self._json({
            "ok": True,
            "recorded": recorded,
            "duplicates": len(votes) - recorded,
            **shape(),
        })


if __name__ == "__main__":
    # ASCII only — the default Windows console codepage (cp1252) can't encode arrows.
    print(f"Camp Ezekiel Awards preview -> http://localhost:{PORT}")
    print("In-memory database. Votes are discarded when you stop the server.\n")
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
