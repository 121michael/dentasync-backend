-- Clinic operating hours, holiday/closed overrides, and appointment slot availability.

INSERT INTO admin_portal_settings (setting_key, setting_value)
VALUES (
  'clinic_schedule',
  '{
    "weekdayOpen": "09:00",
    "weekdayClose": "16:00",
    "weekendOpen": "11:00",
    "weekendClose": "16:00",
    "holidayOpen": "11:00",
    "holidayClose": "16:00",
    "slotMinutes": 30
  }'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS clinic_schedule_days (
  schedule_date DATE PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'default'
    CHECK (mode IN ('default', 'custom', 'closed')),
  is_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  open_time TEXT,
  close_time TEXT,
  notes TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS clinic_schedule_days_holiday_idx
  ON clinic_schedule_days (schedule_date)
  WHERE is_holiday = TRUE;

CREATE TABLE IF NOT EXISTS clinic_schedule_slots (
  schedule_date DATE NOT NULL,
  slot_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'unavailable')),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (schedule_date, slot_time)
);

CREATE INDEX IF NOT EXISTS clinic_schedule_slots_date_idx
  ON clinic_schedule_slots (schedule_date, slot_time);
