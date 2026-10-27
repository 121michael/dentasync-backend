-- Add independently bookable prosthodontic and cosmetic services.
-- Keep the legacy combined id for historical wait-time lookups.

INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes)
VALUES
  ('dentures-bridge-crown', 'Dentures / Fixed Bridge / Crown', 60),
  ('dentures', 'Dentures', 60),
  ('fixed-bridge', 'Fixed Bridge', 60),
  ('dental-crowns', 'Dental Crowns', 60),
  ('veneers', 'Veneers', 60),
  ('dental-implants', 'Dental Implants', 90),
  ('gum-contouring', 'Gum Contouring', 60)
ON CONFLICT (service_id) DO UPDATE
SET service_name = EXCLUDED.service_name,
    default_duration_minutes = EXCLUDED.default_duration_minutes,
    updated_at = CURRENT_TIMESTAMP;
