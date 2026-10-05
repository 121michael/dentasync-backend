# Patient portal paper-gap checklist

Branch: `cursor/patient-portal-ai-dependents-5dfe`

## Keep (already working)

- Auth (login, register, OTP, password reset)
- Dashboard / Appointments / Queue / Profile / SMS / Notifications / Help
- Booking without preferred dentist
- Public `/queue-display`
- Wait-time estimates from procedure durations
- Backend ownership via JWT `userIdFor(req)`

## Gaps addressed on this branch

| Item | Before | Action |
|------|--------|--------|
| AI Assistant image "+" + in-chat X-ray analysis | Missing | Implement in Clinic Assistant |
| Standalone Records X-ray upload | Present | Remove upload UI; point patients to AI Assistant |
| Treatment history appointment-based | Partial | Include completed appointments for auth patient |
| Family eligibility (under 12 / toddler / PWD / senior) | Missing | Enforce + update copy |
| Admin RFID patients-only | Allowed all roles | Restrict to patients |
| Dashboard notifications / SMS snapshot | Partial | Surface unread + SMS preference |
| HMO verification status for patient | API only | Show on Appointments list |

## Not faked

- AI image findings only when `GEMINI_API_KEY` is configured; otherwise upload is saved and analysis marked unavailable with disclaimer
- No patient access to staff/dentist/admin functions
