# DentaSync paper gap checklist

Branch: `cursor/paper-gap-features-5dfe`  
Compared against existing Amethyst/DentaSync implementation.

## Already implemented before this branch (do not rebuild)

- Auth (login, register, OTP lockout, password reset)
- Patient/Staff/Dentist/Admin portals listed in the brief
- RFID/QR staff check-in, queue, billing, SMS (Semaphore), OCR sync, analytics export
- Account approve/reject, clinic settings, AI *settings toggles* (shell only)
- Dentist call-next / patient finished / add patient
- Queue reset (active day → completed, no hard delete)
- Patient check-in + live queue status

## Gaps implemented on this branch

| Area | Item | Status |
|------|------|--------|
| System | Public `/queue-display` waiting-room board | DONE |
| Admin | RFID assign/unassign for users | DONE |
| Patient/Staff | HMO company + birth date; staff verify workflow | DONE |
| Patient | X-ray upload + history viewer | DONE |
| Patient | Clinic assistant (FAQ/services; optional Gemini) | DONE |
| Patient | Dependents / family accounts + book for dependent | DONE |
| Queue | Wait estimate from procedure durations | DONE |
| Dentist | Procedure duration, tooth, diagnosis notes | DONE |
| Dentist | 2D interactive dental chart | DONE |
| Dentist | X-ray + AI analysis review (supplementary only) | DONE |
| Dentist | Treatment progress (waiting → called → in treatment → finished) | DONE |
| Staff | Register patient + identity verification | DONE |
| Staff | Actionable notification statuses | DONE |
| Staff | Billing transaction/payment history columns | DONE |
| Patient | X-ray AI analysis storage/view | DONE — **no fake AI**; shows unavailable unless real analysis rows exist |

## Explicitly not faked

- Physical IoT device telemetry
- Multi-branch sync network without real branch topology
- Random/hard-coded “AI diagnosis”
- Fake DB restore that doesn’t use real dump/restore tooling
