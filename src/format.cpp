#include "format.h"
#include <stdio.h>
#include <string.h>

void format_remaining(uint32_t s, char* out, size_t n) {
    if (s >= 86400) {
        snprintf(out, n, "%luj%luh", (unsigned long)(s / 86400),
                 (unsigned long)((s % 86400) / 3600));
    } else if (s >= 3600) {
        snprintf(out, n, "%luh%02lu", (unsigned long)(s / 3600),
                 (unsigned long)((s % 3600) / 60));
    } else if (s >= 60) {
        snprintf(out, n, "%lum", (unsigned long)(s / 60));
    } else {
        snprintf(out, n, "%lus", (unsigned long)s);
    }
}

void format_value(double v, const char* unit, char* out, size_t n) {
    char num[24];
    if (v == (long long)v) snprintf(num, sizeof(num), "%lld", (long long)v);
    else                   snprintf(num, sizeof(num), "%.1f", v);
    if (unit && unit[0]) snprintf(out, n, "%s %s", num, unit);
    else                 snprintf(out, n, "%s", num);
}
