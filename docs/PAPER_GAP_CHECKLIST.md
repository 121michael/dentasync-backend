# DentaSync paper gap checklist

Branch: `cursor/paper-gap-features-5dfe`  
Compared against existing Amethyst/DentaSync implementation.

## Already implemented (do not rebuild)

- Auth (login, register, OTP lockout, password reset)
- Patient/Staff/Dentist/Admin portals listed in the brief
- RFID/QR staff check-in, queue, billing, SMS (Semaphore), OCR sync, analytics export
- Account approve/reject, clinic settings, AI *settings toggles* (shell only)
- Dentist call-next / patient finished / add patient
- Queue reset (active day → completed, no hard delete)

## Gaps to implement (software-feasible)

| Area | Item | Status before |
|------|------|---------------|
| System | Public `/queue-display` waiting-room board | MISSING |
| Admin | RFID assign/unassign for users | MISSING (column exists) |
| Patient/Staff | HMO company + birth date; verify workflow | PARTIAL |
| Patient | X-ray upload + history viewer | PARTIAL (view/count only) |
| Patient | Clinic assistant (FAQ/services; not diagnosis) | MISSING |
| Patient | Dependents / family accounts | MISSING |
| Queue | Wait estimate from durations (not `*12`) | PARTIAL |
| Dentist | Procedure duration, tooth, diagnosis notes | PARTIAL |
| Dentist | 2D interactive dental chart | MISSING |
| Staff | Actionable notification statuses | PARTIAL |
| Patient | X-ray AI analysis | MISSING — **no fake AI**; store optional analysis when configured |

## Explicitly not faked

- Physical IoT device telemetry
- Multi-branch sync network without real branch topology
- Random/hard-coded “AI diagnosis”
- Fake DB restore that doesn’t use real dump/restore tooling
