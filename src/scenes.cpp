#include "scenes.h"
#include "fonts/icons_gen.h"   // ICON_SYMBOL_NAMES / ICON_SYMBOL_COUNT (pour un eventuel check ; pas requis ici)
#include <math.h>
#include <string.h>

static const float TAU = 6.2831853f;

// ---- Table figee des couches, une par scene ----
static const SceneLayer L_SUNNY[] = {
    { "weather-sunny", 50, 50, 0.90f, SC_PRINCIPAL, 0, SC_ROTATE, 7000, 0, 0 },
};
static const SceneLayer L_RAIN[] = {
    { "weather-cloudy", 50, 38, 0.72f, SC_ACCENT, 0x8892A0, SC_STATIC, 1000, 0, 0 },
    { "water", 34, 66, 0.30f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 1100, 22, 0 },
    { "water", 50, 66, 0.30f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 1100, 22, 360 },
    { "water", 66, 66, 0.30f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 1100, 22, 720 },
};
static const SceneLayer L_SNOW[] = {
    { "weather-cloudy", 50, 38, 0.72f, SC_ACCENT, 0x8892A0, SC_STATIC, 1000, 0, 0 },
    { "snowflake", 34, 66, 0.26f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 2200, 20, 0 },
    { "snowflake", 50, 66, 0.26f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 2200, 20, 740 },
    { "snowflake", 66, 66, 0.26f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 2200, 20, 1480 },
};
static const SceneLayer L_STORM[] = {
    { "weather-cloudy", 50, 38, 0.74f, SC_PRINCIPAL, 0, SC_STATIC, 1000, 0, 0 },
    { "lightning-bolt", 52, 70, 0.42f, SC_ACCENT, 0xF5C518, SC_FLASH, 1800, 0, 0 },
};
static const SceneLayer L_WIND[] = {
    { "weather-windy", 50, 50, 0.82f, SC_PRINCIPAL, 0, SC_DRIFT, 3800, 7, 0 },
};
static const SceneLayer L_SPINNER[] = {
    { "refresh", 50, 50, 0.80f, SC_PRINCIPAL, 0, SC_ROTATE, 1100, 0, 0 },
};
static const SceneLayer L_ALERT[] = {
    { "alert", 50, 50, 0.86f, SC_PRINCIPAL, 0, SC_PULSE, 1400, 0.18f, 0 },
};
static const SceneLayer L_BELL[] = {
    { "bell-ring", 50, 46, 0.84f, SC_PRINCIPAL, 0, SC_SWING, 900, 16, 0 },
};
static const SceneLayer L_PULSE[] = {
    { "broadcast", 50, 50, 0.86f, SC_PRINCIPAL, 0, SC_PULSE, 1100, 0.16f, 0 },
};

#define SCN(n, arr) { n, arr, (int)(sizeof(arr)/sizeof((arr)[0])) }
const Scene SCENE_CATALOG[] = {
    SCN("sunny",   L_SUNNY),   SCN("rain",  L_RAIN),  SCN("snow",    L_SNOW),
    SCN("storm",   L_STORM),   SCN("wind",  L_WIND),  SCN("spinner", L_SPINNER),
    SCN("alert",   L_ALERT),   SCN("bell",  L_BELL),  SCN("pulse",   L_PULSE),
};
#undef SCN

int scene_count() { return (int)(sizeof(SCENE_CATALOG) / sizeof(SCENE_CATALOG[0])); }

int scene_name_index(const char* name) {
    if (!name) return -1;
    for (int i = 0; i < scene_count(); i++)
        if (strcmp(SCENE_CATALOG[i].name, name) == 0) return i;
    return -1;
}

uint32_t scene_layer_color(const SceneLayer* l, uint32_t principal) {
    return l->role == SC_ACCENT ? l->accent : principal;
}

int scene_frame_at(int scene_id, uint32_t t_ms, LayerFrame* out) {
    if (scene_id < 0 || scene_id >= scene_count()) return 0;
    const Scene& s = SCENE_CATALOG[scene_id];
    int n = s.count > MAX_SCENE_LAYERS ? MAX_SCENE_LAYERS : s.count;
    for (int i = 0; i < n; i++) {
        const SceneLayer& L = s.layers[i];
        LayerFrame f; f.cx = L.cx; f.cy = L.cy; f.angle_ddeg = 0; f.scale = 1.0f; f.opa = 255;
        uint16_t per = L.period ? L.period : 1000;
        float ph = (float)((t_ms + L.phase) % per) / (float)per;   // 0..1
        switch (L.anim) {
            case SC_ROTATE:
                f.angle_ddeg = (int16_t)(ph * 3600.0f);
                break;
            case SC_TRANSLATE_LOOP:
                f.cy = L.cy - L.amp + 2.0f * L.amp * ph;            // descend de cy-amp a cy+amp
                f.opa = (uint8_t)(255.0f * (ph < 0.15f ? ph / 0.15f
                                          : ph > 0.85f ? (1.0f - ph) / 0.15f : 1.0f));
                break;
            case SC_DRIFT:
                f.cx = L.cx + L.amp * sinf(TAU * ph);
                break;
            case SC_PULSE: {
                float k = 0.5f * (1.0f - cosf(TAU * ph));           // 0..1
                f.scale = 1.0f + L.amp * k;
                f.opa = (uint8_t)(255.0f * (0.6f + 0.4f * k));
                break;
            }
            case SC_SWING:
                f.angle_ddeg = (int16_t)(L.amp * 10.0f * sinf(TAU * ph));
                break;
            case SC_FLASH:
                f.opa = (ph < 0.10f || (ph > 0.16f && ph < 0.24f)) ? 255 : 45;   // double eclair
                break;
            case SC_STATIC:
            default: break;
        }
        out[i] = f;
    }
    return n;
}
