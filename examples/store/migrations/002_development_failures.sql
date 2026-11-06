CREATE TABLE IF NOT EXISTS store_runtime_controls (
  key text PRIMARY KEY,
  remaining integer NOT NULL DEFAULT 0 CHECK (remaining BETWEEN 0 AND 3),
  updated_at timestamptz NOT NULL DEFAULT now()
);
