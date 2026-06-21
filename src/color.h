#pragma once
#include <stdint.h>
#include "dashboard.h"

uint32_t parse_hex_color(const char* s, uint32_t fallback);
uint32_t threshold_color(const Threshold* t, int n, float value, uint32_t base);
// led : allume si value >= off_below (sinon eteint). Pur, miroir designer ledLit.
bool led_is_lit(int32_t value, int32_t off_below);
