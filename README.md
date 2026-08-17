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

The server records privacy-safe OTP audit events containing the request ID,
hashed account fingerprint, timestamps, lookup outcome, expiry state, and
match outcome. It never logs the OTP itself.
