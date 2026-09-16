# ESP32 RFID check-in (DentaSync)

Firmware for **ESP32 + MFRC522** that taps a patient card and calls:

1. `POST /api/auth/login` (staff account)
2. `POST /api/staff/check-in` with `{ "method": "rfid", "rfidTag": "<UID>" }`

## Why you saw `sta is connecting, cannot set config`

The ESP32 STA stack was still connecting when `WiFi.begin()` ran again (common after a failed attempt or saved credentials). This sketch:

- turns WiFi off, clears saved STA config, then connects once
- prints `status=NO_SSID` / `CONNECT_FAILED` / `CONNECTED` so the failure is unambiguous
- scans 2.4 GHz networks at boot (ESP32 **cannot** join 5 GHz)

## Flash steps

1. Arduino IDE → Board: **ESP32 Dev Module**, Serial: **115200**
2. Install libraries: **MFRC522**, (optional) **ArduinoJson**
3. Open `esp32-rfid-checkin.ino` and set:

| Define | Value |
|--------|--------|
| `WIFI_SSID` / `WIFI_PASSWORD` | **2.4 GHz** network (or phone hotspot) |
| `SERVER_HOST` | PC LAN IP running the backend (e.g. `192.168.254.102`) |
| `SERVER_PORT` | `5000` (backend) — **not** Vite `5173` |
| `STAFF_EMAIL` / `STAFF_PASSWORD` | Staff login used for check-in |
| `RST_PIN` / `SS_PIN` | Match your MFRC522 wiring (default 22 / 21) |

4. Upload, open Serial Monitor, power-cycle the board
5. Read the boot scan:
   - Target SSID listed → password / router ACL issue if still failing
   - Target SSID **missing** → network is 5 GHz-only or wrong name → use phone hotspot or a separate 2.4 GHz SSID

## After WiFi works

Assign the printed UID (e.g. `1152D406`) to a **patient** in Admin → RFID tag. Staff check-in looks up `users.rfid_tag` for role `patient`.

Backend must be reachable on the same LAN: `http://SERVER_HOST:5000/api/auth/login`.

## Serial cheat sheet

| Line | Meaning |
|------|---------|
| `status=NO_SSID` | SSID not visible on 2.4 GHz |
| `status=CONNECT_FAILED` | Wrong password or router rejected ESP32 |
| `status=CONNECTED` + `ip=...` | WiFi OK |
| `login HTTP 401` | Bad staff email/password |
| `check-in HTTP 404` + RFID not recognized | Assign UID to patient in Admin |
| `CHECK-IN OK` | Patient queued |
