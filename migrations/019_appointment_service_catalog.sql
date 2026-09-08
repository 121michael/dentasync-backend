-- Keep wait-time duration seeds aligned with patient bookable services.

INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes)
VALUES
  ('cleaning', 'Dental Cleaning / Oral Prophylaxis', 45),
  ('extraction', 'Tooth Extraction', 60),
  ('filling', 'Permanent Filling / Restoration', 45),
  ('root-canal', 'Root Canal Treatment', 90),
  ('orthodontic-consultation', 'Orthodontic Consultation', 30),
  ('whitening', 'Teeth Whitening', 60),
  ('general-consultation', 'Oral Examination / Consultation', 30),
  ('emergency-care', 'Emergency Dental Care', 45),
  ('oral-surgery', 'Oral Surgery', 90),
  ('dentures-bridge-crown', 'Dentures / Fixed Bridge / Crown', 60)
ON CONFLICT (service_id) DO UPDATE
SET service_name = EXCLUDED.service_name,
    default_duration_minutes = EXCLUDED.default_duration_minutes,
    updated_at = CURRENT_TIMESTAMP;
