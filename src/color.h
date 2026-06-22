#pragma once
#include <stdint.h>
#include "dashboard.h"

uint32_t parse_hex_color(const char* s, uint32_t fallback);
uint32_t threshold_color(const Threshold* t, int n, float value, uint32_t base);
// led : allume si value >= off_below (sinon eteint). Pur, miroir designer ledLit.
bool led_is_lit(int32_t value, int32_t off_below);
// icon : resout (glyphe, couleur) pour une valeur. 1re bande ou value < at ; champ omis -> base.
// Miroir de threshold_color ; sans LVGL (testable en natif). symbol = index dans ICON_GLYPHS (view.cpp).
void icon_resolve(const IconState* st, int n, float value, uint8_t base_sym, uint32_t base_col,
                  uint8_t* out_sym, uint32_t* out_col);
