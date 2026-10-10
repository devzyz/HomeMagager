CREATE TABLE payroll_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hourly_rate_cents INTEGER NOT NULL CHECK (typeof(hourly_rate_cents) = 'integer' AND hourly_rate_cents BETWEEN 1 AND 999999),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payroll_days (
  member_id TEXT NOT NULL REFERENCES payroll_members (id),
  work_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('worked', 'leave')),
  hours_hundredths INTEGER NOT NULL CHECK (typeof(hours_hundredths) = 'integer'),
  hourly_rate_cents INTEGER NOT NULL CHECK (typeof(hourly_rate_cents) = 'integer' AND hourly_rate_cents BETWEEN 1 AND 999999),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  updated_by TEXT NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, work_date),
  CHECK ((status = 'leave' AND hours_hundredths = 0 AND amount_cents = 0)
    OR (status = 'worked' AND hours_hundredths BETWEEN 1 AND 2400))
);
