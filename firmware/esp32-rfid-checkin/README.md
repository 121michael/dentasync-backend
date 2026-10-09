# ESP32 RFID check-in (live)

The desk reader posts card UIDs to the public RFID endpoint. Staff Check-In then shows the same success panel used for QR scans.

1. Set `RFID_DEVICE_SECRET` on the Render API service (`dentasync`).
2. Put that same value in `DEVICE_KEY` in `esp32-rfid-checkin.ino`.
3. Set `WIFI_SSID` / `WIFI_PASSWORD` (2.4 GHz).
4. Keep `SERVER_HOST` as `dentasync-hg2x.onrender.com` unless the API URL changed.
5. Flash the sketch, tap a card that Admin assigned under RFID Tags.

The reader does not need a staff password.
