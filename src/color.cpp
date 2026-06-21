#include "color.h"
#include <stdlib.h>

uint32_t parse_hex_color(const char* s, uint32_t fallback) {
    if (!s) return fallback;
    if (*s == '#') s++;
    char* end = nullptr;
    unsigned long v = strtoul(s, &end, 16);
    if (end == s || *end != '\0') return fallback;
    return (uint32_t)(v & 0xFFFFFF);
}

uint32_t threshold_color(const Threshold* t, int n, float value, uint32_t base) {
    for (int i = 0; i < n; i++)
        if (value < t[i].limit) return t[i].color;
    return base;
}

bool led_is_lit(int32_t value, int32_t off_below) {
    return value >= off_below;
}
