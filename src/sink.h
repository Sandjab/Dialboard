#pragma once
#include <stdint.h>
#include <stddef.h>
#include "context.h"

// Débounce de traîne : vrai si armé (pending_since != 0) ET au moins debounce_ms écoulé depuis.
bool sink_should_fire(uint32_t pending_since, uint32_t now, uint32_t debounce_ms);
