#pragma once
#include <stdint.h>
#include "dashboard.h"

uint32_t parse_hex_color(const char* s, uint32_t fallback);
uint32_t threshold_color(const Threshold* t, int n, float value, uint32_t base);
// led : allume si value >= off_below (sinon eteint). Pur, miroir designer ledLit.
bool led_is_lit(int32_t value, int32_t off_below);
// icon : resout (glyphe, couleur) pour une valeur. 1re bande ou value < at ; champ omis -> base.
// Miroir de threshold_color ; sans LVGL (testable en natif). symbol = index dans ICON_GLYPHS (view.cpp).
void icon_resolve(const IconState* st, int n, float value, uint16_t base_sym, uint32_t base_col,
                  uint16_t* out_sym, uint32_t* out_col);
// state : resout l'index du cas actif pour une valeur (miroir designer resolveState). -1 = defaut.
// exact : compare selon le type de la valeur (has_num -> key_num ; sinon key_str). range : num seul, 1er num < at.
// Pure, sans LVGL (testable en natif).
int state_resolve(uint8_t match, const StateCase* cases, int n, bool has_num, double num, const char* str);
