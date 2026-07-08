#include "color.h"
#include <stdlib.h>
#include <string.h>

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

void icon_resolve(const IconState* st, int n, float value, uint16_t base_sym, uint32_t base_col,
                  uint16_t* out_sym, uint32_t* out_col) {
    uint16_t sym = base_sym; uint32_t col = base_col;
    for (int i = 0; i < n; i++) {
        if (value < st[i].at) {
            if (st[i].has_symbol) sym = st[i].symbol;
            if (st[i].has_color)  col = st[i].color;
            break;
        }
    }
    *out_sym = sym; *out_col = col;
}

int state_resolve(uint8_t match, const StateCase* cases, int n, bool has_num, double num, const char* str) {
    if (match == STATE_RANGE) {
        if (!has_num) return -1;                             // range = numerique seul ; string -> defaut
        for (int i = 0; i < n; i++) if (num < cases[i].at) return i;
        return -1;
    }
    for (int i = 0; i < n; i++) {                            // exact : 1er match selon le type de la valeur
        if (has_num) { if (cases[i].has_num_key && cases[i].key_num == num) return i; }
        else         { if (!cases[i].has_num_key && strcmp(cases[i].key_str, str) == 0) return i; }
    }
    return -1;
}
