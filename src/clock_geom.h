#pragma once
#include <stddef.h>

// Angles en degrés horaires depuis 12h (0=haut). Pures, sans LVGL.
void clock_hand_angles(int h, int m, int s, float* deg_h, float* deg_m, float* deg_s);
// "HH:MM" ou "HH:MM:SS" si with_seconds. Zéro-paddé.
void clock_format_digital(int h, int m, int s, bool with_seconds, char* out, size_t n);
