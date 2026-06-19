#pragma once
#include <stddef.h>
#include <stdint.h>

void format_remaining(uint32_t seconds, char* out, size_t n);
void format_value(double v, const char* unit, char* out, size_t n);
