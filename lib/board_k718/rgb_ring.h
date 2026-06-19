#pragma once

#include <Adafruit_NeoPixel.h>
#include "guition_pins.h"

// RGB ring helpers (13 × WS2812 GRB on PIN_RGB_DATA = GPIO 0).
//
// Header-only on purpose: only projects that #include this file pull in the
// Adafruit_NeoPixel dependency, so Basic_Blink (and other ring-less projects)
// don't need to declare lib_deps for NeoPixel.
//
// Usage in your sketch :
//   #include "rgb_ring.h"
//   Adafruit_NeoPixel rgb_ring(RGB_RING_LED_COUNT, PIN_RGB_DATA, NEO_GRB + NEO_KHZ800);
//
//   void setup() { rgb_ring_init(32); }
//   void loop()  { rgb_ring_set_hsv(0, 30000); rgb_ring_show(); }
//
// Add to your project's platformio.ini :
//   lib_deps = adafruit/Adafruit NeoPixel

extern Adafruit_NeoPixel rgb_ring;

// Initialize the ring: begin, set brightness (default 64/255 to stay well under
// the USB 500 mA budget — 13 LEDs at full white ≈ 780 mA), clear, show.
static inline void rgb_ring_init(uint8_t brightness = 64) {
    rgb_ring.begin();
    rgb_ring.setBrightness(brightness);
    rgb_ring.clear();
    rgb_ring.show();
}

// Set one pixel by RGB (0-255 each). No show() until you call rgb_ring_show().
static inline void rgb_ring_set(uint8_t idx, uint8_t r, uint8_t g, uint8_t b) {
    rgb_ring.setPixelColor(idx, r, g, b);
}

// Set one pixel by HSV. hue: 0-65535 (full wheel), sat/val: 0-255.
static inline void rgb_ring_set_hsv(uint8_t idx, uint16_t hue,
                                    uint8_t sat = 255, uint8_t val = 255) {
    rgb_ring.setPixelColor(idx, Adafruit_NeoPixel::ColorHSV(hue, sat, val));
}

// Paint every pixel the same RGB.
static inline void rgb_ring_set_all(uint8_t r, uint8_t g, uint8_t b) {
    for (uint8_t i = 0; i < RGB_RING_LED_COUNT; i++) {
        rgb_ring.setPixelColor(i, r, g, b);
    }
}

// Clear the framebuffer (does not call show()).
static inline void rgb_ring_clear() {
    rgb_ring.clear();
}

// Push the framebuffer out to the LEDs.
static inline void rgb_ring_show() {
    rgb_ring.show();
}
