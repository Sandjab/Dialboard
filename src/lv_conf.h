#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH         16

#define LV_MEM_SIZE            (48U * 1024U)

// Polices utilisees par l'UI telemetry (14 = footer, 20 = lignes, 28 = titre, 36/48 = grosse lecture centrale)
#define LV_FONT_MONTSERRAT_14  1
#define LV_FONT_MONTSERRAT_20  1
#define LV_FONT_MONTSERRAT_28  1
#define LV_FONT_MONTSERRAT_36  1
#define LV_FONT_MONTSERRAT_48  1

// Widgets "extra" utilises par chart/jauge
#define LV_USE_CHART           1
#define LV_USE_SCALE           1
#define LV_USE_ARCLABEL        1

// Capture d'ecran a la demande (endpoint GET /screenshot) : re-render off-screen via lv_snapshot
#define LV_USE_SNAPSHOT        1

#define LV_BUILD_EXAMPLES      0

#endif
