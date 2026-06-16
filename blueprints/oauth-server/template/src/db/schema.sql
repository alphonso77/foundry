-- OAuth server schema

CREATE TABLE IF NOT EXISTS oauth_clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL UNIQUE,
  client_secret TEXT,
  redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authorization_codes (
  code           TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  scope          TEXT[] NOT NULL DEFAULT '{}',
  code_challenge TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti        UUID PRIMARY KEY,
  subject    TEXT NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_subject ON refresh_tokens(subject);
CREATE INDEX IF NOT EXISTS idx_auth_codes_client ON authorization_codes(client_id);
