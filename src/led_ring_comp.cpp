#include "led_ring_comp.h"
#include "rgb_ring.h"
#include <math.h>

Adafruit_NeoPixel rgb_ring(RGB_RING_LED_COUNT, PIN_RGB_DATA, NEO_GRB + NEO_KHZ800);

void led_ring_begin() { rgb_ring_init(64); }

static void rgb_from_hex(uint32_t hex, uint8_t& r, uint8_t& g, uint8_t& b) {
    r = (hex >> 16) & 0xFF; g = (hex >> 8) & 0xFF; b = hex & 0xFF;
}

void led_ring_tick(Dashboard* d, uint32_t now_ms) {
    int idx = -1;
    for (int i = 0; i < d->comp_count; i++)
        if (d->components[i].type == COMP_LED_RING) { idx = i; break; }
    if (idx < 0) return;
    Component& c = d->components[idx];
    rgb_ring.setBrightness(c.led_brightness ? c.led_brightness : 64);
    uint8_t r, g, b; rgb_from_hex(c.led_color ? c.led_color : 0xFFFFFF, r, g, b);
    const int N = RGB_RING_LED_COUNT;
    uint16_t period = c.led_period_ms ? c.led_period_ms : 1000;

    switch (c.led_mode) {
        case LED_OFF: rgb_ring_clear(); break;
        case LED_SOLID: rgb_ring_set_all(r, g, b); break;
        case LED_PROGRESS: {
            int lit = (c.led_value * N + 50) / 100;
            for (int i = 0; i < N; i++)
                if (i < lit) rgb_ring_set(i, r, g, b); else rgb_ring_set(i, 0, 0, 0);
            break;
        }
        case LED_SPINNER: {
            int head = (now_ms / (period / N ? period / N : 1)) % N;
            for (int i = 0; i < N; i++) rgb_ring_set(i, 0, 0, 0);
            rgb_ring_set(head, r, g, b);
            break;
        }
        case LED_BLINK: {
            bool on = (now_ms % period) < (period / 2);
            if (on) rgb_ring_set_all(r, g, b); else rgb_ring_clear();
            break;
        }
        case LED_BREATHE: {
            float ph = (now_ms % period) / (float)period;
            float k  = 0.5f * (1.0f - cosf(ph * 6.2831853f));
            rgb_ring_set_all((uint8_t)(r*k), (uint8_t)(g*k), (uint8_t)(b*k));
            break;
        }
    }
    rgb_ring_show();
}
