/**
 * DentaSync ESP32 + MFRC522 RFID check-in
 *
 * Flow per tap:
 *   1) Read card UID (uppercase hex, no colons)
 *   2) Ensure WiFi (STA reset before begin — fixes "sta is connecting, cannot set config")
 *   3) Staff login -> JWT
 *   4) POST /api/staff/check-in with method=rfid
 *
 * Libraries (Arduino Library Manager):
 *   - MFRC522 by GithubCommunity
 *   - ArduinoJson by Benoit Blanchon (optional; sketch parses token without it)
 *
 * Board: ESP32 Dev Module, 115200 baud.
 * ESP32 is 2.4 GHz ONLY. Use a 2.4 GHz SSID or phone hotspot — not 5 GHz-only WiFi.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

// ========= EDIT THESE =========
#define WIFI_SSID       "YOUR_2_4GHZ_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

#define SERVER_HOST     "192.168.254.102"   // PC running DentaSync backend
#define SERVER_PORT     5000               // backend port (NOT Vite 5173)

#define STAFF_EMAIL     "staff@amethyst.com"
#define STAFF_PASSWORD  "YOUR_STAFF_PASSWORD"

// MFRC522 pins (change if your wiring differs)
#define RST_PIN  22
#define SS_PIN   21
// ==============================

MFRC522 mfrc522(SS_PIN, RST_PIN);

String authToken;
unsigned long tokenExpiresAtMs = 0;
bool wifiBusy = false;

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
  int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/true);
  if (n <= 0) {
    Serial.println("  (no networks found)");
    return;
  }
  bool sawTarget = false;
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid == WIFI_SSID) sawTarget = true;
    Serial.printf("  %2d) %s  RSSI=%d  ch=%d  %s\n",
                  i + 1,
                  ssid.c_str(),
                  WiFi.RSSI(i),
                  WiFi.channel(i),
                  (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "open" : "secured");
  }
  if (sawTarget) {
    Serial.printf("Target SSID \"%s\" is visible on 2.4 GHz.\n", WIFI_SSID);
  } else {
    Serial.printf("WARNING: \"%s\" NOT in scan. Wrong name, out of range, or 5 GHz-only.\n", WIFI_SSID);
    Serial.println("Fix: create a 2.4 GHz SSID / disable band steering, or use a phone hotspot.");
  }
  WiFi.scanDelete();
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  if (wifiBusy) {
    Serial.println("WiFi connect already in progress.");
    return false;
  }
  wifiBusy = true;

  // Hard reset STA so begin() is never called while "sta is connecting".
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
                    WiFi.localIP().toString().c_str(),
                    WiFi.RSSI());
      wifiBusy = false;
      return true;
    }
    if (st == WL_NO_SSID_AVAIL || st == WL_CONNECT_FAILED) {
      break;
    }
    delay(300);
    Serial.print(".");
  }

  Serial.println();
  Serial.printf("WiFi FAILED  final=%s\n", statusName(WiFi.status()).c_str());
  if (WiFi.status() == WL_NO_SSID_AVAIL) {
    Serial.println("Hint: SSID not found on 2.4 GHz. Try phone hotspot or router 2.4 SSID.");
  } else if (WiFi.status() == WL_CONNECT_FAILED) {
    Serial.println("Hint: wrong password, or router rejected the client.");
  }
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
  if (authToken.length() > 0 && millis() < tokenExpiresAtMs) {
    return true;
  }

  HTTPClient http;
  String url = serverBase() + "/api/auth/login";
  Serial.printf("POST %s\n", url.c_str());
  if (!http.begin(url)) {
    Serial.println("HTTP begin failed (login).");
    return false;
  }
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
  if (authToken.length() == 0) {
    Serial.println("Login OK but token missing in response.");
    return false;
  }
  // Refresh a bit before the server's 8h expiry.
  tokenExpiresAtMs = millis() + 7UL * 60UL * 60UL * 1000UL;
  Serial.println("Staff login OK.");
  return true;
}

bool checkInRfid(const String& uid) {
  if (!ensureAuthToken()) {
    return false;
  }

  HTTPClient http;
  String url = serverBase() + "/api/staff/check-in";
  Serial.printf("POST %s  uid=%s\n", url.c_str(), uid.c_str());
  if (!http.begin(url)) {
    Serial.println("HTTP begin failed (check-in).");
    return false;
  }
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
  return code == 200 || code == 201;
}

String readCardUid() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return "";
  }
  String uid;
  uid.reserve(mfrc522.uid.size * 2);
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
  Serial.println();
  Serial.println("DentaSync RFID check-in");
  Serial.printf("Server %s:%d\n", SERVER_HOST, SERVER_PORT);

  SPI.begin();
  mfrc522.PCD_Init();

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  scanNearbyWifi();

  if (!connectWifi()) {
    Serial.println("Boot WiFi failed — will retry on each card tap.");
  } else if (!ensureAuthToken()) {
    Serial.println("Boot login failed — will retry on each card tap.");
  } else {
    Serial.println("Ready. Tap a patient RFID card.");
  }
}

void loop() {
  String uid = readCardUid();
  if (uid.length() == 0) {
    delay(50);
    return;
  }

  Serial.println();
  Serial.printf("Card UID: %s\n", uid.c_str());

  if (!connectWifi()) {
    Serial.println("WiFi/login failed. Will retry on tap.");
    delay(1200);
    return;
  }

  if (!checkInRfid(uid)) {
    Serial.println("CHECK-IN FAILED");
  } else {
    Serial.println("CHECK-IN OK");
  }

  delay(1500);
}
