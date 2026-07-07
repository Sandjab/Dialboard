#include "view.h"
#include "color.h"
#include "nav_input.h"
#include <lvgl.h>
#include <string.h>
#include <cstdio>
#include <math.h>
#include <time.h>
#include "format.h"
#include "clock_geom.h"
#include "ring_geom.h"
#include <LittleFS.h>
#include "esp_heap_caps.h"
#include "config.h"
#include "asset_fs.h"
#include "fonts.h"
#include "fonts/icons_gen.h"         // ICON_GLYPHS (glyphes MDI UTF-8) — index commun avec ICON_SYMBOL_NAMES
#include <Arduino.h>                 // millis()
#include "freertos/semphr.h"
#include "dashboard.h"               // dash_ctx_write_ui_num/str (deja tire via view.h, explicite ici)
#include "stepper_logic.h"
#include "segmented_logic.h"

extern SemaphoreHandle_t g_ctx_mutex;   // defini dans main.cpp, sérialise l'accès au contexte

static lv_obj_t* s_page_cont[MAX_PAGES];
static lv_obj_t* s_widget[MAX_PAGES][MAX_PLACEMENTS_PER_PAGE];
static lv_obj_t* s_sub1  [MAX_PAGES][MAX_PLACEMENTS_PER_PAGE];
static lv_obj_t* s_sub2  [MAX_PAGES][MAX_PLACEMENTS_PER_PAGE];
static lv_obj_t* s_dots = nullptr;

// line : lv_line_set_points conserve le POINTEUR (pas de copie) -> tableau persistant par placement.
// Rempli par build_line ; s_cur_page/s_cur_place sont poses par la boucle de build avant chaque build(),
// et par view_sync avant chaque sync() (relu par sync_clock pour ses points par placement).
static lv_point_precise_t s_line_pts[MAX_PAGES][MAX_PLACEMENTS_PER_PAGE][2];
static int s_cur_page = 0, s_cur_place = 0;

static uint8_t*     s_bg_buf[MAX_PAGES] = {0};   // RGB565 en PSRAM par page (nullptr = pas d'image)
static lv_image_dsc_t s_bg_dsc[MAX_PAGES];

// Images placees : RGB565A8 en PSRAM, indexees par composant (un component partage = un seul buffer).
static uint8_t*     s_img_buf[MAX_COMPONENTS] = {0};
static lv_image_dsc_t s_img_dsc[MAX_COMPONENTS];

// Images animees : pack RGB565A8 multi-frames en PSRAM + un descripteur lv_img par frame.
static uint8_t*      s_aimg_buf[MAX_COMPONENTS] = {0};
static lv_image_dsc_t* s_aimg_dsc[MAX_COMPONENTS] = {0};   // tableau de c.aimg_frames descripteurs (PSRAM)

// Styles persistants pour les bandes colorées de la jauge (sections lv_scale, LVGL 9).
// Doivent survivre au widget -> statiques. Un style par (composant, bande) pour le tricolore.
static lv_style_t s_meter_section_style[MAX_COMPONENTS][MAX_THRESHOLDS];
static bool       s_meter_section_init[MAX_COMPONENTS][MAX_THRESHOLDS] = {{0}};

// clock : aiguilles = lv_line, mêmes contraintes de pointeur persistant que s_line_pts.
// Indexé par PLACEMENT (comme s_line_pts) et non par composant : la géométrie dépend de q.radius,
// propriété du placement -> un même id clock sur 2 pages a 2 rayons distincts. Rempli par build_clock,
// relu par sync_clock, tous deux repérés par s_cur_page/s_cur_place. [page][place][hour/min/sec][2 points].
static lv_point_precise_t s_clock_pts[MAX_PAGES][MAX_PLACEMENTS_PER_PAGE][3][2];

// led : descripteurs de gradient persistants (lv_obj_set_style_bg_grad stocke le pointeur).
static lv_grad_dsc_t s_led_dome_grad[MAX_COMPONENTS];
static lv_grad_dsc_t s_led_spec_grad[MAX_COMPONENTS];

// segmented : lv_buttonmatrix exige un const char* map[] persistant (LVGL garde le pointeur).
// Indexé par COMPOSANT (pas par placement, contrairement à s_clock_pts) : roller_options est
// identique pour tous les placements d'un même id -> partager par comp_index est sûr.
static char        s_seg_buf[MAX_COMPONENTS][ROLLER_OPTS_LEN];   // copie mutable (on découpe en place)
static const char* s_seg_map[MAX_COMPONENTS][MAX_SEG_OPTS + 1];  // map buttonmatrix ("" final)
static uint8_t     s_seg_n[MAX_COMPONENTS];                      // nb de segments (pas de lv_buttonmatrix_get_button_count en 9.5)

static const lv_align_t ALIGN_MAP[] = {
    LV_ALIGN_CENTER, LV_ALIGN_TOP_MID, LV_ALIGN_BOTTOM_MID, LV_ALIGN_LEFT_MID,
    LV_ALIGN_RIGHT_MID, LV_ALIGN_TOP_LEFT, LV_ALIGN_TOP_RIGHT, LV_ALIGN_BOTTOM_LEFT, LV_ALIGN_BOTTOM_RIGHT
};

// Parallele a ALIGN_MAP, mais en alignement EXTERIEUR (label autour de son parent).
// A_CENTER n'a pas d'equivalent OUT -> repli sur OUT_TOP_MID (= comportement historique du label de barre).
static const lv_align_t ALIGN_OUT_MAP[] = {
    LV_ALIGN_OUT_TOP_MID,
    LV_ALIGN_OUT_TOP_MID, LV_ALIGN_OUT_BOTTOM_MID, LV_ALIGN_OUT_LEFT_MID, LV_ALIGN_OUT_RIGHT_MID,
    LV_ALIGN_OUT_TOP_LEFT, LV_ALIGN_OUT_TOP_RIGHT, LV_ALIGN_OUT_BOTTOM_LEFT, LV_ALIGN_OUT_BOTTOM_RIGHT
};

static const int16_t BAR_LABEL_GAP = 6;   // ecart fixe label<->barre (conserve le rendu actuel pour TOP_MID)

const char* view_default_layout() {
    return
      "{\"title\":\"Claude\",\"background\":\"#0B0B0F\",\"nav\":{\"wrap\":true},"
      "\"components\":{"
        "\"w5h\":{\"type\":\"ring\",\"color\":\"#38BDF8\",\"countdown\":true},"
        "\"w7d\":{\"type\":\"ring\",\"color\":\"#A78BFA\",\"countdown\":true},"
        "\"led\":{\"type\":\"led_ring\"},\"buzz\":{\"type\":\"sound\"}},"
      "\"pages\":[{\"name\":\"usage\",\"place\":["
        "{\"ref\":\"w5h\",\"radius\":176,\"thickness\":16,\"gap_deg\":70},"
        "{\"ref\":\"w7d\",\"radius\":141,\"thickness\":16,\"gap_deg\":70}]}]}";
}

// Positionne la lecture centrale (value+unit), unique enfant du conteneur grp (slot sub2). grp partage
// la géométrie de l'arc (centré, taille 2r) → l'alignement CENTER relatif au conteneur est le même repère
// que l'arc. Le cap (légende courbe) a sa géométrie propre (build_ring). À rappeler après chaque set_text
// (LVGL recentre sur la taille réelle).
static void ring_place_labels(lv_obj_t* grp, const Component& c, const Placement& q) {
    if (!grp) return;
    (void)q;
    lv_obj_t* center = c.center_pct ? lv_obj_get_child(grp, 0) : nullptr;
    if (center) lv_obj_align(center, LV_ALIGN_CENTER, 0, 0);
}

static void build_ring(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t** cap, lv_obj_t** sub2) {
    lv_obj_t* arc = lv_arc_create(parent);
    lv_obj_set_size(arc, q.radius * 2, q.radius * 2);
    lv_obj_center(arc);
    lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
    lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
    lv_arc_set_bg_angles(arc, 90 + q.start_angle + q.gap_deg / 2,
                              90 + q.start_angle - q.gap_deg / 2);
    lv_arc_set_range(arc, c.vmin, c.vmax);
    lv_obj_set_style_arc_width(arc, q.thickness, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, q.thickness, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, lv_color_hex(0x1F2937), LV_PART_MAIN);
    lv_obj_set_style_pad_all(arc, 0, LV_PART_MAIN);   // bord externe de la bande au bord du widget → milieu exact = radius - thickness/2 (sinon le padding par défaut décale le cap)
    lv_arc_set_mode(arc, c.arc_mode == ARC_SYMMETRICAL ? LV_ARC_MODE_SYMMETRICAL
                       : c.arc_mode == ARC_REVERSE     ? LV_ARC_MODE_REVERSE
                                                       : LV_ARC_MODE_NORMAL);
    lv_obj_set_style_arc_rounded(arc, c.arc_rounded, LV_PART_MAIN);
    lv_obj_set_style_arc_rounded(arc, c.arc_rounded, LV_PART_INDICATOR);
    *main = arc;

    // Cap = texte courbe (lv_arclabel) dans l'ouverture du bas. L'objet partage le centre du ring
    // (même taille + center), et le texte suit l'arc MÉDIAN de la bande (rayon radius - thickness/2)
    // couvrant l'ouverture (gap_deg) centrée sur (90 + start_angle). Avec vertical_align CENTER, le
    // milieu des lettres tombe sur le cercle médian de l'anneau quelles que soient l'épaisseur et la fonte.
    *cap = lv_arclabel_create(parent);
    lv_obj_set_size(*cap, q.radius * 2, q.radius * 2);
    lv_obj_center(*cap);
    lv_obj_set_style_text_font(*cap, get_font(c.cap_family, c.cap_font, c.cap_bold, c.cap_italic), 0);
    lv_obj_set_style_text_color(*cap, lv_color_hex(c.color), 0);
    lv_arclabel_set_radius(*cap, q.radius - q.thickness / 2);   // arc médian de la bande
    lv_arclabel_set_angle_start(*cap, 90 + q.start_angle - q.gap_deg / 2);  // COUNTER_CW : bord gauche de l'ouverture (symétrique CW)
    lv_arclabel_set_angle_size(*cap, q.gap_deg);
    lv_arclabel_set_dir(*cap, LV_ARCLABEL_DIR_COUNTER_CLOCKWISE);           // texte lisible (sourire) dans l'ouverture du bas
    lv_arclabel_set_text_horizontal_align(*cap, LV_ARCLABEL_TEXT_ALIGN_CENTER);
    lv_arclabel_set_text_vertical_align(*cap, LV_ARCLABEL_TEXT_ALIGN_CENTER);   // milieu des lettres sur le rayon (cercle médian de la bande)
    lv_arclabel_set_text(*cap, "");

    // Lecture centrale (value+unit) : unique enfant d'un conteneur transparent (slot sub2).
    lv_obj_t* grp = nullptr;
    if (c.center_pct) {
        grp = lv_obj_create(parent);
        lv_obj_remove_style_all(grp);                 // conteneur transparent (ni fond, ni bord, ni padding)
        lv_obj_set_size(grp, q.radius * 2, q.radius * 2);
        lv_obj_center(grp);
        lv_obj_clear_flag(grp, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_clear_flag(grp, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_t* ct = lv_label_create(grp);          // lecture centrale (grand chiffre)
        lv_obj_set_style_text_font(ct, get_font(c.font_family, c.font, c.bold, c.italic), 0);
        lv_obj_set_style_text_color(ct, lv_color_hex(c.color), 0);
        lv_label_set_text(ct, "");
    }
    *sub2 = grp;
    ring_place_labels(grp, c, q);
}

// build/sync extraits des anciens switch de view_rebuild/view_sync, à l'identique.
// Signature commune : 3 slots LVGL (main + 2 sous-objets) car ring/bar sont multi-objets.
static void build_text(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, get_font(c.font_family, c.font, c.bold, c.italic), 0);
    lv_obj_set_style_text_color(l, lv_color_hex(c.color), 0);
    if (q.radius > 0) lv_obj_set_style_radius(l, q.radius, 0);
    if (c.fill_set) {
        lv_obj_set_style_bg_color(l, lv_color_hex(c.fill), 0);
        lv_obj_set_style_bg_opa(l, LV_OPA_COVER, 0);
    }
    if (c.border_width > 0) {
        lv_obj_set_style_border_width(l, c.border_width, 0);
        lv_obj_set_style_border_color(l, lv_color_hex(c.border_color), 0);
        lv_obj_set_style_border_opa(l, LV_OPA_COVER, 0);
    }
    if (c.pad_x > 0) lv_obj_set_style_pad_hor(l, c.pad_x, 0);
    if (c.pad_y > 0) lv_obj_set_style_pad_ver(l, c.pad_y, 0);
    lv_label_set_text(l, "");
    lv_obj_align(l, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = l;
}
static void build_bar(lv_obj_t* parent, Component& c, Placement& q,
                      lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* b = lv_bar_create(parent);
    lv_obj_set_size(b, q.width ? q.width : 200, q.height ? q.height : 16);
    lv_bar_set_range(b, c.vmin, c.vmax);
    lv_bar_set_mode(b, c.bar_mode == BAR_SYMMETRICAL ? LV_BAR_MODE_SYMMETRICAL : LV_BAR_MODE_NORMAL);
    lv_bar_set_orientation(b, c.bar_vertical ? LV_BAR_ORIENTATION_VERTICAL : LV_BAR_ORIENTATION_HORIZONTAL);
    if (c.bar_anim_ms > 0) lv_obj_set_style_anim_duration(b, c.bar_anim_ms, LV_PART_MAIN);   // duree lue par lv_bar_set_value(ANIM_ON)
    lv_obj_set_style_bg_color(b, lv_color_hex(c.color), LV_PART_INDICATOR);
    lv_obj_align(b, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = b;
    if (c.label[0]) {
        lv_obj_t* bl = lv_label_create(parent);
        lv_obj_set_style_text_font(bl, get_font(c.label_family, c.label_font, c.label_bold, c.label_italic), 0);
        lv_obj_set_style_text_color(bl, lv_color_hex(c.label_color), 0);
        lv_label_set_text(bl, c.label);
        int16_t gx = 0, gy = 0;
        switch (c.label_align) {
            case A_BOTTOM_MID: case A_BOTTOM_LEFT: case A_BOTTOM_RIGHT: gy =  BAR_LABEL_GAP; break;
            case A_LEFT_MID:  gx = -BAR_LABEL_GAP; break;
            case A_RIGHT_MID: gx =  BAR_LABEL_GAP; break;
            default:          gy = -BAR_LABEL_GAP; break;   // TOP_* et repli A_CENTER
        }
        lv_obj_align_to(bl, b, ALIGN_OUT_MAP[c.label_align], gx, gy);
        *sub1 = bl;
    }
}

static void sync_label(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    lv_label_set_text(w, c.vstr);
}
static void sync_readout(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (c.label[0]) {
        char rb[TEXT_LEN * 2];
        snprintf(rb, sizeof(rb), "%s %s", c.label, c.vstr);
        lv_label_set_text(w, rb);
    } else {
        lv_label_set_text(w, c.vstr);
    }
}
static void sync_bar(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    uint32_t col = threshold_color(c.thresholds, c.threshold_count, c.value, c.color);
    lv_obj_set_style_bg_color(w, lv_color_hex(col), LV_PART_INDICATOR);
    lv_bar_set_value(w, c.value, c.bar_anim_ms > 0 ? LV_ANIM_ON : LV_ANIM_OFF);
}
static void sync_ring(Component& c, Placement& q, lv_obj_t* w, lv_obj_t* sub1, lv_obj_t* sub2) {
    uint32_t col = threshold_color(c.thresholds, c.threshold_count, c.value, c.color);
    lv_obj_set_style_arc_color(w, lv_color_hex(col), LV_PART_INDICATOR);
    lv_arc_set_value(w, c.value);
    if (sub1) {
        char cap_buf[CAPTION_LEN * 2];                             // cap_prefix + caption (chacun < CAPTION_LEN)
        snprintf(cap_buf, sizeof(cap_buf), "%s%s", c.cap_prefix, c.caption);
        lv_arclabel_set_text(sub1, cap_buf);
    }
    if (sub2) {                                   // conteneur : enfant [center?]
        lv_obj_t* center = c.center_pct ? lv_obj_get_child(sub2, 0) : nullptr;
        if (center) {
            char cb[24]; format_value((double)c.value, c.unit, cb, sizeof(cb));
            lv_label_set_text(center, cb);
            uint32_t ccol = c.center_color_set ? c.center_color : col;  // surcharge explicite, sinon suit le seuil
            lv_obj_set_style_text_color(center, lv_color_hex(ccol), 0);
        }
    }
    ring_place_labels(sub2, c, q);
}

// rings : 1..MAX_RING_TRACKS arcs concentriques dans un même conteneur (main = box, pas de cap/sub2).
static void build_rings(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    int outer = q.radius ? q.radius : 90;
    int th = q.thickness ? q.thickness : 14;
    lv_obj_t* box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, outer * 2, outer * 2);
    lv_obj_center(box);
    lv_obj_clear_flag(box, LV_OBJ_FLAG_SCROLLABLE);
    for (int t = 0; t < c.track_count; t++) {
        int r = ring_track_radius(t, outer, th, 4);
        lv_obj_t* arc = lv_arc_create(box);
        lv_obj_set_size(arc, r * 2, r * 2);
        lv_obj_center(arc);
        lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
        lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
        lv_arc_set_bg_angles(arc, 90, 90 + 359);   // anneau quasi complet ; ajuster si gap voulu
        lv_arc_set_range(arc, c.tracks[t].vmin, c.tracks[t].vmax);
        lv_obj_set_style_arc_width(arc, th, LV_PART_MAIN);
        lv_obj_set_style_arc_width(arc, th, LV_PART_INDICATOR);
        lv_obj_set_style_arc_color(arc, lv_color_hex(0x1F2937), LV_PART_MAIN);
        lv_obj_set_style_arc_color(arc, lv_color_hex(c.tracks[t].color), LV_PART_INDICATOR);
        lv_obj_set_style_pad_all(arc, 0, LV_PART_MAIN);
        lv_obj_set_style_arc_rounded(arc, true, LV_PART_INDICATOR);
    }
    *main = box;
}
static void sync_rings(Component& c, Placement&, lv_obj_t* box, lv_obj_t*, lv_obj_t*) {
    for (int t = 0; t < c.track_count && t < (int)lv_obj_get_child_count(box); t++)
        lv_arc_set_value(lv_obj_get_child(box, t), c.tracks[t].value);
}

// --- chart : l'historique vit dans le modèle (Component.hist) ; build crée le widget,
// sync mirroir hist -> y_points (lv_chart_set_next_value n'est PAS idempotent). ---
static void build_chart(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* chart = lv_chart_create(parent);
    lv_obj_set_size(chart, q.width ? q.width : 200, q.height ? q.height : 100);
    lv_chart_set_type(chart, LV_CHART_TYPE_LINE);
    int n = c.chart_points;
    if (n > CHART_MAX_POINTS) n = CHART_MAX_POINTS;
    if (n < 1) n = 1;
    lv_chart_set_point_count(chart, n);
    lv_chart_set_range(chart, LV_CHART_AXIS_PRIMARY_Y, c.vmin, c.vmax);
    lv_chart_add_series(chart, lv_color_hex(c.color), LV_CHART_AXIS_PRIMARY_Y);
    lv_obj_align(chart, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = chart;
}
static void sync_chart(Component& c, Placement&, lv_obj_t* chart, lv_obj_t*, lv_obj_t*) {
    lv_chart_series_t* ser = lv_chart_get_series_next(chart, NULL);   // pas de stockage : on relit la 1re série
    if (!ser) return;
    int n = c.chart_points;
    if (n > CHART_MAX_POINTS) n = CHART_MAX_POINTS;
    if (n < 1) n = 1;
    for (int i = 0; i < n; i++)
        lv_chart_set_value_by_id(chart, ser, i, (i < c.hist_count) ? c.hist[i] : LV_CHART_POINT_NONE);
    lv_chart_refresh(chart);
}

// --- meter : jauge à aiguille via lv_scale (lv_meter supprimé en LVGL 9).
// Aiguille = lv_line enfant ; handle stocké dans sub1 (lv_obj_t* réel). ---
static void build_meter(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* scale = lv_scale_create(parent);
    int sz = q.width ? q.width : 160;
    lv_obj_set_size(scale, sz, q.height ? q.height : sz);
    lv_scale_set_mode(scale, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_total_tick_count(scale, 21);
    lv_scale_set_major_tick_every(scale, 5);
    lv_scale_set_label_show(scale, true);
    lv_scale_set_range(scale, c.vmin, c.vmax);
    lv_scale_set_angle_range(scale, 270);   // arc 270° ...
    lv_scale_set_rotation(scale, 135);      // ... ouvert en bas

    // zones d'arc depuis thresholds : bande i = (prev, limit[i]] couleur i ; prev démarre à vmin
    int prev = c.vmin;
    int idx  = q.comp_index;
    for (int i = 0; i < c.threshold_count && i < MAX_THRESHOLDS; i++) {
        lv_scale_section_t* sec = lv_scale_add_section(scale);
        lv_scale_set_section_range(scale, sec, prev, (int)c.thresholds[i].limit);
        if (idx >= 0 && idx < MAX_COMPONENTS) {
            if (!s_meter_section_init[idx][i]) {
                lv_style_init(&s_meter_section_style[idx][i]);
                s_meter_section_init[idx][i] = true;
            }
            // Un style par bande -> tricolore (vert/orange/rouge) préservé.
            lv_style_set_arc_color(&s_meter_section_style[idx][i],
                                   lv_color_hex(c.thresholds[i].color));
            lv_scale_set_section_style_main(scale, sec, &s_meter_section_style[idx][i]);
        }
        prev = (int)c.thresholds[i].limit;
    }

    lv_obj_t* needle = lv_line_create(scale);
    lv_obj_set_style_line_width(needle, 4, LV_PART_MAIN);
    lv_obj_set_style_line_color(needle, lv_color_hex(c.color), LV_PART_MAIN);
    lv_obj_set_style_line_rounded(needle, true, LV_PART_MAIN);
    lv_scale_set_line_needle_value(scale, needle, sz / 2 - 10, c.value);

    lv_obj_align(scale, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = scale;
    *sub1 = needle;   // handle aiguille (lv_obj_t* réel) pour sync
}
static void sync_meter(Component& c, Placement&, lv_obj_t* scale, lv_obj_t* sub1, lv_obj_t*) {
    if (sub1) {
        int sz = lv_obj_get_width(scale);
        lv_scale_set_line_needle_value(scale, sub1, sz / 2 - 10, c.value);
    }
}

static void build_image(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* img = lv_image_create(parent);
    int idx = q.comp_index;
    if (idx >= 0 && idx < MAX_COMPONENTS && s_img_buf[idx]) {
        lv_image_set_src(img, &s_img_dsc[idx]);     // lv_img dimensionne via header.w/h
    } else {
        // Asset non charge : placeholder borde a w×h (ou 120 par defaut).
        lv_obj_set_size(img, c.image_w > 0 ? c.image_w : 120, c.image_h > 0 ? c.image_h : 120);
        lv_obj_set_style_border_width(img, 1, 0);
        lv_obj_set_style_border_color(img, lv_color_hex(0x4B5563), 0);
        lv_obj_set_style_border_opa(img, LV_OPA_COVER, 0);
    }
    lv_obj_align(img, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = img;
}

static void build_image_anim(lv_obj_t* parent, Component& c, Placement& q,
                             lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* img = lv_image_create(parent);
    int idx = q.comp_index;
    if (idx >= 0 && idx < MAX_COMPONENTS && s_aimg_buf[idx] && s_aimg_dsc[idx]) {
        int fr = c.value;
        if (fr < 0 || fr >= c.aimg_frames) fr = 0;
        lv_image_set_src(img, &s_aimg_dsc[idx][fr]);
    } else {                                              // asset non charge : placeholder borde
        lv_obj_set_size(img, c.image_w > 0 ? c.image_w : 120, c.image_h > 0 ? c.image_h : 120);
        lv_obj_set_style_border_width(img, 1, 0);
        lv_obj_set_style_border_color(img, lv_color_hex(0x4B5563), 0);
        lv_obj_set_style_border_opa(img, LV_OPA_COVER, 0);
    }
    lv_obj_align(img, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = img;
}
static void sync_image_anim(Component& c, Placement& q, lv_obj_t* main, lv_obj_t*, lv_obj_t*) {
    int idx = q.comp_index;
    if (idx < 0 || idx >= MAX_COMPONENTS || !s_aimg_buf[idx] || !s_aimg_dsc[idx]) return;
    int fr = c.value;
    if (fr < 0 || fr >= c.aimg_frames) fr = 0;
    lv_image_set_src(main, &s_aimg_dsc[idx][fr]);           // dsc distinct/frame -> refresh garanti
}

// led : voyant réaliste. Dôme = bg_grad radial recolorié par luminance (lv_led) ; glow = shadow
// (auto-atténué par brightness) ; bezel = bordure ; reflet = objet enfant (sub1). Constantes maison
// alignées sur buildLed (designer). Valeurs de départ à ajuster sur device (Task 4).
static void build_led(lv_obj_t* parent, Component& c, Placement& q,
                      lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* led = lv_led_create(parent);
    int sz = q.size ? q.size : 24;
    lv_obj_set_size(led, sz, sz);
    int idx = q.comp_index;

    // Dôme : gradient radial (centre 38%/30%). Stops = profil de luminance (clair centre -> mi-sombre
    // bord) ; lv_led applique la teinte (lv_led_set_color) et module par la brightness.
    if (idx >= 0 && idx < MAX_COMPONENTS) {
        lv_grad_dsc_t* g = &s_led_dome_grad[idx];
        lv_grad_radial_init(g, lv_pct(38), lv_pct(30), lv_pct(100), lv_pct(100), LV_GRAD_EXTEND_PAD);
        lv_color_t cols[2] = { lv_color_white(), lv_color_hex(0x6E6E6E) };
        uint8_t fr[2] = { 0, 255 };
        lv_grad_init_stops(g, cols, NULL, fr, 2);
        lv_obj_set_style_bg_grad(led, g, LV_PART_MAIN);
    }

    lv_led_set_color(led, lv_color_hex(threshold_color(c.thresholds, c.threshold_count, c.value, c.color)));

    // Glow : shadow blanc (recoloré en teinte par lv_led, atténué par brightness). 0 si désactivé.
    if (c.led_glow) {
        lv_obj_set_style_shadow_width(led, 20, LV_PART_MAIN);
        lv_obj_set_style_shadow_spread(led, 5, LV_PART_MAIN);
        lv_obj_set_style_shadow_color(led, lv_color_white(), LV_PART_MAIN);
    } else {
        lv_obj_set_style_shadow_width(led, 0, LV_PART_MAIN);
    }

    // Bezel : bordure sombre encastrée.
    if (c.led_bezel) {
        lv_obj_set_style_border_width(led, 2, LV_PART_MAIN);
        lv_obj_set_style_border_color(led, lv_color_hex(0x000000), LV_PART_MAIN);
        lv_obj_set_style_border_opa(led, LV_OPA_40, LV_PART_MAIN);
    } else {
        lv_obj_set_style_border_width(led, 0, LV_PART_MAIN);
    }

    if (led_is_lit(c.value, c.off_below)) lv_led_on(led); else lv_led_off(led);
    lv_obj_align(led, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = led;

    // Reflet spéculaire : objet enfant décoratif (Ø 24 %, point lumineux 38%/30%).
    if (c.led_specular && idx >= 0 && idx < MAX_COMPONENTS) {
        int ssz = sz * 24 / 100; if (ssz < 2) ssz = 2;
        lv_obj_t* sp = lv_obj_create(led);
        lv_obj_remove_style_all(sp);
        lv_obj_set_size(sp, ssz, ssz);
        lv_obj_set_pos(sp, sz * 38 / 100 - ssz / 2, sz * 30 / 100 - ssz / 2);
        lv_obj_set_style_radius(sp, LV_RADIUS_CIRCLE, 0);
        lv_obj_remove_flag(sp, LV_OBJ_FLAG_CLICKABLE);
        lv_grad_dsc_t* sg = &s_led_spec_grad[idx];
        lv_grad_radial_init(sg, lv_pct(50), lv_pct(50), lv_pct(100), lv_pct(100), LV_GRAD_EXTEND_PAD);
        lv_color_t scol[2] = { lv_color_white(), lv_color_white() };
        lv_opa_t   sopa[2] = { LV_OPA_COVER, LV_OPA_TRANSP };
        uint8_t    sfr[2]  = { 0, 255 };
        lv_grad_init_stops(sg, scol, sopa, sfr, 2);
        lv_obj_set_style_bg_grad(sp, sg, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(sp, LV_OPA_COVER, LV_PART_MAIN);
        *sub1 = sp;
    } else {
        *sub1 = nullptr;
    }
}
static void sync_led(Component& c, Placement&, lv_obj_t* w, lv_obj_t* sub1, lv_obj_t*) {
    bool lit = led_is_lit(c.value, c.off_below);
    lv_led_set_color(w, lv_color_hex(threshold_color(c.thresholds, c.threshold_count, c.value, c.color)));
    if (lit) lv_led_on(w); else lv_led_off(w);
    // Reflet : visible allumé ; éteint, faible si off_glass, sinon masqué. (opacité ≈ constantes 0.62 / 0.12)
    if (sub1) {
        if (lit) { lv_obj_remove_flag(sub1, LV_OBJ_FLAG_HIDDEN); lv_obj_set_style_opa(sub1, 158, 0); }       // ~0.62
        else if (c.led_off_glass) { lv_obj_remove_flag(sub1, LV_OBJ_FLAG_HIDDEN); lv_obj_set_style_opa(sub1, 31, 0); } // ~0.12
        else lv_obj_add_flag(sub1, LV_OBJ_FLAG_HIDDEN);
    }
}

// Formes decoratives : lv_obj style (rect/circle) ou lv_line (line). Statiques (sync=nullptr).
static void build_rect(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(o, q.width > 0 ? q.width : 120, q.height > 0 ? q.height : 60);
    lv_obj_set_style_radius(o, q.radius > 0 ? q.radius : 0, LV_PART_MAIN);
    if (c.fill_set) {
        lv_obj_set_style_bg_color(o, lv_color_hex(c.fill), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    } else {
        lv_obj_set_style_bg_opa(o, LV_OPA_TRANSP, LV_PART_MAIN);
    }
    if (c.border_width > 0) {
        lv_obj_set_style_border_width(o, c.border_width, LV_PART_MAIN);
        lv_obj_set_style_border_color(o, lv_color_hex(c.border_color), LV_PART_MAIN);
        lv_obj_set_style_border_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    }
    lv_obj_align(o, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = o;
}

static void build_circle(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    int d = q.size > 0 ? q.size : 60;
    lv_obj_set_size(o, d, d);
    lv_obj_set_style_radius(o, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    if (c.fill_set) {
        lv_obj_set_style_bg_color(o, lv_color_hex(c.fill), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    } else {
        lv_obj_set_style_bg_opa(o, LV_OPA_TRANSP, LV_PART_MAIN);
    }
    if (c.border_width > 0) {
        lv_obj_set_style_border_width(o, c.border_width, LV_PART_MAIN);
        lv_obj_set_style_border_color(o, lv_color_hex(c.border_color), LV_PART_MAIN);
        lv_obj_set_style_border_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    }
    lv_obj_align(o, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = o;
}

static void build_line(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* o = lv_line_create(parent);
    lv_obj_remove_style_all(o);
    int len = q.width > 0 ? q.width : 80;
    int th  = q.thickness > 0 ? q.thickness : 2;
    lv_point_precise_t* pts = s_line_pts[s_cur_page][s_cur_place];
    pts[0].x = 0; pts[0].y = 0;
    if (c.bar_vertical) { pts[1].x = 0;   pts[1].y = len; lv_obj_set_size(o, th, len); }
    else                { pts[1].x = len; pts[1].y = 0;   lv_obj_set_size(o, len, th); }
    lv_line_set_points(o, pts, 2);
    lv_obj_set_style_line_width(o, th, LV_PART_MAIN);
    lv_obj_set_style_line_color(o, lv_color_hex(c.color), LV_PART_MAIN);
    lv_obj_set_style_line_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_line_rounded(o, c.line_rounded, LV_PART_MAIN);
    if (c.line_dash == LINE_DASHED) {
        lv_obj_set_style_line_dash_width(o, 10, LV_PART_MAIN);
        lv_obj_set_style_line_dash_gap(o, 6, LV_PART_MAIN);
    } else if (c.line_dash == LINE_DOTTED) {
        lv_obj_set_style_line_dash_width(o, 2, LV_PART_MAIN);
        lv_obj_set_style_line_dash_gap(o, 4, LV_PART_MAIN);
    }
    lv_obj_align(o, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = o;
}

// Icone : lv_label en police de symboles. Glyphe + couleur resolus depuis la valeur (icon_resolve).
static void build_icon(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, get_icon_font(c.font), 0);
    uint16_t sym; uint32_t col;
    icon_resolve(c.icon_states, c.icon_state_count, (float)c.value, c.icon_symbol, c.color, &sym, &col);
    lv_obj_set_style_text_color(l, lv_color_hex(col), 0);
    lv_label_set_text(l, ICON_GLYPHS[sym]);
    lv_obj_align(l, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = l;
}
static void sync_icon(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    uint16_t sym; uint32_t col;
    icon_resolve(c.icon_states, c.icon_state_count, (float)c.value, c.icon_symbol, c.color, &sym, &col);
    lv_obj_set_style_text_color(w, lv_color_hex(col), 0);
    lv_label_set_text(w, ICON_GLYPHS[sym]);
}

// Effecteurs : premiers composants interactifs. user_data = &c (ré-assigné à chaque rebuild),
// lu par le callback tactile pour retrouver bind/set_value. Style LVGL par défaut (thème checked).
// Callbacks définis plus bas (zone gesture, avec s_dash) -> déclarés ici pour build_*.
static void switch_event_cb(lv_event_t* e);
static void button_event_cb(lv_event_t* e);
static void slider_event_cb(lv_event_t* e);
static void arc_event_cb(lv_event_t* e);
static void roller_event_cb(lv_event_t* e);
static void stepper_minus_cb(lv_event_t* e);
static void stepper_plus_cb(lv_event_t* e);
static void segmented_event_cb(lv_event_t* e);

// Reflets d'effecteurs différés pendant l'appui : un sync_* sous LV_STATE_PRESSED n'arrache pas le doigt
// mais NE DOIT PAS perdre la valeur du contexte. On enregistre le composant ici ; view_sync le re-marque
// dirty après le clear groupé -> il est réappliqué dès la relâche (au lieu d'attendre la valeur distincte
// suivante). Un seul doigt en pratique ; le tableau majore. Réinitialisé à chaque view_sync.
static Component* s_deferred[8];
static int        s_deferred_n = 0;
static void defer_sync(Component& c) {
    if (s_deferred_n < (int)(sizeof(s_deferred) / sizeof(s_deferred[0]))) s_deferred[s_deferred_n++] = &c;
}

static void build_switch(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* sw = lv_switch_create(parent);
    if (q.width || q.height) lv_obj_set_size(sw, q.width ? q.width : 60, q.height ? q.height : 30);
    lv_obj_align(sw, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(sw, &c);
    lv_obj_add_event_cb(sw, switch_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = sw;
}
static void sync_switch(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (c.value) lv_obj_add_state(w, LV_STATE_CHECKED);     // reflet (lv_obj_add_state n'émet pas VALUE_CHANGED)
    else         lv_obj_remove_state(w, LV_STATE_CHECKED);
}
static void build_button(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* b = lv_button_create(parent);
    if (q.width || q.height) lv_obj_set_size(b, q.width ? q.width : 100, q.height ? q.height : 44);
    lv_obj_align(b, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(b, &c);
    lv_obj_add_event_cb(b, button_event_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* lbl = lv_label_create(b);
    lv_obj_set_style_text_font(lbl, get_font(c.font_family, c.font, c.bold, c.italic), 0);
    lv_obj_set_style_text_color(lbl, lv_color_hex(0xFFFFFF), 0);
    lv_label_set_text(lbl, c.text);
    lv_obj_center(lbl);
    *main = b;
    *sub1 = lbl;
}
static void sync_button(Component& c, Placement&, lv_obj_t* w, lv_obj_t* sub1, lv_obj_t*) {
    if (c.value) lv_obj_add_state(w, LV_STATE_CHECKED);     // reflet radio : surbrillance si ctx == value
    else         lv_obj_remove_state(w, LV_STATE_CHECKED);
    if (sub1) lv_label_set_text(sub1, c.text);              // libellé pilotable via /update text
}
static void build_slider(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* s = lv_slider_create(parent);
    lv_obj_set_size(s, q.width ? q.width : 200, q.height ? q.height : 16);
    lv_slider_set_range(s, c.vmin, c.vmax);
    lv_slider_set_orientation(s, c.bar_vertical ? LV_SLIDER_ORIENTATION_VERTICAL
                                                : LV_SLIDER_ORIENTATION_HORIZONTAL);
    lv_obj_set_style_bg_color(s, lv_color_hex(c.color), LV_PART_INDICATOR);
    lv_obj_align(s, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(s, &c);
    lv_obj_add_event_cb(s, slider_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = s;
}
static void sync_slider(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) { defer_sync(c); return; }   // anti-conflit : ne pas arracher le doigt (reflet différé à la relâche)
    lv_slider_set_value(w, c.value, LV_ANIM_OFF);
}
static void build_arc(lv_obj_t* parent, Component& c, Placement& q,
                      lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* a = lv_arc_create(parent);
    int d = q.radius ? q.radius * 2 : 160;
    lv_obj_set_size(a, d, d);
    lv_obj_align(a, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_arc_set_range(a, c.vmin, c.vmax);
    lv_arc_set_bg_angles(a, 90 + q.start_angle + q.gap_deg / 2,
                            90 + q.start_angle - q.gap_deg / 2);
    lv_obj_set_style_arc_width(a, q.thickness, LV_PART_MAIN);
    lv_obj_set_style_arc_width(a, q.thickness, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(a, lv_color_hex(0x1F2937), LV_PART_MAIN);
    lv_obj_set_style_arc_color(a, lv_color_hex(c.color), LV_PART_INDICATOR);
    lv_obj_set_user_data(a, &c);                          // knob conservé (input), CLICKABLE gardé
    lv_obj_add_event_cb(a, arc_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = a;
}
static void sync_arc(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) { defer_sync(c); return; }
    lv_arc_set_value(w, c.value);
}
static void build_roller(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* r = lv_roller_create(parent);
    lv_roller_set_options(r, c.roller_options, LV_ROLLER_MODE_NORMAL);
    lv_roller_set_visible_row_count(r, c.roller_rows ? c.roller_rows : 3);
    if (q.width) lv_obj_set_width(r, q.width);
    lv_obj_align(r, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(r, &c);
    lv_obj_add_event_cb(r, roller_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = r;
}
static void sync_roller(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) { defer_sync(c); return; }
    uint32_t cnt = lv_roller_get_option_count(w);
    int32_t idx = c.value < 0 ? 0 : c.value;
    if (cnt && idx >= (int32_t)cnt) idx = (int32_t)cnt - 1;   // clamp au dernier : évite le wrap uint16 sur une valeur aberrante (ctx externe)
    lv_roller_set_selected(w, (uint16_t)idx, LV_ANIM_OFF);
}
// segmented : choix exclusif entre 2-4 segments (lv_buttonmatrix en mode "one checked"), écrit l'index.
// Réutilise c.roller_options (segments séparés par '\n', comme le roller) et c.value (index sélectionné).
static int seg_build_map(int idx, const char* options) {
    strlcpy(s_seg_buf[idx], options, ROLLER_OPTS_LEN);
    int n = 0; char* p = s_seg_buf[idx];
    s_seg_map[idx][n++] = p;
    // Garde de boucle n <= MAX_SEG_OPTS (le \n du dernier segment retenu peut encore être vu) mais
    // garde de stockage n < MAX_SEG_OPTS : borne le nombre de segments à MAX_SEG_OPTS sans écraser
    // la case sentinelle. Les segments au-delà sont ignorés (leur \n n'est pas coupé).
    for (; *p && n <= MAX_SEG_OPTS; p++) {
        if (*p == '\n') { *p = '\0'; if (n < MAX_SEG_OPTS) s_seg_map[idx][n++] = p + 1; }
    }
    s_seg_map[idx][n] = "";     // sentinelle fin de map
    s_seg_n[idx] = (uint8_t)n;
    return n;
}
static void build_segmented(lv_obj_t* parent, Component& c, Placement& q,
                            lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* bm = lv_buttonmatrix_create(parent);
    int idx = q.comp_index;
    int n = (idx >= 0 && idx < MAX_COMPONENTS) ? seg_build_map(idx, c.roller_options) : 0;
    if (n > 0) lv_buttonmatrix_set_map(bm, s_seg_map[idx]);
    lv_buttonmatrix_set_one_checked(bm, true);
    for (int i = 0; i < n; i++) {
        lv_buttonmatrix_set_button_ctrl(bm, i, LV_BUTTONMATRIX_CTRL_CHECKABLE);
        lv_buttonmatrix_set_button_ctrl(bm, i, LV_BUTTONMATRIX_CTRL_CLICK_TRIG);   // commit à la relâche (set_button_ctrl OR les bits) : évite un commit au touch-down pendant un swipe de navigation
    }
    int sel = segmented_clamp(c.value, n);
    if (n > 0) lv_buttonmatrix_set_button_ctrl(bm, sel, LV_BUTTONMATRIX_CTRL_CHECKED);
    lv_obj_set_size(bm, q.width ? q.width : 240, q.height ? q.height : 56);
    lv_obj_align(bm, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(bm, &c);
    lv_obj_add_event_cb(bm, segmented_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = bm;
}
static void sync_segmented(Component& c, Placement& q, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) { defer_sync(c); return; }
    int idx = q.comp_index;
    int n = (idx >= 0 && idx < MAX_COMPONENTS) ? s_seg_n[idx] : 0;
    int sel = segmented_clamp(c.value, n);
    if (n > 0) lv_buttonmatrix_set_button_ctrl(w, sel, LV_BUTTONMATRIX_CTRL_CHECKED);
}
static void stepper_label_text(Component& c, char* out, size_t n) {
    if (c.unit[0]) snprintf(out, n, "%d%s", (int)c.value, c.unit);
    else           snprintf(out, n, "%d", (int)c.value);
}
static void build_stepper(lv_obj_t* parent, Component& c, Placement& q,
                          lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, q.width ? q.width : 200, q.height ? q.height : 80);
    lv_obj_set_flex_flow(box, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(box, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_align(box, ALIGN_MAP[q.anchor], q.dx, q.dy);
    int bs = q.height ? q.height : 80;                       // boutons carrés = hauteur du conteneur -> cible tactile franche
    const lv_font_t* bf = get_font(c.font_family, c.font, c.bold, c.italic);
    lv_obj_t* minus = lv_button_create(box);
    lv_obj_set_size(minus, bs, bs);
    lv_obj_set_user_data(minus, &c);
    lv_obj_add_event_cb(minus, stepper_minus_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* ml = lv_label_create(minus); lv_label_set_text(ml, "-");
    lv_obj_set_style_text_font(ml, bf, 0); lv_obj_center(ml);
    lv_obj_t* val = lv_label_create(box);
    lv_obj_set_style_text_font(val, bf, 0);
    lv_obj_set_style_text_color(val, lv_color_hex(c.color), 0);
    char b[24]; stepper_label_text(c, b, sizeof(b)); lv_label_set_text(val, b);
    lv_obj_t* plus = lv_button_create(box);
    lv_obj_set_size(plus, bs, bs);
    lv_obj_set_user_data(plus, &c);
    lv_obj_add_event_cb(plus, stepper_plus_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* pl = lv_label_create(plus); lv_label_set_text(pl, "+");
    lv_obj_set_style_text_font(pl, bf, 0); lv_obj_center(pl);
    *main = box;
    *sub1 = val;   // le label central (sync)
}
static void sync_stepper(Component& c, Placement&, lv_obj_t*, lv_obj_t* val, lv_obj_t*) {
    if (val) { char b[24]; stepper_label_text(c, b, sizeof(b)); lv_label_set_text(val, b); }
}

// clock : cadran analogique (conteneur + 4 ticks cardinaux décoratifs + aiguilles lv_line)
// ou digital (label HH:MM[:SS]). Heure lue sur le device (NTP, cf. configTzTime au boot) ;
// tant que non synchronisée (epoch < ~2023), digital affiche "--:--" et analogique ne bouge pas.
static void build_clock(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    if (!c.clock_analog) {                                   // DIGITAL
        lv_obj_t* l = lv_label_create(parent);
        lv_obj_set_style_text_font(l, get_font(c.font_family, c.font, c.bold, c.italic), 0);
        lv_obj_set_style_text_color(l, lv_color_hex(c.color), 0);
        lv_label_set_text(l, "--:--");
        lv_obj_align(l, ALIGN_MAP[q.anchor], q.dx, q.dy);
        *main = l;
        return;
    }
    int r = q.radius ? q.radius : 80;
    lv_obj_t* box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, r * 2, r * 2);
    lv_obj_center(box);
    lv_obj_clear_flag(box, LV_OBJ_FLAG_SCROLLABLE);
    // 4 ticks cardinaux (décoratifs, non synchronisés) : petits rectangles au bord du cadran.
    static const lv_align_t TICK_ALIGN[4] = {
        LV_ALIGN_TOP_MID, LV_ALIGN_BOTTOM_MID, LV_ALIGN_LEFT_MID, LV_ALIGN_RIGHT_MID
    };
    for (int i = 0; i < 4; i++) {
        lv_obj_t* tick = lv_obj_create(box);
        lv_obj_remove_style_all(tick);
        lv_obj_set_style_bg_color(tick, lv_color_hex(c.color), 0);
        lv_obj_set_style_bg_opa(tick, LV_OPA_COVER, 0);
        bool vertical = (i < 2);   // top/bottom : marque radiale verticale ; left/right : horizontale
        lv_obj_set_size(tick, vertical ? 4 : 10, vertical ? 10 : 4);
        lv_obj_align(tick, TICK_ALIGN[i], 0, 0);
    }
    // Aiguilles = derniers enfants du conteneur (après les 4 ticks) -> sync_clock les retrouve
    // par la fin (child0 = child_count - nlines). Points stockés par placement (s_cur_page/place).
    lv_point_precise_t (*pts)[2] = s_clock_pts[s_cur_page][s_cur_place];
    int nlines = c.show_seconds ? 3 : 2;
    for (int k = 0; k < nlines; k++) {
        lv_obj_t* ln = lv_line_create(box);
        lv_obj_set_style_line_width(ln, k == 0 ? 6 : (k == 1 ? 4 : 2), 0);
        lv_obj_set_style_line_color(ln, lv_color_hex(k == 2 ? 0x38BDF8 : c.color), 0);   // k==2 : accent trotteuse (voulu)
        lv_obj_set_style_line_rounded(ln, true, 0);
        pts[k][0] = (lv_point_precise_t){ (lv_value_precise_t)r, (lv_value_precise_t)r };
        pts[k][1] = (lv_point_precise_t){ (lv_value_precise_t)r, (lv_value_precise_t)r };
        lv_line_set_points(ln, pts[k], 2);
    }
    *main = box;
}
static void sync_clock(Component& c, Placement& q, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    time_t now = time(nullptr);
    struct tm tm; localtime_r(&now, &tm);
    bool synced = (now > 1700000000);   // epoch grossier : NTP pas encore obtenu tant que < ~nov. 2023
    if (!c.clock_analog) {
        if (!synced) { lv_label_set_text(w, "--:--"); return; }
        char buf[24];
        clock_format_digital(tm.tm_hour, tm.tm_min, tm.tm_sec, c.show_seconds, buf, sizeof(buf));
        lv_label_set_text(w, buf);
        return;
    }
    if (!synced) return;
    int r = q.radius ? q.radius : 80;
    lv_point_precise_t (*pts)[2] = s_clock_pts[s_cur_page][s_cur_place];   // même placement qu'au build
    float ah, am, as; clock_hand_angles(tm.tm_hour, tm.tm_min, tm.tm_sec, &ah, &am, &as);
    const float DEG2RAD = (float)M_PI / 180.0f;
    struct { float deg; float len; } hands[3] = {
        { ah, r * 0.5f }, { am, r * 0.72f }, { as, r * 0.8f },
    };
    int nlines = c.show_seconds ? 3 : 2;
    // Les aiguilles sont les nlines DERNIERS enfants du conteneur (les 4 ticks cardinaux
    // sont créés avant elles dans build_clock) -> on indexe depuis la fin.
    int child_count = lv_obj_get_child_count(w);
    if (child_count < nlines) return;   // garde : conteneur incomplet -> pas d'index négatif
    int child0 = child_count - nlines;
    for (int j = 0; j < nlines; j++) {
        float rad = hands[j].deg * DEG2RAD;
        pts[j][1].x = (lv_value_precise_t)(r + hands[j].len * sinf(rad));
        pts[j][1].y = (lv_value_precise_t)(r - hands[j].len * cosf(rad));
        lv_obj_t* ln = lv_obj_get_child(w, child0 + j);
        if (ln) lv_line_set_points(ln, pts[j], 2);
    }
}

// --- qr : affichage seul (lv_qrcode = lv_canvas). Texte = vstr (bind/push) ; vide -> URL device. ---
static void qr_effective_text(Component& c, char* out, size_t n) {
    if (c.vstr[0]) strlcpy(out, c.vstr, n);
    else snprintf(out, n, "http://%s.local", MDNS_HOST);   // vide -> URL device calculee
}
static void build_qr(lv_obj_t* parent, Component& c, Placement& q,
                     lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* qr = lv_qrcode_create(parent);
    int sz = q.size ? q.size : (q.width ? q.width : 140);
    lv_qrcode_set_size(qr, sz);
    lv_qrcode_set_dark_color(qr, lv_color_hex(c.color ? c.color : 0x05070D));
    lv_qrcode_set_light_color(qr, lv_color_hex(0xE8EEF7));   // clair fixe (parité designer ; seul `color` sombre est exposé)
    char txt[TEXT_LEN]; qr_effective_text(c, txt, sizeof(txt));
    lv_qrcode_update(qr, txt, strlen(txt));
    lv_obj_align(qr, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = qr;
}
static void sync_qr(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    char txt[TEXT_LEN]; qr_effective_text(c, txt, sizeof(txt));
    lv_qrcode_update(w, txt, strlen(txt));
}

// Vtable vue indexée par CompType. Types physiques (led_ring/sound) : build/sync = nullptr
// (rendus par leur tick dédié -> le moteur les saute). label/readout partagent build_text.
struct ViewVTable {
    void (*build)(lv_obj_t* parent, Component& c, Placement& q,
                  lv_obj_t** main, lv_obj_t** sub1, lv_obj_t** sub2);
    void (*sync)(Component& c, Placement& q,
                 lv_obj_t* main, lv_obj_t* sub1, lv_obj_t* sub2);
};
static const ViewVTable VIEW[] = {
    /* COMP_NONE     */ { nullptr,    nullptr      },
    /* COMP_LABEL    */ { build_text, sync_label   },
    /* COMP_READOUT  */ { build_text, sync_readout },
    /* COMP_BAR      */ { build_bar,  sync_bar     },
    /* COMP_RING     */ { build_ring, sync_ring    },
    /* COMP_LED_RING */ { nullptr,    nullptr      },
    /* COMP_SOUND    */ { nullptr,    nullptr      },
    /* COMP_CHART    */ { build_chart, sync_chart },
    /* COMP_METER    */ { build_meter, sync_meter },
    /* COMP_IMAGE    */ { build_image, nullptr     },
    /* COMP_IMAGE_ANIM */ { build_image_anim, sync_image_anim },
    /* COMP_LED      */ { build_led, sync_led },
    /* COMP_RECT     */ { build_rect,   nullptr },
    /* COMP_CIRCLE   */ { build_circle, nullptr },
    /* COMP_LINE     */ { build_line,   nullptr },
    /* COMP_ICON     */ { build_icon, sync_icon },
    /* COMP_SWITCH   */ { build_switch, sync_switch },
    /* COMP_BUTTON   */ { build_button, sync_button },
    /* COMP_SLIDER   */ { build_slider, sync_slider },
    /* COMP_ARC      */ { build_arc,    sync_arc    },
    /* COMP_ROLLER   */ { build_roller, sync_roller },
    /* COMP_CLOCK    */ { build_clock,  sync_clock  },
    /* COMP_RINGS    */ { build_rings,  sync_rings  },
    /* COMP_QR       */ { build_qr,     sync_qr     },
    /* COMP_STEPPER  */ { build_stepper, sync_stepper },
    /* COMP_SEGMENTED */ { build_segmented, sync_segmented },
};
static_assert(sizeof(VIEW) / sizeof(VIEW[0]) == COMP_COUNT,
              "VIEW desync avec CompType : ajoute la ligne du nouveau type");

// Swipe -> navigation. L'objet ecran persiste a travers les rebuilds (lv_obj_clean
// ne supprime que ses enfants), donc on n'enregistre le callback gesture qu'une fois.
// Dashboard actif courant : partagé par le callback de geste (nav) ET les callbacks d'effecteurs
// (button/switch). Reposé à chaque view_rebuild. L'écran persiste à travers les rebuilds.
static Dashboard* s_dash = nullptr;
static void gesture_cb(lv_event_t* e) {
    lv_dir_t dir = lv_indev_get_gesture_dir(lv_indev_active());
    if (!s_dash) return;
    // Seuls les swipes latéraux naviguent : droite = suivant, gauche = précédent.
    // Haut/bas volontairement ignorés (réservés à une future page de config par swipe haut).
    if (dir == LV_DIR_RIGHT)     nav_goto_dir(s_dash, +1, /*animate=*/true);
    else if (dir == LV_DIR_LEFT) nav_goto_dir(s_dash, -1, /*animate=*/true);
}

// Effecteurs : écriture d'origine UI. Tournent sur le thread UI (cœur 1, dans lv_timer_handler) ;
// prennent g_ctx_mutex en BLOQUANT (le mutex n'est jamais tenu pendant un HTTP -> attente brève)
// pour garantir l'écriture, puis dash_ctx_write_ui_* (écrit le ctx + arme les sinks observant la var).
static void switch_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;   // bind vide -> pas de var fantome (symetrie context_apply)
    bool on = lv_obj_has_state(w, LV_STATE_CHECKED);
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, on ? 1 : 0, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void button_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;   // bind vide -> pas de var fantome (symetrie context_apply)
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    if (c->momentary) {
        if (c->set_is_num) dash_ctx_pulse_num(s_dash, c->bind, c->set_value_num, millis());
        else               dash_ctx_pulse_str(s_dash, c->bind, c->set_value, millis());
    } else {
        if (c->set_is_num) dash_ctx_write_ui_num(s_dash, c->bind, c->set_value_num, millis());
        else               dash_ctx_write_ui_str(s_dash, c->bind, c->set_value, millis());
    }
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void slider_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    int32_t val = slider_quantize(lv_slider_get_value(w), c->vmin, c->vmax, c->step);
    c->value = val;   // suit le widget immédiatement (≠ lag context_apply 100 ms) -> reflet différé sans flicker à la relâche
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, val, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void arc_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    int32_t val = slider_quantize(lv_arc_get_value(w), c->vmin, c->vmax, c->step);
    c->value = val;   // idem slider : c.value suit le drag -> pas de flicker au relâchement
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, val, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void roller_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    uint16_t sel = lv_roller_get_selected(w);            // lecture widget hors mutex (comme slider/arc)
    c->value = (int32_t)sel;   // c.value suit la sélection -> pas de flicker au relâchement
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, (double)sel, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void segmented_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    uint32_t id = lv_buttonmatrix_get_selected_button(w);
    if (id == LV_BUTTONMATRIX_BUTTON_NONE) return;
    c->value = (int32_t)id;
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, (double)id, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void stepper_apply(Component* c, int dir) {
    if (!c || !s_dash) return;
    c->value = stepper_step(c->value, dir, c->step, c->vmin, c->vmax);
    if (c->bind[0]) {
        if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
        dash_ctx_write_ui_num(s_dash, c->bind, (double)c->value, millis());
        if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    }
    c->dirty = true; s_dash->values_dirty = true;   // met à jour le label central
}
static void stepper_minus_cb(lv_event_t* e) { stepper_apply((Component*)lv_obj_get_user_data(lv_event_get_target_obj(e)), -1); }
static void stepper_plus_cb(lv_event_t* e)  { stepper_apply((Component*)lv_obj_get_user_data(lv_event_get_target_obj(e)), +1); }

// Met à jour la coloration des points indicateurs sans toucher aux flags hidden des pages
// (partagé par la bascule instantanée et la transition animée).
static void set_dots_active(int idx) {
    if (!s_dots) return;
    uint32_t n = lv_obj_get_child_cnt(s_dots);
    for (uint32_t p = 0; p < n; p++)
        lv_obj_set_style_bg_color(lv_obj_get_child(s_dots, p),
            lv_color_hex((int)p == idx ? 0xE5E7EB : 0x374151), 0);
}

// --- Transition de page animée (swipe uniquement) ----------------------------------------
// Choix d'archi : PAS de lv_scr_load_anim. Ici une « page » n'est pas un écran mais un conteneur
// plein écran déjà construit (s_page_cont), montré/caché par view_show_page. On glisse donc le x
// du conteneur sortant et du conteneur entrant — aucune création d'écran, aucun framebuffer plein
// écran (les pages existent déjà). Une seule transition à la fois (état fichier-statique).
#define PAGE_ANIM_MS 260
static struct {
    lv_obj_t* in;        // conteneur entrant
    lv_obj_t* out;       // conteneur sortant
    int       in_base;   // ±largeur écran : position hors-champ de départ de l'entrant
    bool      active;
} s_pa = { nullptr, nullptr, 0, false };

// v : distance parcourue 0 -> W. Les deux conteneurs translatent ensemble du même offset.
static void page_anim_step(void*, int32_t v) {
    int off = (s_pa.in_base > 0) ? -v : v;            // 0 -> -in_base
    if (s_pa.in)  lv_obj_set_x(s_pa.in,  s_pa.in_base + off);
    if (s_pa.out) lv_obj_set_x(s_pa.out, off);
}

// État final propre : entrant à x=0 visible, sortant caché, x réinitialisés.
static void page_anim_done(lv_anim_t*) {
    if (s_pa.in)  lv_obj_set_x(s_pa.in, 0);
    if (s_pa.out) { lv_obj_set_x(s_pa.out, 0); lv_obj_add_flag(s_pa.out, LV_OBJ_FLAG_HIDDEN); }
    s_pa.in = s_pa.out = nullptr;
    s_pa.active = false;
}

// Solde immédiatement une transition en vol (avant un rebuild qui libère les conteneurs, ou avant
// une nouvelle transition) pour ne jamais référencer un objet translaté/libéré.
static void page_anim_settle() {
    if (!s_pa.active) return;
    lv_anim_del(&s_pa, page_anim_step);
    page_anim_done(nullptr);
}

void view_show_page_anim(Dashboard* d, int idx, int delta) {
    if (idx < 0 || idx >= d->page_count) return;
    if (d->page_count <= 1 || idx == d->active_page) { view_show_page(d, idx); return; }
    page_anim_settle();                                    // solde une transition précédente

    lv_obj_t* out = s_page_cont[d->active_page];
    lv_obj_t* in  = s_page_cont[idx];
    if (!in || !out) { view_show_page(d, idx); return; }   // sécurité : conteneurs absents

    const int W = lv_display_get_horizontal_resolution(NULL);
    // Le contenu suit le doigt : swipe droite (delta>0) -> tout glisse à droite, l'entrant arrive
    // depuis la GAUCHE ; swipe gauche -> entrant depuis la droite. (Un seul signe à inverser si l'on
    // préfère « suivant vient de la droite ».)
    s_pa.in_base = (delta > 0) ? -W : W;
    s_pa.in = in; s_pa.out = out; s_pa.active = true;

    // Bascule logique immédiate : view_sync et /status reflètent la page cible dès le début.
    d->active_page = idx;
    set_dots_active(idx);

    // Tous cachés sauf entrant + sortant (robustesse si un état a dérivé), puis positions de départ.
    for (int p = 0; p < d->page_count; p++)
        if (s_page_cont[p] && s_page_cont[p] != in && s_page_cont[p] != out)
            lv_obj_add_flag(s_page_cont[p], LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(in, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_x(in, s_pa.in_base);                        // entrant hors-champ avant la 1re frame
    lv_obj_set_x(out, 0);

    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, &s_pa);
    lv_anim_set_exec_cb(&a, page_anim_step);
    lv_anim_set_values(&a, 0, W);
    lv_anim_set_time(&a, PAGE_ANIM_MS);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_set_ready_cb(&a, page_anim_done);
    lv_anim_start(&a);
}

// Charge /bg/<cle>.565 en PSRAM et remplit s_bg_dsc[p]. false si pas de cle / fichier absent /
// mauvaise taille / alloc ratee -> on retombe alors sur la couleur de fond (deja posee).
static bool bg_load_page(Dashboard* d, int p) {
    const char* key = d->pages[p].background_image;
    if (!key[0]) return false;
    char path[40];
    snprintf(path, sizeof(path), "%s/%s.565", BG_DIR, key);
    File f = asset_open_read(path);
    if (!f) return false;
    if (f.size() != BG_IMG_BYTES) { f.close(); return false; }
    uint8_t* buf = (uint8_t*)heap_caps_malloc(BG_IMG_BYTES, MALLOC_CAP_SPIRAM);
    if (!buf) { f.close(); return false; }
    size_t rd = f.read(buf, BG_IMG_BYTES);
    f.close();
    if (rd != BG_IMG_BYTES) { heap_caps_free(buf); return false; }
    s_bg_buf[p] = buf;
    lv_image_dsc_t& dsc = s_bg_dsc[p];
    memset(&dsc, 0, sizeof(dsc));
    dsc.header.magic  = LV_IMAGE_HEADER_MAGIC;
    dsc.header.cf     = LV_COLOR_FORMAT_RGB565;
    dsc.header.stride = BG_IMG_W * 2;
    dsc.header.w   = BG_IMG_W;
    dsc.header.h   = BG_IMG_H;
    dsc.data       = buf;
    dsc.data_size  = BG_IMG_BYTES;
    return true;
}

// Charge /img/<src>.565a en PSRAM pour un composant image (RGB565A8, w×h lus du composant).
// Idempotent : un component partage sur plusieurs pages n'est charge qu'une fois. false si invalide.
static bool img_load_component(Dashboard* d, int idx) {
    if (idx < 0 || idx >= d->comp_count || idx >= MAX_COMPONENTS) return false;
    Component& c = d->components[idx];
    if (!c.image_src[0] || c.image_w <= 0 || c.image_h <= 0) return false;
    if (s_img_buf[idx]) return true;                      // deja charge
    size_t need = (size_t)c.image_w * c.image_h * IMG_PX_BYTES;
    if (need == 0 || need > (size_t)IMG_MAX_BYTES) return false;
    char path[40];
    snprintf(path, sizeof(path), "%s/%s.565a", IMG_DIR, c.image_src);
    File f = asset_open_read(path);
    if (!f) return false;
    if ((size_t)f.size() != need) { f.close(); return false; }
    uint8_t* buf = (uint8_t*)heap_caps_malloc(need, MALLOC_CAP_SPIRAM);
    if (!buf) { f.close(); return false; }
    size_t rd = f.read(buf, need);
    f.close();
    if (rd != need) { heap_caps_free(buf); return false; }
    s_img_buf[idx] = buf;
    lv_image_dsc_t& dsc = s_img_dsc[idx];
    memset(&dsc, 0, sizeof(dsc));
    dsc.header.magic  = LV_IMAGE_HEADER_MAGIC;
    dsc.header.cf     = LV_COLOR_FORMAT_RGB565A8;
    dsc.header.stride = c.image_w * 2;
    dsc.header.w   = c.image_w;
    dsc.header.h   = c.image_h;
    dsc.data       = buf;
    dsc.data_size  = need;
    return true;
}

// Charge /aimg/<src>.565p en PSRAM (pack RGB565A8 de N frames) et remplit N descripteurs.
// Idempotent. false si invalide (asset absent, dims/compte nuls, taille incoherente, alloc ratee).
static bool aimg_load_component(Dashboard* d, int idx) {
    if (idx < 0 || idx >= d->comp_count || idx >= MAX_COMPONENTS) return false;
    Component& c = d->components[idx];
    if (!c.image_src[0] || c.image_w <= 0 || c.image_h <= 0 || c.aimg_frames <= 0) return false;
    if (s_aimg_buf[idx]) return true;                      // deja charge
    if (c.aimg_frames > AIMG_MAX_FRAMES) return false;
    size_t frame_bytes = (size_t)c.image_w * c.image_h * AIMG_PX_BYTES;
    size_t need = frame_bytes * (size_t)c.aimg_frames;
    if (need == 0 || need > (size_t)AIMG_MAX_BYTES) return false;
    char path[40];
    snprintf(path, sizeof(path), "%s/%s.565p", AIMG_DIR, c.image_src);
    File f = asset_open_read(path);
    if (!f) return false;
    if ((size_t)f.size() != need) { f.close(); return false; }
    uint8_t* buf = (uint8_t*)heap_caps_malloc(need, MALLOC_CAP_SPIRAM);
    if (!buf) { f.close(); return false; }
    size_t rd = f.read(buf, need);
    f.close();
    if (rd != need) { heap_caps_free(buf); return false; }
    lv_image_dsc_t* dscs = (lv_image_dsc_t*)heap_caps_malloc(sizeof(lv_image_dsc_t) * (size_t)c.aimg_frames, MALLOC_CAP_SPIRAM);
    if (!dscs) { heap_caps_free(buf); return false; }
    for (int fr = 0; fr < c.aimg_frames; fr++) {
        lv_image_dsc_t& dsc = dscs[fr];
        memset(&dsc, 0, sizeof(dsc));
        dsc.header.magic  = LV_IMAGE_HEADER_MAGIC;
        dsc.header.cf     = LV_COLOR_FORMAT_RGB565A8;
        dsc.header.stride = c.image_w * 2;
        dsc.header.w   = c.image_w;
        dsc.header.h   = c.image_h;
        dsc.data       = buf + (size_t)fr * frame_bytes;
        dsc.data_size  = frame_bytes;
    }
    s_aimg_buf[idx] = buf;
    s_aimg_dsc[idx] = dscs;
    return true;
}

void view_rebuild(Dashboard* d) {
    page_anim_settle();                // annule une transition en vol avant de libérer les conteneurs
    lv_obj_t* scr = lv_scr_act();
    lv_obj_clean(scr);
    for (int i = 0; i < MAX_PAGES; i++) {
        if (s_bg_buf[i]) { heap_caps_free(s_bg_buf[i]); s_bg_buf[i] = nullptr; }
    }
    for (int i = 0; i < MAX_COMPONENTS; i++) {
        if (s_img_buf[i]) { heap_caps_free(s_img_buf[i]); s_img_buf[i] = nullptr; }
    }
    for (int i = 0; i < MAX_COMPONENTS; i++) {
        if (s_aimg_buf[i]) { heap_caps_free(s_aimg_buf[i]); s_aimg_buf[i] = nullptr; }
        if (s_aimg_dsc[i]) { heap_caps_free(s_aimg_dsc[i]); s_aimg_dsc[i] = nullptr; }
    }
    s_dots = nullptr;  // freed by lv_obj_clean above; drop stale pointer
    lv_obj_set_style_bg_color(scr, lv_color_hex(d->background), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    s_dash = d;
    static bool s_gesture_cb_added = false;
    if (!s_gesture_cb_added) {
        lv_obj_add_event_cb(scr, gesture_cb, LV_EVENT_GESTURE, nullptr);
        s_gesture_cb_added = true;
    }
    memset(s_page_cont, 0, sizeof(s_page_cont));
    memset(s_widget, 0, sizeof(s_widget));
    memset(s_sub1, 0, sizeof(s_sub1)); memset(s_sub2, 0, sizeof(s_sub2));

    for (int p = 0; p < d->page_count; p++) {
        lv_obj_t* cont = lv_obj_create(scr);
        lv_obj_remove_style_all(cont);
        lv_obj_set_size(cont, LV_PCT(100), LV_PCT(100));
        lv_obj_clear_flag(cont, LV_OBJ_FLAG_SCROLLABLE);
        // Fond par page : conteneur opaque (le fond fait partie de la page qui glisse au swipe) ;
        // background résolu = override de la page, sinon fond global (cf. dashboard parse).
        lv_obj_set_style_bg_color(cont, lv_color_hex(d->pages[p].background), 0);
        lv_obj_set_style_bg_opa(cont, LV_OPA_COVER, 0);
        if (bg_load_page(d, p))
            lv_obj_set_style_bg_img_src(cont, &s_bg_dsc[p], 0);   // image par-dessus la couleur
        s_page_cont[p] = cont;

        for (int i = 0; i < d->pages[p].place_count; i++) {
            Placement& q = d->pages[p].places[i];
            Component& c = d->components[q.comp_index];
            if (c.type == COMP_IMAGE) img_load_component(d, q.comp_index);
            if (c.type == COMP_IMAGE_ANIM) aimg_load_component(d, q.comp_index);
            s_cur_page = p; s_cur_place = i;   // pour build_line (points persistants par placement)
            if ((unsigned)c.type < COMP_COUNT && VIEW[c.type].build)
                VIEW[c.type].build(cont, c, q, &s_widget[p][i], &s_sub1[p][i], &s_sub2[p][i]);
        }
    }
    // points indicateurs (au-dessus des conteneurs de page)
    if (d->page_count > 1) {
        s_dots = lv_obj_create(scr);
        lv_obj_remove_style_all(s_dots);
        lv_obj_set_size(s_dots, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        lv_obj_set_flex_flow(s_dots, LV_FLEX_FLOW_ROW);
        lv_obj_set_style_pad_column(s_dots, 8, 0);
        lv_obj_align(s_dots, LV_ALIGN_BOTTOM_MID, 0, -10);
        for (int p = 0; p < d->page_count; p++) {
            lv_obj_t* dot = lv_obj_create(s_dots);
            lv_obj_remove_style_all(dot);
            lv_obj_set_size(dot, 9, 9);
            lv_obj_set_style_radius(dot, 5, 0);
            lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
            lv_obj_set_style_bg_color(dot, lv_color_hex(0x374151), 0);
        }
    }
    view_show_page(d, d->active_page);
    d->layout_dirty = false;
    for (int i = 0; i < d->comp_count; i++) d->components[i].dirty = true;
    view_sync(d);
}

void view_show_page(Dashboard* d, int idx) {
    if (idx < 0 || idx >= d->page_count) return;
    page_anim_settle();              // bascule instantanée : annule une transition glissée en vol
    d->active_page = idx;
    for (int p = 0; p < d->page_count; p++) {
        lv_obj_set_x(s_page_cont[p], 0);   // remet à plat un éventuel décalage laissé par l'anim
        if (p == idx) lv_obj_clear_flag(s_page_cont[p], LV_OBJ_FLAG_HIDDEN);
        else          lv_obj_add_flag(s_page_cont[p], LV_OBJ_FLAG_HIDDEN);
    }
    set_dots_active(idx);
}

void view_sync(Dashboard* d) {
    s_deferred_n = 0;   // collecté par les sync_* d'effecteurs sous PRESSED (ci-dessous)
    for (int p = 0; p < d->page_count; p++) {
        for (int i = 0; i < d->pages[p].place_count; i++) {
            Placement& q = d->pages[p].places[i];
            Component& c = d->components[q.comp_index];
            if (!c.dirty) continue;
            lv_obj_t* w = s_widget[p][i];
            if (!w) continue;
            // Commande universelle visible : montre/cache le composant ENTIER. Les sous-objets frères de w
            // (cap + centre du ring, libellé de la barre) sont suivis dans sub1/sub2 -> on bascule les
            // trois. (led_ring/sound : w == nullptr, déjà sautés ci-dessus ; le specular du led, enfant dans
            // sub1, est ré-affirmé par sync_led appelé juste après -> il a le dernier mot.)
            lv_obj_t* objs[3] = { w, s_sub1[p][i], s_sub2[p][i] };
            for (int k = 0; k < 3; k++) {
                if (!objs[k]) continue;
                if (c.visible) lv_obj_remove_flag(objs[k], LV_OBJ_FLAG_HIDDEN);
                else           lv_obj_add_flag(objs[k], LV_OBJ_FLAG_HIDDEN);
            }
            s_cur_page = p; s_cur_place = i;   // pour sync_clock (points persistants par placement, cf. build)
            if ((unsigned)c.type < COMP_COUNT && VIEW[c.type].sync)
                VIEW[c.type].sync(c, q, w, s_sub1[p][i], s_sub2[p][i]);
        }
    }
    for (int i = 0; i < d->comp_count; i++) d->components[i].dirty = false;
    d->values_dirty = false;
    // Reflets différés sous PRESSED : on re-marque dirty (le clear groupé vient de les effacer) pour
    // retenter au tour suivant -> la valeur du contexte est réappliquée dès que le doigt se lève.
    for (int k = 0; k < s_deferred_n; k++) s_deferred[k]->dirty = true;
    if (s_deferred_n) d->values_dirty = true;
}

// Écran de provisioning WiFi : montré une fois au boot (avant tout dashboard), donc c'est un vrai
// nouvel écran LVGL (pas un conteneur de plus dans le modèle multi-pages de view_rebuild, qui n'existe
// pas encore à ce stade). lv_timer_handler() force le rendu immédiat, comme ailleurs dans setup().
void view_show_provisioning(const char* ap_name) {
    lv_obj_t* scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x0B0F14), 0);

    lv_obj_t* box = lv_obj_create(scr);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, 300, 300);
    lv_obj_center(box);
    lv_obj_set_flex_flow(box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(box, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_obj_t* title = lv_label_create(box);
    lv_label_set_text(title, "Configuration WiFi");
    lv_obj_set_style_text_font(title, get_font(FAMILY_MONTSERRAT, 22, true, false), 0);
    lv_obj_set_style_text_color(title, lv_color_hex(0xE5E7EB), 0);

    lv_obj_t* ssid = lv_label_create(box);
    lv_label_set_text_fmt(ssid, "Rejoins le WiFi :\n%s", ap_name);
    lv_obj_set_style_text_align(ssid, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(ssid, lv_color_hex(0xE5E7EB), 0);

    lv_obj_t* hint = lv_label_create(box);
    lv_label_set_text(hint, "puis ouvre http://192.168.4.1");
    lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(hint, lv_color_hex(0xE5E7EB), 0);

    lv_screen_load(scr);
    lv_timer_handler();
}
