# DentaSync backend

## OTP verification setup

Apply the OTP storage migration before deploying this version:

```bash
npm run migrate:otp
```

Set `OTP_SECRET` to a high-entropy server secret in production. It is used to
HMAC verification codes before storing them. `EMAIL_USER` and `EMAIL_PASS` must
also be configured for Gmail delivery.

```bash
npm start
```

The migration creates `otp_verification_requests`. It intentionally does not
reuse the legacy `otps` table, so an unverified account with a code issued by
an earlier release must request a new code after deployment.

## Patient OTP API contract

1. `POST /api/auth/register` with a patient’s `firstName`, `lastName`, `email`,
   `phone`, and `password`. The account is created unverified. The response
   contains `requestId` and `expiresAt`; it does not contain a token.
2. Persist the returned `requestId` in the verification page state (for
   example, session storage) so a page refresh uses the same request.
3. `POST /api/auth/verify-otp` with:

   ```json
   {
     "requestId": "the-request-id-from-registration-or-resend",
     "otp": "012345"
   }
   ```

   `otp` must be a six-character string. Do not convert it to a number, or a
   leading zero will be lost.
4. On success, save the returned token and navigate to `redirectTo`
   (`/patient/dashboard`).

`POST /api/auth/send-otp` resends a code for an existing, unverified patient.
It requires the same `email` and `phone`, invalidates the previous request,
and returns a new `requestId`. Replace the locally stored request ID with this
new value. Disable the resend and verify buttons while their respective
requests are pending to avoid duplicate submissions.

For compatibility with an existing verification page, `POST /api/auth/verify-otp`
also accepts `{ "phone": "...", "otp": "012345" }` when `requestId` is absent.
The server normalizes the phone and resolves only its newest active request.
New clients should continue using `requestId`, which is more explicit and
survives page refreshes without an additional lookup.

The server records privacy-safe OTP audit events containing the request ID,
hashed account fingerprint, timestamps, lookup outcome, expiry state, and
match outcome. It never logs the OTP itself.

## Password reset setup

`npm run migrate` also installs the one-time password-reset storage. Configure
these production values:

```env
PASSWORD_RESET_SECRET=a-separate-high-entropy-server-secret
FRONTEND_URL=https://your-portal.example

# Use either a generic SMTP provider:
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=mailer@example.com
EMAIL_PASSWORD=your-smtp-password

# Or retain the existing Gmail setup:
# EMAIL_USER=your-gmail-address
# EMAIL_PASS=your-gmail-app-password
```

`POST /api/auth/forgot-password` accepts a valid email address for active,
verified Admin, Dentist, Staff, and Patient accounts. It is rate-limited to
five requests per IP address per 15 minutes. Per the current product
requirement, it returns `404` with an email-not-found message for unregistered
or unavailable accounts. This is less resistant to account-enumeration attacks
than a generic reset response.

For a matching account, it sends a 30-minute, one-time reset link using the
form `https://your-portal.example/reset-password/<secure-token>`.
`POST /api/auth/reset-password` accepts the opaque token and either
`newPassword` or `password` (at least 10 characters). Reset tokens are
HMAC-hashed at rest, expire server-side, and are invalidated after use or
resend. Passwords are never sent by email or stored in plain text.

## Amethyst Dental patient portal

The responsive patient experience lives in [`client/`](./client). It includes
the dashboard, appointment booking, live queue, treatment archive, profile,
notifications, mobile navigation, and a persisted dark-mode preference.

Apply all portal migrations before starting the API:

```bash
npm run migrate
npm run seed:patient
npm start
```

Then, in a second terminal:

```bash
cd client
npm install
npm run dev
```

Seeded patient login (for local testing):

- Email: `patient@amethyst.com`
- Password: `PatientPass123!`
- Opens: `/dashboard`

If the browser shows `/api/patient/dashboard` **404**, the Vite app is talking
to the wrong/outdated backend. Stop every Node process on port 5000, then start
**only** `C:\DentaSync-backend` (`npm start`). The console must print
`Mounted APIs: /api/auth, /api/patient, /api/staff, /api/admin`. Do not run an
older `C:\DentaSync\backend` or `main`-branch server alongside the new client.

The Vite development server proxies `/api` to `http://localhost:5000`. For a
separate backend deployment, set `VITE_API_URL` to that deployment's `/api`
base URL before building the client.

The patient APIs are all authenticated and scoped to the JWT patient account:

- `GET /api/patient/dashboard`
- `GET` / `POST /api/patient/appointments`
- `GET /api/patient/queue` and `POST /api/patient/queue/check-in`
- `GET /api/patient/records`
- `GET` / `PUT /api/patient/profile`
- `POST /api/patient/uploads/hmo-authorization`
- `GET /api/patient/notifications`

The portal migration creates isolated `patient_portal_*` tables, avoiding
assumptions about legacy appointment table schemas. Uploaded authorization
documents are stored under `uploads/patient-portal/`; keep that directory on
durable private storage in production and never expose it as a public static
directory.

## Amethyst Dental staff dashboard

The same React client includes a separate staff workspace at
`/staff/check-ins`. It provides patient check-in tracking, live queue updates,
appointment actions, patient search and registration, staff notifications,
profile settings, and CSV exports.

Run the staff storage migration (or the combined migration) before deploying:

```bash
npm run migrate:staff-portal
# or
npm run migrate
```

Only a live, active, verified `users.role = 'staff'` record can access
`/api/staff/*`. Each staff request verifies the authenticated account against
the database; a role supplied by frontend code or carried only in a stale token
does not grant access.

The staff APIs reuse the existing `users`, `patient_portal_appointments`,
`patient_portal_queue_entries`, `patient_portal_treatment_records`, and
`patient_portal_notifications` tables. The migration adds only:

- `staff_portal_notifications` for per-staff read/unread activity;
- `staff_portal_dentist_availability` for actual clinic-entered availability.

No example availability data is seeded. Enter real dentist schedules in
`staff_portal_dentist_availability` through your approved back-office process
before expecting them to appear in the availability modal.

## Amethyst Dental admin dashboard

The React client also includes a full administrator workspace at
`/admin/dashboard`. It covers clinic overview metrics, patient/staff/dentist
management, appointments, analytics, system settings, security/access control,
cloud synchronization/health checks, notifications, and the admin profile.

Apply the admin storage migration (or the combined migration) before deploying:

```bash
npm run migrate:admin-portal
# or
npm run migrate
npm run seed:admin
```

The seed creates or resets `admin@amethyst.com` / `admin123` as a verified admin
(without deleting other clinic data). If login returns **Invalid credentials**,
re-run `npm run seed:admin` from `C:\DentaSync-backend`, confirm it prints
`Password hash check: OK`, then restart the API and use the Vite client in
`C:\DentaSync-backend\client` (not an older separate frontend folder).
Change that password immediately after first login in any shared environment.

Only a live, active, verified `users.role = 'admin'` record can access
`/api/admin/*`. Each admin request verifies the authenticated account against
the database; a role claim from the frontend or JWT alone is not enough.

The admin APIs reuse the existing `users` and `patient_portal_*` tables. The
migration adds only:

- `admin_portal_notifications` for per-admin alerts;
- `admin_portal_settings` for clinic configuration JSON;
- `admin_portal_dentist_profiles` for specialization/schedule notes;
- `admin_portal_sync_events` for synchronization audit history.

