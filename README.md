# DentaSync backend

## OTP verification setup

Apply the OTP storage migration before deploying this version:

```bash
npm run migrate:otp
```

That creates `otp_verification_requests` and adds failed-attempt lockout columns.
It does not reuse the legacy `otps` table, so an unverified account with a code
issued by an earlier release must request a new code after deployment.

Set `OTP_SECRET` to a high-entropy server secret in production. It is used to
HMAC verification codes before storing them.

Local SMTP delivery needs `EMAIL_USER` and `EMAIL_PASS`. Render Free blocks
outbound SMTP, so production should set `GMAIL_APPS_SCRIPT_URL` and
`GMAIL_APPS_SCRIPT_SECRET` instead.

```bash
npm start
```

`GET /api/auth/otp-mail-status` reports whether SMTP or the HTTPS relay is
configured. Add `?sendTest=1` to send a test message to `EMAIL_USER` through
the Apps Script relay.

## Patient OTP API contract

1. `POST /api/auth/register` with a patient’s `firstName`, `lastName`, `email`,
   `phone`, and `password`. The account is created unverified. The response
   contains `requestId` and `expiresAt`; it does not contain a token.
2. Persist the returned `requestId` in the verification page state so a page
   refresh uses the same request.
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
and returns a new `requestId`.

For compatibility with an existing verification page, `POST /api/auth/verify-otp`
also accepts `{ "phone": "...", "otp": "012345" }` when `requestId` is absent.
The server normalizes the phone and resolves only its newest active request.

Wrong codes count toward a 3-attempt lockout (5 minutes). Expiry is computed
with PostgreSQL `CURRENT_TIMESTAMP`, not the Node process clock.

The server records privacy-safe OTP audit events containing the request ID,
hashed account fingerprint, timestamps, lookup outcome, expiry state, and
match outcome. It never logs the OTP itself.
