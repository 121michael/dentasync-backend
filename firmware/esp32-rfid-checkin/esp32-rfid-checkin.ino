/**
 * DentaSync ESP32 + MFRC522 RFID check-in (live Render HTTPS)
 *
 * GET/POST https://SERVER_HOST/api/public/rfid-check-in
 * Header: X-RFID-Device-Key: DEVICE_KEY
 *
 * Libraries: MFRC522, WiFi, HTTPClient, WiFiClientSecure
 * Board: ESP32 Dev Module, 115200 baud. 2.4 GHz WiFi only.
 *
 * Wiring (RC522):
 *   SDA/SS -> GPIO 5   (try GPIO 21 if cards do not read)
 *   RST    -> GPIO 22
 *   MOSI   -> GPIO 23
 *   MISO   -> GPIO 19
 *   SCK    -> GPIO 18
 *   3.3V / GND
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

#define WIFI_SSID        "YOUR_2_4GHZ_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#define SERVER_HOST      "dentasync-hg2x.onrender.com"
#define DEVICE_KEY       "dentasync-esp32-desk"
#define RST_PIN          22
#define SS_PIN           5

MFRC522 mfrc522(SS_PIN, RST_PIN);
bool wifiBusy = false;

String serverUrl() {
  return String("https://") + SERVER_HOST + "/api/public/rfid-check-in";
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

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (wifiBusy) {
    Serial.println("WiFi connect already in progress.");
    return false;
  }
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
  WiFi.disconnect(true, true);
  wifiBusy = false;
  return false;
}

bool beginRfidHttp(HTTPClient& http, WiFiClientSecure& client) {
  client.setInsecure();
  if (!http.begin(client, serverUrl())) {
    Serial.println("HTTP begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-RFID-Device-Key", DEVICE_KEY);
  http.setTimeout(15000);
  return true;
}

bool handshakeRender() {
  WiFiClientSecure client;
  HTTPClient http;
  if (!beginRfidHttp(http, client)) return false;
  int code = http.GET();
  String resp = http.getString();
  http.end();
  Serial.printf("Render handshake HTTP %d\n", code);
  Serial.println(resp.substring(0, 300));
  return code == 200;
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

bool checkInRfid(const String& uid) {
  WiFiClientSecure client;
  HTTPClient http;
  if (!beginRfidHttp(http, client)) return false;
  String body = String("{\"rfidTag\":\"") + uid + "\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("check-in HTTP %d\n", code);
  Serial.println(resp.substring(0, 300));
  return code == 200 || code == 201;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  SPI.begin();
  mfrc522.PCD_Init();
  if (!connectWifi()) {
    Serial.println("WiFi failed — will retry on tap.");
    return;
  }
  if (handshakeRender()) {
    Serial.println("Render RFID connected. Tap a patient card.");
  } else {
    Serial.println("Render RFID handshake failed. Redeploy the API, then reset the ESP32.");
  }
}

void loop() {
  String uid = readCardUid();
  if (uid.length() == 0) {
    delay(50);
    return;
  }
  Serial.printf("Card UID: %s\n", uid.c_str());
  if (!connectWifi() || !checkInRfid(uid)) {
    Serial.println("CHECK-IN FAILED");
  } else {
    Serial.println("CHECK-IN OK");
  }
  delay(1500);
}
