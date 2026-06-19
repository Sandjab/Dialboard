#pragma once
#include "dashboard.h"

void view_rebuild(Dashboard* d);
void view_sync(Dashboard* d);
void view_show_page(Dashboard* d, int idx);
// Variante animée (swipe uniquement) : glisse le conteneur entrant/sortant. delta>0 = suivant
// (sens du glissé, conditionne la direction visuelle). Repli instantané si page_count<=1 / idx==courant.
void view_show_page_anim(Dashboard* d, int idx, int delta);
const char* view_default_layout();
