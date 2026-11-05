# ESP32 RFID check-in (Render)

The desk reader talks to the live API:

`https://dentasync-hg2x.onrender.com/api/public/rfid-check-in`

The API **fails closed**. `GET` and `POST` `/api/public/rfid-check-in` accept the device key from `X-RFID-Device-Key`, `X-Device-Key`, or a JSON `deviceKey`/`secret` field. There is no default or fallback key. If `RFID_DEVICE_SECRET` is missing, blank, or does not match, the reader is denied (`503` not configured, `403` unauthorized).

## Live key rotation (approval required)

Do not rotate production keys until this order is approved. Do not put live key values in tickets, firmware comments, or this file.

1. Generate a new device secret offline and store it in the clinic password manager.
2. Set `RFID_DEVICE_SECRET` on the API service to that value and deploy the fail-closed API.
3. Confirm an unauthorized request is denied (`403` / `503`).
4. Flash each authorized reader with `DEVICE_KEY` set to the same value as `RFID_DEVICE_SECRET`.
5. Confirm `GET /api/public/rfid-check-in` with that header returns `200` from a test reader.
6. Keep the previous secret only until every authorized device is flashed, then discard it. Do not leave a documented default in the API.

Staff RFID lookup in the portal still uses a staff session, not this device key.

## Flash steps

1. Copy `secrets.h.example` to `secrets.h` in the same folder. `secrets.h` is gitignored.
2. In `secrets.h`, set `WIFI_SSID` / `WIFI_PASSWORD` (2.4 GHz only).
3. Keep `SERVER_HOST` in the sketch as `dentasync-hg2x.onrender.com` unless the API host changed.
4. Set `DEVICE_KEY` in `secrets.h` to the same value as `RFID_DEVICE_SECRET` on the API service. Do not commit that file.
5. Flash the sketch (ESP32 Dev Module, 115200 baud).
6. Serial should show `Render RFID connected. Tap a patient card.`
7. Admin must assign that card UID under RFID Tags.

The reader does not need a staff password. Staff Check-In shows the same success panel as a QR scan.
