#pragma once
#include <stdint.h>
#include "dashboard.h"

uint32_t parse_hex_color(const char* s, uint32_t fallback);
uint32_t threshold_color(const Threshold* t, int n, float value, uint32_t base);
