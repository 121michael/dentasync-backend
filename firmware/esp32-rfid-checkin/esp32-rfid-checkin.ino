/**
 * DentaSync ESP32 + MFRC522 RFID check-in (live HTTPS)
 *
 * POST https://SERVER_HOST/api/public/rfid-check-in
 * Header: X-RFID-Device-Key: DEVICE_KEY  (same as Render RFID_DEVICE_SECRET)
 *
 * Libraries: MFRC522, WiFi, HTTPClient, WiFiClientSecure
 * Board: ESP32 Dev Module, 115200 baud. 2.4 GHz WiFi only.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

#define WIFI_SSID        "YOUR_2_4GHZ_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#define SERVER_HOST      "dentasync-hg2x.onrender.com"
#define DEVICE_KEY       "YOUR_RFID_DEVICE_SECRET"
#define RST_PIN          22
#define SS_PIN           21

MFRC522 mfrc522(SS_PIN, RST_PIN);

String serverUrl() {
  return String("https://") + SERVER_HOST + "/api/public/rfid-check-in";
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const unsigned long deadline = millis() + 25000UL;
  while (millis() < deadline) {
    if (WiFi.status() == WL_CONNECTED) return true;
    delay(300);
  }
  return false;
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
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, serverUrl())) {
    Serial.println("HTTP begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-RFID-Device-Key", DEVICE_KEY);
  http.setTimeout(15000);
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
  Serial.printf("Card UID: %s\n", uid.c_str());
  if (!connectWifi() || !checkInRfid(uid)) {
    Serial.println("CHECK-IN FAILED");
  } else {
    Serial.println("CHECK-IN OK");
  }
  delay(1500);
}
