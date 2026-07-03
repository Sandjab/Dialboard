#include "clock_geom.h"
#include <stdio.h>

void clock_hand_angles(int h, int m, int s, float* deg_h, float* deg_m, float* deg_s) {
    float mm = m + s / 60.0f;
    float hh = (h % 12) + mm / 60.0f;
    if (deg_h) *deg_h = hh * 30.0f;
    if (deg_m) *deg_m = mm * 6.0f;
    if (deg_s) *deg_s = s * 6.0f;
}

void clock_format_digital(int h, int m, int s, bool with_seconds, char* out, size_t n) {
    if (with_seconds) snprintf(out, n, "%02d:%02d:%02d", h, m, s);
    else              snprintf(out, n, "%02d:%02d", h, m);
}
