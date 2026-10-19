# ESP32 RFID check-in (Render)

The desk reader talks to the live API:

`https://dentasync-hg2x.onrender.com/api/public/rfid-check-in`

1. In `esp32-rfid-checkin.ino`, set `WIFI_SSID` / `WIFI_PASSWORD` (2.4 GHz only).
2. Keep `SERVER_HOST` as `dentasync-hg2x.onrender.com`.
3. Keep `DEVICE_KEY` as `dentasync-esp32-desk` unless you set a different `RFID_DEVICE_SECRET` on the Render API service.
4. Flash the sketch (ESP32 Dev Module, 115200 baud).
5. Serial should show `Render RFID connected. Tap a patient card.`
6. Admin must assign that card UID under RFID Tags.

The reader does not need a staff password. Staff Check-In shows the same success panel as a QR scan.
