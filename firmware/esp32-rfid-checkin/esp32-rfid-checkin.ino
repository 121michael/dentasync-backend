/**
 * DentaSync ESP32 + MFRC522 RFID check-in
 * with buzzer + LED feedback
 *
 * Feedback:
 *   First check-in / queue OK  -> 1 beep + 1 blink
 *   Already checked in         -> 2 beeps + 2 blinks
 *   Failure (WiFi/login/API)   -> 3 short beeps + 3 fast blinks
 *
 * Libraries: MFRC522
 * Board: ESP32 Dev Module, Serial 115200
 * ESP32 is 2.4 GHz WiFi only.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

// ========= EDIT THESE =========
#define WIFI_SSID       "GFiber_B5669"
#define WIFI_PASSWORD   "4023BB62"

#define SERVER_HOST     "192.168.254.102"
#define SERVER_PORT     5000

#define STAFF_EMAIL     "staff@amethyst.com"
#define STAFF_PASSWORD  "StaffPass123!"

// MFRC522 pins
#define RST_PIN  22
#define SS_PIN   21

// Feedback pins (change if your wiring differs)
// Active buzzer: signal pin -> BUZZER_PIN, other side -> GND
// LED: anode -> LED_PIN (via 220 ohm resistor), cathode -> GND
#define BUZZER_PIN  25
#define LED_PIN     26
#define BUZZER_ACTIVE_HIGH  true
// ==============================

enum CheckInResult {
  CHECKIN_NEW_OK = 0,
  CHECKIN_ALREADY = 1,
  CHECKIN_FAILED = 2
};

MFRC522 mfrc522(SS_PIN, RST_PIN);

String authToken;
unsigned long tokenExpiresAtMs = 0;
bool wifiBusy = false;

void setBuzzer(bool on) {
  digitalWrite(BUZZER_PIN, (on == BUZZER_ACTIVE_HIGH) ? HIGH : LOW);
}

void setLed(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

void beepBlink(int times, int onMs, int offMs) {
  for (int i = 0; i < times; i++) {
    setBuzzer(true);
    setLed(true);
    delay(onMs);
    setBuzzer(false);
    setLed(false);
    if (i + 1 < times) {
      delay(offMs);
    }
  }
}

void signalNewCheckIn() {
  // 1 beep + 1 blink — first successful queue/check-in
  beepBlink(1, 180, 120);
}

void signalAlreadyCheckedIn() {
  // 2 beeps + 2 blinks — patient already in queue today
  beepBlink(2, 160, 140);
}

void signalFailure() {
  // 3 short beeps/blinks — WiFi, login, or check-in failed
  beepBlink(3, 80, 80);
}

String statusName(wl_status_t s) {
  switch (s) {
    case WL_IDLE_STATUS:     return "IDLE";
    case WL_NO_SSID_AVAIL:   return "NO_SSID";
    case WL_SCAN_COMPLETED:  return "SCAN_DONE";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "CONN_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED";
    default:                 return String((int)s);
  }
}

String serverBase() {
  return String("http://") + SERVER_HOST + ":" + String(SERVER_PORT);
}

void scanNearbyWifi() {
  Serial.println();
  Serial.println("Scanning 2.4 GHz networks (ESP32 cannot see 5 GHz)...");
  int n = WiFi.scanNetworks(false, true);
  if (n <= 0) {
    Serial.println("  (no networks found)");
    return;
  }
  bool sawTarget = false;
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid == WIFI_SSID) sawTarget = true;
    Serial.printf("  %2d) %s  RSSI=%d  ch=%d  %s\n",
                  i + 1, ssid.c_str(), WiFi.RSSI(i), WiFi.channel(i),
                  (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "open" : "secured");
  }
  if (sawTarget) {
    Serial.printf("Target SSID \"%s\" is visible on 2.4 GHz.\n", WIFI_SSID);
  } else {
    Serial.printf("WARNING: \"%s\" NOT in scan. Wrong name, out of range, or 5 GHz-only.\n", WIFI_SSID);
  }
  WiFi.scanDelete();
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (wifiBusy) return false;
  wifiBusy = true;

  WiFi.persistent(false);
  WiFi.disconnect(true, true);
  delay(200);
  WiFi.mode(WIFI_OFF);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  delay(100);

  Serial.printf("Connecting SSID=\"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long deadline = millis() + 25000UL;
  wl_status_t last = WL_IDLE_STATUS;
  while (millis() < deadline) {
    wl_status_t st = WiFi.status();
    if (st != last) {
      Serial.printf("  status=%s\n", statusName(st).c_str());
      last = st;
    }
    if (st == WL_CONNECTED) {
      Serial.printf("WiFi OK  ip=%s  rssi=%d\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      wifiBusy = false;
      return true;
    }
    if (st == WL_NO_SSID_AVAIL || st == WL_CONNECT_FAILED) break;
    delay(300);
    Serial.print(".");
  }

  Serial.println();
  Serial.printf("WiFi FAILED  final=%s\n", statusName(WiFi.status()).c_str());
  WiFi.disconnect(true, true);
  wifiBusy = false;
  return false;
}

String extractJsonString(const String& body, const char* key) {
  String needle = String("\"") + key + "\":\"";
  int start = body.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = body.indexOf('"', start);
  if (end < 0) return "";
  return body.substring(start, end);
}

bool ensureAuthToken() {
  if (authToken.length() > 0 && millis() < tokenExpiresAtMs) return true;

  HTTPClient http;
  String url = serverBase() + "/api/auth/login";
  if (!http.begin(url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  String body = String("{\"email\":\"") + STAFF_EMAIL +
                "\",\"password\":\"" + STAFF_PASSWORD + "\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("login HTTP %d\n", code);
  if (code != 200) {
    Serial.println(resp.substring(0, 200));
    authToken = "";
    return false;
  }

  authToken = extractJsonString(resp, "token");
  if (authToken.length() == 0) return false;
  tokenExpiresAtMs = millis() + 7UL * 60UL * 60UL * 1000UL;
  Serial.println("Staff login OK.");
  return true;
}

CheckInResult checkInRfid(const String& uid) {
  if (!ensureAuthToken()) return CHECKIN_FAILED;

  HTTPClient http;
  String url = serverBase() + "/api/staff/check-in";
  if (!http.begin(url)) return CHECKIN_FAILED;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + authToken);
  http.setTimeout(10000);

  String body = String("{\"method\":\"rfid\",\"rfidTag\":\"") + uid + "\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("check-in HTTP %d\n", code);
  Serial.println(resp.substring(0, 300));

  if (code == 401 || code == 403) {
    authToken = "";
    tokenExpiresAtMs = 0;
  }

  if (code != 200 && code != 201) {
    return CHECKIN_FAILED;
  }

  // Server returns 200 + "already checked in" when patient is already in today's queue.
  String lower = resp;
  lower.toLowerCase();
  if (lower.indexOf("already checked in") >= 0) {
    return CHECKIN_ALREADY;
  }
  return CHECKIN_NEW_OK;
}

String readCardUid() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) return "";
  String uid;
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  return uid;
}

void setup() {
  Serial.begin(115200);
  delay(800);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  setBuzzer(false);
  setLed(false);

  Serial.println("DentaSync RFID check-in + buzzer/LED");
  Serial.printf("Server %s:%d\n", SERVER_HOST, SERVER_PORT);
  Serial.printf("Buzzer pin %d  LED pin %d\n", BUZZER_PIN, LED_PIN);

  SPI.begin();
  mfrc522.PCD_Init();

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  scanNearbyWifi();

  if (!connectWifi()) {
    Serial.println("Boot WiFi failed — will retry on each card tap.");
    signalFailure();
  } else if (!ensureAuthToken()) {
    Serial.println("Boot login failed — will retry on each card tap.");
    signalFailure();
  } else {
    Serial.println("Ready. Tap a patient RFID card.");
    signalNewCheckIn(); // short ready chirp
  }
}

void loop() {
  String uid = readCardUid();
  if (uid.length() == 0) {
    delay(50);
    return;
  }

  Serial.printf("\nCard UID: %s\n", uid.c_str());

  if (!connectWifi()) {
    Serial.println("WiFi/login failed. Will retry on tap.");
    signalFailure();
    delay(1200);
    return;
  }

  CheckInResult result = checkInRfid(uid);
  if (result == CHECKIN_NEW_OK) {
    Serial.println("CHECK-IN OK (new)");
    signalNewCheckIn();
  } else if (result == CHECKIN_ALREADY) {
    Serial.println("ALREADY CHECKED IN");
    signalAlreadyCheckedIn();
  } else {
    Serial.println("CHECK-IN FAILED");
    signalFailure();
  }

  delay(1500);
}
