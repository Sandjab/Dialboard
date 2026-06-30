#include "dashboard.h"
#include "color.h"
#include "format.h"
#include <ArduinoJson.h>
#include <string.h>

bool bg_key_valid(const char* key) {
    if (!key || !key[0]) return false;
    size_t n = 0;
    for (const char* p = key; *p; p++, n++) {
        if (n >= 16) return false;
        char c = *p;
        bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
        if (!hex) return false;
    }
    return true;
}

int dash_find(const Dashboard* d, const char* id) {
    for (int i = 0; i < d->comp_count; i++)
        if (strncmp(d->components[i].id, id, ID_LEN) == 0) return i;
    return -1;
}

// Table nom→type : seul point d'énumération des types côté parse. Le test de conformité
// (test_schema_types_all_resolve) garantit qu'elle couvre exactement les types du schema.
static const struct { const char* name; CompType type; } COMP_NAMES[] = {
    { "label",    COMP_LABEL    }, { "readout",  COMP_READOUT  }, { "bar",   COMP_BAR   },
    { "ring",     COMP_RING     }, { "led_ring", COMP_LED_RING }, { "sound", COMP_SOUND },
    { "chart",    COMP_CHART    }, { "meter",    COMP_METER    }, { "image", COMP_IMAGE },
    { "image_anim", COMP_IMAGE_ANIM }, { "led", COMP_LED },
    { "rect", COMP_RECT }, { "circle", COMP_CIRCLE }, { "line", COMP_LINE },
    { "icon", COMP_ICON },
};

static uint8_t parse_font_family(const char *s) {
    if (!s) return FAMILY_MONTSERRAT;
    if (!strcmp(s, "jetbrains_mono")) return FAMILY_JETBRAINS_MONO;
    if (!strcmp(s, "lora"))           return FAMILY_LORA;
    if (!strcmp(s, "inter"))          return FAMILY_INTER;
    return FAMILY_MONTSERRAT;
}

static CompType parse_type(const char* s) {
    if (!s) return COMP_NONE;
    for (const auto& e : COMP_NAMES)
        if (!strcmp(s, e.name)) return e.type;
    return COMP_NONE;
}

static Anchor parse_anchor(const char* s) {
    if (!s) return A_CENTER;
    if (!strcmp(s,"TOP_MID"))      return A_TOP_MID;
    if (!strcmp(s,"BOTTOM_MID"))   return A_BOTTOM_MID;
    if (!strcmp(s,"LEFT_MID"))     return A_LEFT_MID;
    if (!strcmp(s,"RIGHT_MID"))    return A_RIGHT_MID;
    if (!strcmp(s,"TOP_LEFT"))     return A_TOP_LEFT;
    if (!strcmp(s,"TOP_RIGHT"))    return A_TOP_RIGHT;
    if (!strcmp(s,"BOTTOM_LEFT"))  return A_BOTTOM_LEFT;
    if (!strcmp(s,"BOTTOM_RIGHT")) return A_BOTTOM_RIGHT;
    return A_CENTER;
}

static BarMode parse_bar_mode(const char* s) {
    if (s && !strcmp(s, "symmetrical")) return BAR_SYMMETRICAL;
    return BAR_NORMAL;
}
static ArcMode parse_arc_mode(const char* s) {
    if (s && !strcmp(s, "symmetrical")) return ARC_SYMMETRICAL;
    if (s && !strcmp(s, "reverse"))     return ARC_REVERSE;
    return ARC_NORMAL;
}
static LineDash parse_line_dash(const char* s) {
    if (s && !strcmp(s, "dashed")) return LINE_DASHED;
    if (s && !strcmp(s, "dotted")) return LINE_DOTTED;
    return LINE_SOLID;
}
static LedMode parse_led_mode(const char* s, LedMode def) {
    if (!s)                       return def;
    if (!strcmp(s, "off"))        return LED_OFF;
    if (!strcmp(s, "solid"))      return LED_SOLID;
    if (!strcmp(s, "progress"))   return LED_PROGRESS;
    if (!strcmp(s, "spinner"))    return LED_SPINNER;
    if (!strcmp(s, "blink"))      return LED_BLINK;
    if (!strcmp(s, "breathe"))    return LED_BREATHE;
    return def;
}

// Set curaté de symboles. ORDRE == ICON_GLYPHS (view.cpp) ; les deux indexent par la meme valeur.
static const char* const ICON_SYMBOL_NAMES[ICON_SYMBOL_COUNT] = {
    "wifi", "bluetooth", "gps", "usb",
    "battery_empty", "battery_1", "battery_2", "battery_3", "battery_full",
    "charge", "power", "bell", "warning", "ok", "close",
    "play", "pause", "stop", "volume_max", "mute",
    "home", "settings", "refresh",
};
static_assert(sizeof(ICON_SYMBOL_NAMES) / sizeof(ICON_SYMBOL_NAMES[0]) == ICON_SYMBOL_COUNT,
              "ICON_SYMBOL_NAMES desync avec ICON_SYMBOL_COUNT");
static uint8_t icon_symbol_index(const char* s) {
    if (s) for (int i = 0; i < ICON_SYMBOL_COUNT; i++)
        if (!strcmp(s, ICON_SYMBOL_NAMES[i])) return (uint8_t)i;
    return 0;   // miss (impossible apres validation schema) -> 1er glyphe
}

bool dash_set_layout(Dashboard* d, const char* json, char* err, size_t errn) {
    JsonDocument doc;
    DeserializationError e = deserializeJson(doc, json);
    if (e) { snprintf(err, errn, "JSON: %s", e.c_str()); return false; }

    static Dashboard t;          // ~10.4 KB — keep off the 8 KB loop-task stack
    memset(&t, 0, sizeof(t));
    strlcpy(t.title, doc["title"] | "", sizeof(t.title));
    t.background = parse_hex_color(doc["background"] | "#000000", 0x000000);
    t.nav_wrap   = doc["nav"]["wrap"] | true;

    JsonObjectConst comps = doc["components"].as<JsonObjectConst>();
    if (comps.isNull()) { snprintf(err, errn, "components manquant"); return false; }
    for (JsonPairConst kv : comps) {
        if (t.comp_count >= MAX_COMPONENTS) { snprintf(err, errn, "trop de composants"); return false; }
        Component& c = t.components[t.comp_count];
        strlcpy(c.id, kv.key().c_str(), sizeof(c.id));
        JsonObjectConst o = kv.value().as<JsonObjectConst>();
        c.type = parse_type(o["type"] | "");
        if (c.type == COMP_NONE) { snprintf(err, errn, "type inconnu pour '%s'", c.id); return false; }
        strlcpy(c.label, o["label"] | "", sizeof(c.label));
        strlcpy(c.unit,  o["unit"]  | "", sizeof(c.unit));
        strlcpy(c.text,  o["text"]  | "", sizeof(c.text));
        strlcpy(c.vstr,  o["text"]  | "", sizeof(c.vstr));
        c.color       = parse_hex_color(o["color"] | "#FFFFFF", 0xFFFFFF);
        c.vmin        = o["min"] | 0;
        c.vmax        = o["max"] | 100;
        c.off_below   = o["off_below"] | 1;
        c.led_glow      = o["glow"]      | true;
        c.led_bezel     = o["bezel"]     | true;
        c.led_specular  = o["specular"]  | true;
        c.led_off_glass = o["off_glass"] | true;
        c.center_pct  = o["center_pct"] | false;
        c.center_color_set = o["center_color"].is<const char*>();
        c.center_color     = c.center_color_set ? parse_hex_color(o["center_color"], c.color) : c.color;
        c.countdown   = o["countdown"] | false;
        c.visible     = o["visible"] | true;   // config-time : caché par défaut possible (visible:false). Aussi pilotable via /update.
        strlcpy(c.cap_prefix, o["cap_prefix"] | "", sizeof(c.cap_prefix));
        c.cap_font   = o["cap_font"] | 14;
        c.cap_family = parse_font_family(o["cap_family"] | "montserrat");
        c.cap_bold   = o["cap_bold"]   | false;
        c.cap_italic = o["cap_italic"] | false;
        c.font        = o["font"] | 20;
        c.font_family = parse_font_family(o["font_family"] | "montserrat");
        c.bold        = o["bold"]   | false;
        c.italic      = o["italic"] | false;
        c.label_color = parse_hex_color(o["label_color"] | "#9AA0AA", 0x9AA0AA);
        c.label_font  = o["label_font"] | 14;
        c.label_family = parse_font_family(o["label_family"] | "montserrat");
        c.label_bold   = o["label_bold"]   | false;
        c.label_italic = o["label_italic"] | false;
        c.label_align = parse_anchor(o["label_align"] | "TOP_MID");
        c.bar_mode     = parse_bar_mode(o["mode"] | "normal");
        c.bar_vertical = !strcmp(o["orientation"] | "horizontal", "vertical");
        c.bar_anim_ms  = o["anim_ms"] | 0;
        if (c.bar_anim_ms < 0) c.bar_anim_ms = 0;
        c.arc_mode     = parse_arc_mode(o["mode"] | "normal");
        c.arc_rounded  = o["rounded"] | true;
        c.fill_set     = o["fill"].is<const char*>();
        c.fill         = c.fill_set ? parse_hex_color(o["fill"], 0) : 0;
        c.border_color = parse_hex_color(o["border_color"] | "#FFFFFF", 0xFFFFFF);
        c.border_width = o["border_width"] | 0;
        if (c.border_width < 0) c.border_width = 0;
        c.pad_x        = o["pad_x"] | 0;
        if (c.pad_x < 0) c.pad_x = 0;
        c.pad_y        = o["pad_y"] | 0;
        if (c.pad_y < 0) c.pad_y = 0;
        c.line_dash    = parse_line_dash(o["dash"] | "solid");
        c.line_rounded = o["rounded"] | false;   // line : defaut false (ring lit aussi "rounded" -> arc_rounded, defaut true)
        c.led_brightness_cfg = o["brightness"] | 64;
        strlcpy(c.bind, o["bind"] | "", sizeof(c.bind));
        c.chart_points = o["points"] | 30;
        if (c.chart_points > CHART_MAX_POINTS) c.chart_points = CHART_MAX_POINTS;
        if (c.chart_points < 1)                c.chart_points = 1;
        const char* isrc = o["src"] | "";
        strlcpy(c.image_src, bg_key_valid(isrc) ? isrc : "", sizeof(c.image_src));
        c.image_w = o["w"] | 0;
        c.image_h = o["h"] | 0;
        c.aimg_frames   = o["frames"] | 0;
        if (c.aimg_frames > AIMG_MAX_FRAMES) c.aimg_frames = AIMG_MAX_FRAMES;
        if (c.aimg_frames < 0)               c.aimg_frames = 0;
        { int aimg_per = o["period"] | 100; c.aimg_period = (uint16_t)(aimg_per > 0 ? aimg_per : 100); }
        c.aimg_rest     = o["rest_frame"] | 0;
        if (c.aimg_rest < 0) c.aimg_rest = 0;
        if (c.aimg_frames > 0 && c.aimg_rest >= c.aimg_frames) c.aimg_rest = c.aimg_frames - 1;
        c.aimg_loop     = o["loop"] | 0;
        c.aimg_autoplay = o["autoplay"] | false;
        if (c.type == COMP_IMAGE_ANIM) {                    // n'ecrase value que pour ce type
            c.value = c.aimg_rest;                          // frame initiale = repos
            if (c.aimg_autoplay && c.aimg_frames > 0) {
                c.aimg_playing    = true;
                c.aimg_loops_left = (c.aimg_loop <= 0) ? -1 : c.aimg_loop;
                c.aimg_period_ms  = c.aimg_period ? c.aimg_period : 100;
                c.aimg_last_ms    = 0;
                c.value           = 0;
            }
        }
        JsonArrayConst th = o["thresholds"].as<JsonArrayConst>();
        for (JsonArrayConst pair : th) {
            if (c.threshold_count >= MAX_THRESHOLDS) break;
            c.thresholds[c.threshold_count].limit = pair[0].as<float>();
            c.thresholds[c.threshold_count].color = parse_hex_color(pair[1] | "#FFFFFF", 0xFFFFFF);
            c.threshold_count++;
        }
        if (c.type == COMP_ICON) {
            if (!o["font"].is<int>()) c.font = 28;                 // icon : defaut 28 (vs 20 generique)
            c.icon_symbol = icon_symbol_index(o["symbol"] | "bell");
            JsonArrayConst ist = o["states"].as<JsonArrayConst>();
            for (JsonObjectConst s : ist) {
                if (c.icon_state_count >= MAX_ICON_STATES) break;
                IconState& is = c.icon_states[c.icon_state_count];
                is.at         = s["at"] | 0.0f;
                is.has_symbol = s["symbol"].is<const char*>();
                is.symbol     = is.has_symbol ? icon_symbol_index(s["symbol"]) : 0;
                is.has_color  = s["color"].is<const char*>();
                is.color      = is.has_color ? parse_hex_color(s["color"], 0xFFFFFF) : 0;
                c.icon_state_count++;
            }
        }
        if (c.type == COMP_LED_RING) {                    // config -> état initial du driver (boot vivant)
            c.led_color      = c.color;                   // (sinon le driver retombe sur blanc tant qu'aucun /update)
            c.led_brightness = c.led_brightness_cfg;
            c.led_mode       = parse_led_mode(o["mode"], LED_OFF);
            c.led_period_ms  = o["period_ms"] | 1000;
            c.led_value      = 0;                         // progress part de 0 jusqu'au 1er /update
        }
        t.comp_count++;
    }

    JsonArrayConst pages = doc["pages"].as<JsonArrayConst>();
    for (JsonObjectConst pg : pages) {
        if (t.page_count >= MAX_PAGES) { snprintf(err, errn, "trop de pages"); return false; }
        Page& p = t.pages[t.page_count];
        strlcpy(p.name, pg["name"] | "", sizeof(p.name));
        p.background = parse_hex_color(pg["background"] | "", t.background);   // override de page, sinon fond global ("" → fallback)
        const char* bgimg = pg["background_image"] | "";
        strlcpy(p.background_image, bg_key_valid(bgimg) ? bgimg : "", sizeof(p.background_image));
        for (JsonObjectConst pl : pg["place"].as<JsonArrayConst>()) {
            if (p.place_count >= MAX_PLACEMENTS_PER_PAGE) { snprintf(err, errn, "trop de placements"); return false; }
            const char* ref = pl["ref"] | "";
            int ci = dash_find(&t, ref);
            if (ci < 0) { snprintf(err, errn, "ref inconnue '%s'", ref); return false; }
            Placement& q = p.places[p.place_count];
            q.comp_index  = ci;
            q.anchor      = parse_anchor(pl["anchor"] | "CENTER");
            q.dx          = pl["dx"] | 0;       q.dy     = pl["dy"] | 0;
            q.width       = pl["width"] | 0;    q.height = pl["height"] | 0;
            q.radius      = pl["radius"] | 0;   q.thickness = pl["thickness"] | 16;
            q.gap_deg     = pl["gap_deg"] | 70; q.start_angle = pl["start_angle"] | 0;
            q.size        = pl["size"] | 24;
            p.place_count++;
        }
        t.page_count++;
    }

    JsonArrayConst srcs = doc["sources"].as<JsonArrayConst>();
    for (JsonObjectConst so : srcs) {
        if (t.source_count >= MAX_SOURCES) { snprintf(err, errn, "trop de sources"); return false; }
        Source& s = t.sources[t.source_count];
        strlcpy(s.name, so["name"] | "", sizeof(s.name));
        strlcpy(s.url,  so["url"]  | "", sizeof(s.url));
        if (s.url[0] == '\0') { snprintf(err, errn, "source '%s' sans url", s.name); return false; }
        uint32_t iv  = so["interval_s"] | 60;
        s.interval_s = iv < CTX_MIN_INTERVAL_S ? CTX_MIN_INTERVAL_S : iv;
        for (JsonPairConst h : so["headers"].as<JsonObjectConst>()) {
            if (s.header_count >= MAX_HEADERS_PER_SOURCE) break;
            strlcpy(s.headers[s.header_count].name,  h.key().c_str(), sizeof(s.headers[0].name));
            strlcpy(s.headers[s.header_count].value, h.value() | "", sizeof(s.headers[0].value));
            s.header_count++;
        }
        for (JsonPairConst v : so["vars"].as<JsonObjectConst>()) {
            if (s.var_count >= MAX_VARS_PER_SOURCE) break;
            strlcpy(s.vars[s.var_count].name, v.key().c_str(), sizeof(s.vars[0].name));
            strlcpy(s.vars[s.var_count].ptr,  v.value() | "", sizeof(s.vars[0].ptr));
            s.var_count++;
        }
        t.source_count++;
    }

    JsonArrayConst snks = doc["sinks"].as<JsonArrayConst>();
    for (JsonObjectConst sk : snks) {
        if (t.sink_count >= MAX_SINKS) { snprintf(err, errn, "trop de sinks"); return false; }
        Sink& s = t.sinks[t.sink_count];
        strlcpy(s.name,  sk["name"]  | "", sizeof(s.name));
        strlcpy(s.watch, sk["watch"] | "", sizeof(s.watch));
        strlcpy(s.url,   sk["url"]   | "", sizeof(s.url));
        if (s.url[0]   == '\0') { snprintf(err, errn, "sink '%s' sans url", s.name);   return false; }
        if (s.watch[0] == '\0') { snprintf(err, errn, "sink '%s' sans watch", s.name); return false; }
        const char* m = sk["method"] | "POST";
        s.method = (strcmp(m, "PUT") == 0) ? SINK_PUT : (strcmp(m, "GET") == 0) ? SINK_GET : SINK_POST;
        s.debounce_ms = sk["debounce_ms"] | 0;
        for (JsonPairConst h : sk["headers"].as<JsonObjectConst>()) {
            if (s.header_count >= MAX_HEADERS_PER_SINK) break;
            strlcpy(s.headers[s.header_count].name,  h.key().c_str(), sizeof(s.headers[0].name));
            strlcpy(s.headers[s.header_count].value, h.value() | "",  sizeof(s.headers[0].value));
            s.header_count++;
        }
        if (!sk["body"].isNull()) serializeJson(sk["body"], s.body, sizeof(s.body));
        t.sink_count++;
    }

    t.active_page  = 0;
    t.layout_dirty = true;
    *d = t;
    return true;
}

// Fenêtre glissante d'historique du chart : garde les chart_points dernières valeurs,
// hist[0..hist_count-1] en ordre chronologique. Utilisé par /update (apply_chart) et bind (context_apply).
static void chart_push(Component& c, int16_t v) {
    int n = c.chart_points;
    if (n > CHART_MAX_POINTS) n = CHART_MAX_POINTS;
    if (n < 1) n = 1;
    if (c.hist_count < n) {
        c.hist[c.hist_count++] = v;
    } else {
        memmove(c.hist, c.hist + 1, (size_t)(n - 1) * sizeof(int16_t));
        c.hist[n - 1] = v;
    }
}

// Vtable modèle : un handler /update par type, indexé par CompType. Chaque branche est
// l'ancien `case` d'apply_one, à l'identique. Ajouter un type = une fn + une ligne de table.
typedef void (*comp_apply_fn)(Component&, JsonVariantConst);

// Étape 1 : un push scalaire accepte le scalaire nu OU la forme objet {value|text} (qui débloque les
// commandes universelles comme visible). Renvoie false si forme objet SANS value/text (ex. {visible:false}
// seul) -> le handler ne doit PAS écraser la valeur courante (sinon object.as<int>() == 0 la remettrait à 0).
static bool value_present(JsonVariantConst v, JsonVariantConst& out) {
    if (v.is<JsonObjectConst>()) {
        if (v["text"].is<const char*>()) { out = v["text"];  return true; }
        if (!v["value"].isNull())        { out = v["value"]; return true; }
        return false;
    }
    out = v;
    return true;
}

static void apply_label(Component& c, JsonVariantConst v) {
    JsonVariantConst n;
    if (value_present(v, n) && n.is<const char*>())
        strlcpy(c.vstr, n.as<const char*>(), sizeof(c.vstr));   // non-chaîne ou absent : garde l'ancien
}
static void apply_readout(Component& c, JsonVariantConst v) {
    JsonVariantConst n;
    if (!value_present(v, n)) return;
    if (n.is<const char*>()) strlcpy(c.vstr, n.as<const char*>(), sizeof(c.vstr));
    else format_value(n.as<double>(), c.unit, c.vstr, sizeof(c.vstr));
}
static void apply_bar(Component& c, JsonVariantConst v) {
    JsonVariantConst n; if (value_present(v, n)) c.value = n.as<int>();
}
static void apply_ring(Component& c, JsonVariantConst v) {
    c.value      = v["pct"] | c.value;
    c.reset_in_s = v["reset_in_s"] | c.reset_in_s;
    if (v["caption"].is<const char*>()) {
        strlcpy(c.caption, v["caption"].as<const char*>(), sizeof(c.caption));
    } else if (c.countdown) {
        format_remaining(c.reset_in_s, c.caption, sizeof(c.caption));
    }
}
static void apply_led_ring(Component& c, JsonVariantConst v) {
    if (v["mode"].is<const char*>())  c.led_mode  = parse_led_mode(v["mode"], c.led_mode);
    if (v["color"].is<const char*>()) c.led_color = parse_hex_color(v["color"], c.led_color);
    c.led_value      = v["value"]      | c.led_value;
    c.led_brightness = v["brightness"] | c.led_brightness_cfg;
    c.led_period_ms  = v["period_ms"]  | (c.led_period_ms ? c.led_period_ms : 1000);
}
static void apply_sound(Component& c, JsonVariantConst v) {
    c.snd_pending = true;
    c.snd_tone = v["tone"] | 0;
    c.snd_ms   = v["ms"]   | 150;
    strlcpy(c.snd_name, v["name"] | "", sizeof(c.snd_name));
}
static void apply_chart(Component& c, JsonVariantConst v) {
    JsonVariantConst n; if (value_present(v, n)) chart_push(c, (int16_t)n.as<int>());   // push explicite : un point
}
static void apply_meter(Component& c, JsonVariantConst v) {
    JsonVariantConst n; if (value_present(v, n)) c.value = n.as<int>();   // scalaire -> aiguille (comme bar)
}
static void apply_led(Component& c, JsonVariantConst v) {
    JsonVariantConst n; if (value_present(v, n)) c.value = n.as<int>();   // scalaire -> etat on/off + couleur de seuil
}
static void apply_image(Component&, JsonVariantConst) {
    // Image statique : pas de /update en v1 (asset GET-only). Entree de vtable requise.
}
static void apply_shape(Component&, JsonVariantConst) {
    // rect/circle/line : statiques, pas de push de valeur. `visible` est gere universellement
    // (dash_apply_update) avant apply_one. Entree de vtable requise (static_assert COMP_COUNT).
}
static void apply_icon(Component& c, JsonVariantConst v) {
    JsonVariantConst n; if (value_present(v, n)) c.value = n.as<int>();   // scalaire -> resolution glyphe+couleur
}
static void apply_image_anim(Component& c, JsonVariantConst v) {
    if (v["stop"] | false) {
        c.aimg_playing = false;
        c.value = (c.aimg_frames > 0 && c.aimg_rest >= 0 && c.aimg_rest < c.aimg_frames) ? c.aimg_rest : 0;
        return;
    }
    if (v["frame"].is<int>()) {
        int fr = v["frame"];
        if (c.aimg_frames > 0) { if (fr < 0) fr = 0; if (fr >= c.aimg_frames) fr = c.aimg_frames - 1; }
        else fr = 0;
        c.value = fr;
        c.aimg_playing = false;
        return;
    }
    if (v["play"] | false) {
        if (c.aimg_frames <= 0) return;          // pas d'asset : play ignore
        int per  = v["period"] | (int)(c.aimg_period ? c.aimg_period : 100);
        int loop = v["loop"]   | c.aimg_loop;            // 0 = infini
        c.aimg_period_ms  = (uint16_t)(per > 0 ? per : 100);
        c.aimg_loops_left = (loop <= 0) ? -1 : loop;
        c.aimg_playing    = true;
        c.aimg_last_ms    = 0;
        c.value           = 0;
    }
}

static const comp_apply_fn APPLY[] = {
    /* COMP_NONE     */ nullptr,
    /* COMP_LABEL    */ apply_label,
    /* COMP_READOUT  */ apply_readout,
    /* COMP_BAR      */ apply_bar,
    /* COMP_RING     */ apply_ring,
    /* COMP_LED_RING */ apply_led_ring,
    /* COMP_SOUND    */ apply_sound,
    /* COMP_CHART    */ apply_chart,
    /* COMP_METER    */ apply_meter,
    /* COMP_IMAGE    */ apply_image,
    /* COMP_IMAGE_ANIM */ apply_image_anim,
    /* COMP_LED      */ apply_led,
    /* COMP_RECT     */ apply_shape,
    /* COMP_CIRCLE   */ apply_shape,
    /* COMP_LINE     */ apply_shape,
    /* COMP_ICON     */ apply_icon,
};
static_assert(sizeof(APPLY) / sizeof(APPLY[0]) == COMP_COUNT,
              "APPLY desync avec CompType : ajoute la ligne du nouveau type");

static void apply_one(Component& c, JsonVariantConst v) {
    if (c.type > COMP_NONE && (unsigned)c.type < COMP_COUNT && APPLY[c.type])
        APPLY[c.type](c, v);
}

int dash_apply_update(Dashboard* d, const char* json, char* unknown_csv, size_t n) {
    unknown_csv[0] = '\0';
    JsonDocument doc;
    if (deserializeJson(doc, json)) return -1;
    int updated = 0;
    for (JsonPairConst kv : doc.as<JsonObjectConst>()) {
        int ci = dash_find(d, kv.key().c_str());
        if (ci < 0) {
            size_t len = strlen(unknown_csv);
            snprintf(unknown_csv + len, n - len, "%s%s", len ? "," : "", kv.key().c_str());
            continue;
        }
        Component& comp = d->components[ci];
        JsonVariantConst val = kv.value();
        if (val["visible"].is<bool>()) comp.visible = val["visible"].as<bool>();   // commande universelle (forme objet)
        apply_one(comp, val);
        comp.dirty = true;
        d->values_dirty = true;
        updated++;
    }
    return updated;
}

void dash_set_context(Dashboard* d, const char* json, uint32_t now) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) return;          // JSON invalide : on garde le contexte
    ctx_apply_json(&d->ctx, doc.as<JsonObjectConst>(), now);
}

// Arme (pending_since = now) chaque sink dont watch == var. now==0 -> 1 (0 = "non armé").
static void arm_sinks(Dashboard* d, const char* var, uint32_t now) {
    for (int i = 0; i < d->sink_count; i++)
        if (strncmp(d->sinks[i].watch, var, ID_LEN) == 0)
            d->sinks[i].pending_since = now ? now : 1;
}
void dash_ctx_write_ui_num(Dashboard* d, const char* var, double v, uint32_t now) {
    if (ctx_set_num(&d->ctx, var, v, now)) arm_sinks(d, var, now);
}
void dash_ctx_write_ui_str(Dashboard* d, const char* var, const char* v, uint32_t now) {
    if (ctx_set_str(&d->ctx, var, v, now)) arm_sinks(d, var, now);
}

void context_apply(Dashboard* d) {
    for (int i = 0; i < d->comp_count; i++) {
        Component& c = d->components[i];
        if (c.bind[0] == '\0') continue;                // pas de bind -> push par id
        int vi = ctx_find(&d->ctx, c.bind);
        if (vi < 0) continue;                           // variable absente -> garde la derniere valeur
        const CtxVar& v = d->ctx.vars[vi];
        bool changed = false;
        switch (c.type) {
            case COMP_BAR:
            case COMP_RING:                             // scalaire -> valeur primaire (pct pour le ring)
                if (v.type == CTX_NUM) {
                    int32_t nv = (int32_t)v.num;
                    if (c.value != nv) { c.value = nv; changed = true; }
                }
                break;
            case COMP_READOUT:
            case COMP_LABEL: {                          // num -> format_value (unite pour readout) ; str -> tel quel
                char nb[TEXT_LEN];
                if (v.type == CTX_STR) strlcpy(nb, v.str, sizeof(nb));
                else format_value(v.num, c.type == COMP_READOUT ? c.unit : "", nb, sizeof(nb));
                if (strncmp(c.vstr, nb, sizeof(c.vstr)) != 0) { strlcpy(c.vstr, nb, sizeof(c.vstr)); changed = true; }
                break;
            }
            case COMP_METER:                            // scalaire -> aiguille (comme bar)
            case COMP_LED:                              // scalaire -> etat on/off
                if (v.type == CTX_NUM) {
                    int32_t nv = (int32_t)v.num;
                    if (c.value != nv) { c.value = nv; changed = true; }
                }
                break;
            case COMP_CHART:                            // append SEULEMENT au changement (évite le flood du tick 100 ms)
                if (v.type == CTX_NUM) {
                    int32_t nv = (int32_t)v.num;
                    if (c.value != nv) { chart_push(c, (int16_t)nv); c.value = nv; changed = true; }
                }
                break;
            case COMP_IMAGE_ANIM:                       // bind = frame d'etat, seulement a l'arret
                if (!c.aimg_playing && v.type == CTX_NUM && c.aimg_frames > 0) {
                    int32_t nv = (int32_t)v.num;
                    if (nv < 0) nv = 0;
                    if (nv >= c.aimg_frames) nv = c.aimg_frames - 1;
                    if (c.value != nv) { c.value = nv; changed = true; }
                }
                break;
            default: break;                            // led_ring/sound : pas de bind
        }
        if (changed) { c.dirty = true; d->values_dirty = true; }
    }
}

// Moteur d'avance de frame pour les composants image_anim en lecture.
// Appelé à chaque tick (100 ms typ.) depuis la tâche LVGL ou main loop.
// Sentinelle aimg_loops_left == -1 : boucle infinie — jamais décrémentée.
// Premier tick : pose aimg_last_ms sans avancer (la frame 0 s'affiche pendant une periode complète).
// Fin de boucle finie : règle aimg_playing=false puis saute à aimg_rest (frame de repos).
void dash_tick_aimg(Dashboard* d, uint32_t now_ms) {
    for (int i = 0; i < d->comp_count; i++) {
        Component& c = d->components[i];
        if (c.type != COMP_IMAGE_ANIM || !c.aimg_playing) continue;
        if (c.aimg_frames <= 0) { c.aimg_playing = false; continue; }
        if (c.aimg_last_ms == 0) { c.aimg_last_ms = now_ms; continue; }   // 1er tick : montre frame 0 une periode
        uint16_t per = c.aimg_period_ms ? c.aimg_period_ms : 100;
        if ((now_ms - c.aimg_last_ms) < per) continue;
        c.aimg_last_ms = now_ms;
        int32_t nf = c.value + 1;
        if (nf >= c.aimg_frames) {
            nf = 0;
            if (c.aimg_loops_left > 0) {                  // -1 = infini : jamais decremente
                c.aimg_loops_left--;
                if (c.aimg_loops_left == 0) {             // derniere passe terminee
                    c.aimg_playing = false;
                    nf = (c.aimg_rest >= 0 && c.aimg_rest < c.aimg_frames) ? c.aimg_rest : 0;
                }
            }
        }
        c.value = nf;
        c.dirty = true;
        d->values_dirty = true;
    }
}

void dash_tick_countdown(Dashboard* d, uint32_t elapsed_s) {
    for (int i = 0; i < d->comp_count; i++) {
        Component& c = d->components[i];
        if (c.type != COMP_RING || !c.countdown) continue;
        if (c.reset_in_s == 0) continue;
        c.reset_in_s = (c.reset_in_s > elapsed_s) ? c.reset_in_s - elapsed_s : 0;
        format_remaining(c.reset_in_s, c.caption, sizeof(c.caption));
        c.dirty = true;
        d->values_dirty = true;
    }
}
