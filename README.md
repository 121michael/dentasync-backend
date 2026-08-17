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
PASSWORD_RESET_URL=https://your-patient-portal.example/reset-password
```

`POST /api/auth/forgot-password` accepts an email address and always returns
the same accepted response, whether or not that address belongs to a verified
patient. For a matching patient, it sends a 30-minute, one-time reset link.
`POST /api/auth/reset-password` accepts the opaque link token and a new
password of at least 10 characters. Reset tokens are HMAC-hashed at rest,
expire server-side, and are invalidated after use or resend.

## Amethyst Dental patient portal

The responsive patient experience lives in [`client/`](./client). It includes
the dashboard, appointment booking, live queue, treatment archive, profile,
notifications, mobile navigation, and a persisted dark-mode preference.

Apply both migrations before starting the portal API:

```bash
npm run migrate
npm start
```

Then, in a second terminal:

```bash
cd client
npm install
npm run dev
```

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
