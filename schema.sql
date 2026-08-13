-- Camp Ezekiel Awards — D1 schema
-- Apply with:  npx wrangler d1 execute camp-ezekiel-awards --remote --file=./schema.sql

-- One row per (ballot, award). A ballot is an anonymous random token generated in
-- the voter's browser. Nothing here identifies a person: no name, no email, no raw IP.
CREATE TABLE IF NOT EXISTS votes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ballot_token TEXT    NOT NULL,
  award        TEXT    NOT NULL,
  region       TEXT    NOT NULL,
  ip_hash      TEXT    NOT NULL,   -- salted SHA-256, irreversible, used only for flood control
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Enforces "one vote per award per ballot" at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS votes_ballot_award ON votes (ballot_token, award);

-- Fast tallies and flood-control lookups.
CREATE INDEX IF NOT EXISTS votes_award_region ON votes (award, region);
CREATE INDEX IF NOT EXISTS votes_ip_award     ON votes (ip_hash, award);

-- Turnout: how many people from each region voted at all.
--
-- Deliberately holds NO ballot_token and NO vote data. That separation is the whole
-- point: it can answer "how many voted from the West" but can never answer "how did
-- West voters vote", which at small numbers would identify people. One row is written
-- the first time a ballot records a vote. Do not add a token column to this table.
CREATE TABLE IF NOT EXISTS turnout (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  region     TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS turnout_region ON turnout (region);
