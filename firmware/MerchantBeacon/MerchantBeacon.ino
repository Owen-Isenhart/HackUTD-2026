#include <Arduino.h>
#include <BLEDevice.h>

// Flash 1 for Starbucks, 2 for Walmart, and 3 for the gas station.
constexpr uint16_t MERCHANT_MINOR = 1;
constexpr uint16_t MERCHANT_MAJOR = 1;
constexpr int8_t MEASURED_POWER = -59;  // Starting estimate at one meter.

void setup() {
  Serial.begin(115200);
  BLEDevice::init("");

  // iBeacon manufacturer data with the UUID in network byte order.
  const uint8_t payload[] = {
    0x4C, 0x00, 0x02, 0x15,
    0xF3, 0xA0, 0x47, 0x81, 0xEE, 0x0C, 0x4C, 0xB6,
    0x9B, 0x7F, 0x8F, 0xCD, 0x0F, 0x06, 0xA5, 0x93,
    highByte(MERCHANT_MAJOR), lowByte(MERCHANT_MAJOR),
    highByte(MERCHANT_MINOR), lowByte(MERCHANT_MINOR),
    static_cast<uint8_t>(MEASURED_POWER)
  };

  BLEAdvertisementData packet;
  packet.setFlags(0x04);
  packet.setManufacturerData(String(reinterpret_cast<const char *>(payload), sizeof(payload)));

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->setAdvertisementType(ADV_TYPE_NONCONN_IND);
  advertising->setAdvertisementData(packet);
  advertising->start();
  Serial.printf("Merchant iBeacon minor %u is advertising\n", static_cast<unsigned>(MERCHANT_MINOR));
}

void loop() {
  delay(1000);
}
