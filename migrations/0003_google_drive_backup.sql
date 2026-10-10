CREATE TABLE backup_runs_google (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('local', 'aliyundrive', 'googledrive')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'interrupted')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  snapshot_at TEXT,
  file_name TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  remote_file_id TEXT,
  remote_path TEXT,
  error_message TEXT
);
INSERT INTO backup_runs_google SELECT * FROM backup_runs;
DROP TABLE backup_runs;
ALTER TABLE backup_runs_google RENAME TO backup_runs;
CREATE INDEX backup_runs_status_idx ON backup_runs (status);
CREATE INDEX backup_runs_provider_started_idx ON backup_runs (provider, started_at);
