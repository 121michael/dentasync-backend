# ESP32 RFID check-in + buzzer/LED

## Feedback

| Result | Sound | Light |
|--------|--------|--------|
| First successful check-in / queue | **1 beep** | **1 blink** |
| Already checked in today | **2 beeps** | **2 blinks** |
| WiFi / login / check-in failed | 3 short beeps | 3 fast blinks |

## Default pins

| Device | ESP32 GPIO |
|--------|------------|
| MFRC522 RST | 22 |
| MFRC522 SDA/SS | 21 |
| Buzzer signal | **25** |
| LED (+ via 220Ω) | **26** |

Change `BUZZER_PIN` / `LED_PIN` in the sketch if your wiring differs.

If the buzzer is always on, set `#define BUZZER_ACTIVE_HIGH false`.

## Flash

1. Arduino IDE → open `esp32-rfid-checkin.ino`
2. Edit WiFi / server / staff password if needed
3. Board: **ESP32 Dev Module**, Serial **115200**
4. Upload, then tap a card
