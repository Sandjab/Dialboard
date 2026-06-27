#pragma once
#include <lvgl.h>
#include <stdint.h>
#include "dashboard.h"   // FontFamily

// Renvoie une fonte Tiny TTF pour (famille, taille px, gras, italique).
// Crée à la demande et met en cache (réutilisation par combinaison). Jamais nullptr
// (repli Montserrat bitmap si la création échoue ou le cache déborde).
const lv_font_t* get_font(uint8_t family, uint16_t px, bool bold, bool italic);
