#include "clock_geom.h"
#include <unity.h>
#include <string.h>
#include "format.h"
#include "color.h"
#include "nav_logic.h"
#include "dashboard.h"
#include "context.h"
#include "asset_path.h"
#include "sink.h"
#include "wifi_list.h"
#include <ArduinoJson.h>
#include <stdio.h>
#include <stdlib.h>

static char buf[32];

void test_remaining_seconds(void)  { format_remaining(45, buf, sizeof(buf));    TEST_ASSERT_EQUAL_STRING("45s",  buf); }
void test_remaining_min_boundary(void){ format_remaining(60, buf, sizeof(buf)); TEST_ASSERT_EQUAL_STRING("1m",   buf); }
void test_remaining_minutes(void)  { format_remaining(50*60, buf, sizeof(buf)); TEST_ASSERT_EQUAL_STRING("50m",  buf); }
void test_remaining_hour(void)     { format_remaining(3600, buf, sizeof(buf));  TEST_ASSERT_EQUAL_STRING("1h00", buf); }
void test_remaining_h_m(void)      { format_remaining(6600, buf, sizeof(buf));  TEST_ASSERT_EQUAL_STRING("1h50", buf); }
void test_remaining_days(void)     { format_remaining(453600, buf, sizeof(buf));TEST_ASSERT_EQUAL_STRING("5j6h", buf); }
void test_remaining_zero(void)     { format_remaining(0, buf, sizeof(buf));     TEST_ASSERT_EQUAL_STRING("0s",   buf); }

void test_value_unit(void)    { format_value(42, "%",  buf, sizeof(buf)); TEST_ASSERT_EQUAL_STRING("42 %", buf); }
void test_value_float(void)   { format_value(9.2, "GB",buf, sizeof(buf)); TEST_ASSERT_EQUAL_STRING("9.2 GB", buf); }
void test_value_no_unit(void) { format_value(42, "",   buf, sizeof(buf)); TEST_ASSERT_EQUAL_STRING("42", buf); }

void test_hex_parse(void)     { TEST_ASSERT_EQUAL_HEX32(0x38BDF8, parse_hex_color("#38BDF8", 0)); }
void test_hex_no_hash(void)   { TEST_ASSERT_EQUAL_HEX32(0xA1B2C3, parse_hex_color("A1B2C3", 0)); }
void test_hex_fallback(void)  { TEST_ASSERT_EQUAL_HEX32(0x123456, parse_hex_color("nope", 0x123456)); }

void test_asset_read_sd_when_active_and_present(void) {
    TEST_ASSERT_EQUAL_INT(ASSET_SD, asset_source_for_read(true, true));
}
void test_asset_read_fallback_when_absent_on_sd(void) {
    TEST_ASSERT_EQUAL_INT(ASSET_LITTLEFS, asset_source_for_read(true, false));
}
void test_asset_read_littlefs_when_no_card(void) {
    TEST_ASSERT_EQUAL_INT(ASSET_LITTLEFS, asset_source_for_read(false, false));
    TEST_ASSERT_EQUAL_INT(ASSET_LITTLEFS, asset_source_for_read(false, true));
}
void test_asset_resolve_prefixes_on_sd(void) {
    char out[80];
    asset_resolve_path(out, sizeof(out), "/img/ab12.565a", true);
    TEST_ASSERT_EQUAL_STRING("/dialboard/img/ab12.565a", out);
}
void test_asset_resolve_bare_on_littlefs(void) {
    char out[80];
    asset_resolve_path(out, sizeof(out), "/bg/ab12.565", false);
    TEST_ASSERT_EQUAL_STRING("/bg/ab12.565", out);
}
void test_asset_resolve_truncates_gracefully(void) {
    char out[5];
    asset_resolve_path(out, sizeof(out), "/img/ab12.565a", true);
    TEST_ASSERT_EQUAL_INT('\0', out[4]);
}

void test_threshold_below(void) {
    Threshold t[3] = {{70,0x22C55E},{90,0xF59E0B},{100,0xEF4444}};
    TEST_ASSERT_EQUAL_HEX32(0x22C55E, threshold_color(t,3,63,0x000000));
}
void test_threshold_mid(void) {
    Threshold t[3] = {{70,0x22C55E},{90,0xF59E0B},{100,0xEF4444}};
    TEST_ASSERT_EQUAL_HEX32(0xF59E0B, threshold_color(t,3,85,0x000000));
}
void test_threshold_over(void) {
    Threshold t[3] = {{70,0x22C55E},{90,0xF59E0B},{100,0xEF4444}};
    TEST_ASSERT_EQUAL_HEX32(0xEF4444, threshold_color(t,3,95,0x000000));
}
static const char* LAYOUT_OK =
  "{\"title\":\"T\",\"background\":\"#0B0B0F\",\"nav\":{\"wrap\":true},"
  "\"components\":{"
    "\"w5h\":{\"type\":\"ring\",\"color\":\"#38BDF8\",\"countdown\":true,"
             "\"thresholds\":[[70,\"#22C55E\"],[90,\"#F59E0B\"]]},"
    "\"cpu\":{\"type\":\"readout\",\"label\":\"CPU\",\"unit\":\"%\"}},"
  "\"pages\":[{\"name\":\"usage\",\"place\":["
    "{\"ref\":\"w5h\",\"radius\":140,\"thickness\":16,\"gap_deg\":70},"
    "{\"ref\":\"cpu\",\"anchor\":\"CENTER\"}]}]}";

void test_layout_parse_counts(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_OK, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(2, d.comp_count);
    TEST_ASSERT_EQUAL_INT(1, d.page_count);
    TEST_ASSERT_EQUAL_INT(2, d.pages[0].place_count);
    TEST_ASSERT_TRUE(d.nav_wrap);
}
void test_page_background_override_and_inherit(void) {
    static const char* LAYOUT_PAGEBG =
      "{\"background\":\"#0B0B0F\",\"components\":{\"x\":{\"type\":\"label\",\"text\":\"hi\"}},"
      "\"pages\":[{\"name\":\"a\",\"place\":[]},"
                 "{\"name\":\"b\",\"background\":\"#102030\",\"place\":[]}]}";
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_PAGEBG, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(2, d.page_count);
    TEST_ASSERT_EQUAL_HEX32(0x0B0B0F, d.pages[0].background);   // sans override → fond global
    TEST_ASSERT_EQUAL_HEX32(0x102030, d.pages[1].background);   // override de page
}
void test_page_background_image_parsed(void) {
    Dashboard d = {}; char err[80];
    static const char* LAYOUT_BGI =
      "{\"background\":\"#000000\",\"components\":{\"x\":{\"type\":\"label\",\"text\":\"hi\"}},"
      "\"pages\":[{\"name\":\"a\",\"background_image\":\"abc123\",\"place\":[]},"
                 "{\"name\":\"b\",\"place\":[]},"
                 "{\"name\":\"c\",\"background_image\":\"../evil\",\"place\":[]}]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_BGI, err, sizeof(err)));
    TEST_ASSERT_EQUAL_STRING("abc123", d.pages[0].background_image);  // clé valide conservée
    TEST_ASSERT_EQUAL_STRING("",       d.pages[1].background_image);  // absente → vide
    TEST_ASSERT_EQUAL_STRING("",       d.pages[2].background_image);  // invalide → rejetée (vide)
}

void test_layout_types_and_geom(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    int iw = dash_find(&d, "w5h");
    TEST_ASSERT_EQUAL_INT(COMP_RING, d.components[iw].type);
    TEST_ASSERT_TRUE(d.components[iw].countdown);
    TEST_ASSERT_EQUAL_INT(2, d.components[iw].threshold_count);
    TEST_ASSERT_EQUAL_HEX32(0x38BDF8, d.components[iw].color);
    TEST_ASSERT_EQUAL_INT(140, d.pages[0].places[0].radius);
    TEST_ASSERT_EQUAL_INT(A_CENTER, d.pages[0].places[1].anchor);
}
static const char* LAYOUT_RING_OPTS =
  "{\"title\":\"T\",\"background\":\"#000000\","
  "\"components\":{\"g\":{\"type\":\"ring\",\"color\":\"#38BDF8\","
                        "\"center_pct\":true,\"unit\":\"C\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"g\","
             "\"radius\":140,\"thickness\":16,\"gap_deg\":70,\"start_angle\":90}]}]}";

void test_ring_center_pct_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_RING_OPTS, err, sizeof(err)));
    int ig = dash_find(&d, "g");
    TEST_ASSERT_TRUE(d.components[ig].center_pct);
    TEST_ASSERT_EQUAL_STRING("C", d.components[ig].unit);
}
void test_ring_start_angle_parsed(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_RING_OPTS, err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(90, d.pages[0].places[0].start_angle);
}
void test_ring_start_angle_default_zero(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));   // LAYOUT_OK ne définit pas start_angle
    TEST_ASSERT_EQUAL_INT(0, d.pages[0].places[0].start_angle);
}
static const char* LAYOUT_RING_CCOL =
  "{\"title\":\"T\",\"background\":\"#000000\","
  "\"components\":{\"g\":{\"type\":\"ring\",\"color\":\"#38BDF8\","
                        "\"center_pct\":true,\"center_color\":\"#FF0000\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"g\",\"radius\":140}]}]}";

void test_ring_center_color_set(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_RING_CCOL, err, sizeof(err)));
    int ig = dash_find(&d, "g");
    TEST_ASSERT_TRUE(d.components[ig].center_color_set);
    TEST_ASSERT_EQUAL_HEX32(0xFF0000, d.components[ig].center_color);
}
void test_ring_center_color_defaults_to_color(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_RING_OPTS, err, sizeof(err));   // pas de center_color
    int ig = dash_find(&d, "g");
    TEST_ASSERT_FALSE(d.components[ig].center_color_set);
    TEST_ASSERT_EQUAL_HEX32(0x38BDF8, d.components[ig].center_color);  // retombe sur color
}
static const char* LAYOUT_RING_CAP =
  "{\"title\":\"T\",\"background\":\"#000000\","
  "\"components\":{\"g\":{\"type\":\"ring\",\"cap_prefix\":\"RST \"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"g\",\"radius\":140}]}]}";

void test_ring_cap_prefix_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_RING_CAP, err, sizeof(err)));
    int ig = dash_find(&d, "g");
    TEST_ASSERT_EQUAL_STRING("RST ", d.components[ig].cap_prefix);
}
static const char* LAYOUT_BARRING_OPTS =
  "{\"title\":\"T\",\"background\":\"#000000\","
  "\"components\":{"
  "\"b\":{\"type\":\"bar\",\"min\":-50,\"max\":50,\"mode\":\"symmetrical\",\"orientation\":\"vertical\","
         "\"anim_ms\":250,\"thresholds\":[[0,\"#EF4444\"]]},"
  "\"g\":{\"type\":\"ring\",\"mode\":\"reverse\",\"rounded\":false}},"
  "\"pages\":[{\"name\":\"p\",\"place\":["
  "{\"ref\":\"b\",\"width\":16,\"height\":200},{\"ref\":\"g\",\"radius\":120}]}]}";

void test_bar_options_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_BARRING_OPTS, err, sizeof(err)));
    int ib = dash_find(&d, "b");
    TEST_ASSERT_EQUAL_INT(BAR_SYMMETRICAL, d.components[ib].bar_mode);
    TEST_ASSERT_TRUE(d.components[ib].bar_vertical);
    TEST_ASSERT_EQUAL_INT(250, d.components[ib].bar_anim_ms);
    TEST_ASSERT_EQUAL_INT(1, d.components[ib].threshold_count);   // seuils partages -> sync_bar les exploite
}
void test_ring_mode_rounded_parsed(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_BARRING_OPTS, err, sizeof(err));
    int ig = dash_find(&d, "g");
    TEST_ASSERT_EQUAL_INT(ARC_REVERSE, d.components[ig].arc_mode);
    TEST_ASSERT_FALSE(d.components[ig].arc_rounded);
}
static const char* LAYOUT_BARRING_MIN =
  "{\"title\":\"T\",\"background\":\"#000000\","
  "\"components\":{\"b\":{\"type\":\"bar\"},\"g\":{\"type\":\"ring\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"b\"},{\"ref\":\"g\",\"radius\":120}]}]}";

void test_bar_ring_option_defaults(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_BARRING_MIN, err, sizeof(err)));
    int ib = dash_find(&d, "b"), ig = dash_find(&d, "g");
    TEST_ASSERT_EQUAL_INT(BAR_NORMAL, d.components[ib].bar_mode);
    TEST_ASSERT_FALSE(d.components[ib].bar_vertical);
    TEST_ASSERT_EQUAL_INT(0, d.components[ib].bar_anim_ms);
    TEST_ASSERT_EQUAL_INT(ARC_NORMAL, d.components[ig].arc_mode);
    TEST_ASSERT_TRUE(d.components[ig].arc_rounded);   // defaut true = rendu actuel
}
void test_ring_cap_prefix_default_empty(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));   // LAYOUT_OK ne définit pas cap_prefix ni style de cap
    int iw = dash_find(&d, "w5h");
    TEST_ASSERT_EQUAL_STRING("", d.components[iw].cap_prefix);
    TEST_ASSERT_EQUAL_INT(14, d.components[iw].cap_font);          // defaut = look actuel
    TEST_ASSERT_EQUAL_INT(FAMILY_MONTSERRAT, d.components[iw].cap_family);
    TEST_ASSERT_FALSE(d.components[iw].cap_bold);
    TEST_ASSERT_FALSE(d.components[iw].cap_italic);
}

static const char* LAYOUT_RING_CAP_FONT =
  "{\"components\":{\"g\":{\"type\":\"ring\",\"countdown\":true,"
    "\"cap_font\":24,\"cap_family\":\"lora\",\"cap_bold\":true,\"cap_italic\":true}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"g\",\"radius\":120}]}]}";

void test_ring_cap_font_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_RING_CAP_FONT, err, sizeof(err)));
    int ig = dash_find(&d, "g");
    TEST_ASSERT_EQUAL_INT(24, d.components[ig].cap_font);
    TEST_ASSERT_EQUAL_INT(FAMILY_LORA, d.components[ig].cap_family);
    TEST_ASSERT_TRUE(d.components[ig].cap_bold);
    TEST_ASSERT_TRUE(d.components[ig].cap_italic);
}
static const char* LAYOUT_RING_CENTER =
  "{\"components\":{\"g\":{\"type\":\"ring\",\"center_pct\":true}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"g\",\"radius\":120}]}]}";

void test_ring_center_parsed(void) {                  // pastille (pill) supprimee : seul center_pct subsiste
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_RING_CENTER, err, sizeof(err)));
    int ig = dash_find(&d, "g");
    TEST_ASSERT_TRUE(d.components[ig].center_pct);
}
void test_layout_unknown_type_rejected(void) {
    Dashboard d{}; char err[80];
    const char* bad = "{\"components\":{\"x\":{\"type\":\"frobnicator\"}},\"pages\":[]}";
    TEST_ASSERT_FALSE(dash_set_layout(&d, bad, err, sizeof(err)));
}

// Conformité firmware ↔ schema : pour CHAQUE type déclaré dans le schema partagé
// (component.oneOf → comp_* → type.const), parse_type (via dash_set_layout) doit le
// résoudre ; un type absent du schema doit être rejeté. Échoue rouge si le firmware
// oublie un type que le schema déclare. Le schema est lu depuis RT_SCHEMA_PATH.
void test_schema_types_all_resolve(void) {
    FILE* f = fopen(RT_SCHEMA_PATH, "rb");
    TEST_ASSERT_NOT_NULL_MESSAGE(f, "impossible d'ouvrir RT_SCHEMA_PATH: " RT_SCHEMA_PATH);
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    char* schema = (char*)malloc((size_t)n + 1);
    size_t rd = fread(schema, 1, (size_t)n, f); schema[rd] = '\0';
    fclose(f);

    JsonDocument doc;
    DeserializationError e = deserializeJson(doc, schema);
    TEST_ASSERT_TRUE_MESSAGE(!e, "schema JSON invalide");

    JsonArrayConst oneOf = doc["$defs"]["component"]["oneOf"].as<JsonArrayConst>();
    TEST_ASSERT_FALSE_MESSAGE(oneOf.isNull(), "component.oneOf absent du schema");

    int count = 0;
    for (JsonObjectConst ref : oneOf) {
        const char* r = ref["$ref"];                       // ex "#/$defs/comp_ring"
        TEST_ASSERT_NOT_NULL_MESSAGE(r, "entree oneOf sans $ref");
        const char* slash = strrchr(r, '/');
        TEST_ASSERT_NOT_NULL(slash);
        const char* defName = slash + 1;                   // "comp_ring"
        const char* typeName = doc["$defs"][defName]["properties"]["type"]["const"];
        TEST_ASSERT_NOT_NULL_MESSAGE(typeName, defName);

        char layout[192];
        snprintf(layout, sizeof(layout),
            "{\"components\":{\"x\":{\"type\":\"%s\"}},\"pages\":[]}", typeName);
        Dashboard d{}; char err[80];
        TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, layout, err, sizeof(err)), typeName);
        count++;
    }
    free(schema);
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, count, "aucun type extrait du schema");

    // Un type absent du schema doit être rejeté.
    Dashboard d{}; char err[80];
    TEST_ASSERT_FALSE(dash_set_layout(&d,
        "{\"components\":{\"x\":{\"type\":\"definitely_not_a_type\"}},\"pages\":[]}",
        err, sizeof(err)));
}
void test_layout_invalid_keeps_old(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    dash_set_layout(&d, "{ not json", err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(2, d.comp_count);
}

void test_countdown_decrements_and_formats(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    dash_apply_update(&d, "{\"w5h\":{\"pct\":63,\"reset_in_s\":3601}}", unk, sizeof(unk));
    int iw = dash_find(&d,"w5h");
    d.components[iw].dirty = false;
    dash_tick_countdown(&d, 1);
    TEST_ASSERT_EQUAL_UINT32(3600, d.components[iw].reset_in_s);
    TEST_ASSERT_EQUAL_STRING("1h00", d.components[iw].caption);
    TEST_ASSERT_TRUE(d.components[iw].dirty);
}
void test_countdown_floor_zero(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    dash_apply_update(&d, "{\"w5h\":{\"pct\":99,\"reset_in_s\":3}}", unk, sizeof(unk));
    dash_tick_countdown(&d, 10);
    TEST_ASSERT_EQUAL_UINT32(0, d.components[dash_find(&d,"w5h")].reset_in_s);
}

void test_update_partial_leaves_others(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    int icpu = dash_find(&d,"cpu"), iw = dash_find(&d,"w5h");
    d.components[iw].value = 10;
    int nupd = dash_apply_update(&d, "{\"cpu\":42}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(1, nupd);
    TEST_ASSERT_EQUAL_STRING("42 %", d.components[icpu].vstr);
    TEST_ASSERT_EQUAL_INT(10, d.components[iw].value);
    TEST_ASSERT_TRUE(d.values_dirty);
}
void test_update_ring_object(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    int iw = dash_find(&d,"w5h");
    dash_apply_update(&d, "{\"w5h\":{\"pct\":63,\"reset_in_s\":6600}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(63, d.components[iw].value);
    TEST_ASSERT_EQUAL_UINT32(6600, d.components[iw].reset_in_s);
    TEST_ASSERT_EQUAL_STRING("1h50", d.components[iw].caption);
}
void test_update_unknown_reported_not_applied(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    int nupd = dash_apply_update(&d, "{\"ghost\":1,\"cpu\":5}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(1, nupd);
    TEST_ASSERT_EQUAL_STRING("ghost", unk);
}

// --- apply des types physiques (caracterisation : verrouille le comportement avant la refacto 2b) ---
void test_update_led_ring_mode_color_value(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    const char* L = "{\"components\":{\"led\":{\"type\":\"led_ring\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    dash_apply_update(&d,
        "{\"led\":{\"mode\":\"progress\",\"color\":\"#FF8800\",\"value\":42,\"period_ms\":500}}",
        unk, sizeof(unk));
    int i = dash_find(&d, "led");
    TEST_ASSERT_EQUAL_INT(LED_PROGRESS, d.components[i].led_mode);
    TEST_ASSERT_EQUAL_HEX32(0xFF8800, d.components[i].led_color);
    TEST_ASSERT_EQUAL_UINT8(42, d.components[i].led_value);
    TEST_ASSERT_EQUAL_UINT16(500, d.components[i].led_period_ms);
}
void test_led_ring_config_drives_boot(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"r\":{\"type\":\"led_ring\",\"color\":\"#FF9F40\","
                    "\"brightness\":120,\"mode\":\"breathe\",\"period_ms\":2500}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "r");
    TEST_ASSERT_EQUAL_INT(LED_BREATHE, d.components[i].led_mode);
    TEST_ASSERT_EQUAL_HEX32(0xFF9F40, d.components[i].led_color);
    TEST_ASSERT_EQUAL_UINT8(120, d.components[i].led_brightness);
    TEST_ASSERT_EQUAL_UINT16(2500, d.components[i].led_period_ms);
    TEST_ASSERT_EQUAL_UINT8(0, d.components[i].led_value);
}

void test_led_ring_config_defaults_off(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"r\":{\"type\":\"led_ring\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "r");
    TEST_ASSERT_EQUAL_INT(LED_OFF, d.components[i].led_mode);     // défaut : éteint au boot
    TEST_ASSERT_EQUAL_UINT16(1000, d.components[i].led_period_ms);
    TEST_ASSERT_EQUAL_HEX32(0xFFFFFF, d.components[i].led_color);
    TEST_ASSERT_EQUAL_UINT8(64, d.components[i].led_brightness);
}

void test_update_sound_sets_pending(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    const char* L = "{\"components\":{\"buzz\":{\"type\":\"sound\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    dash_apply_update(&d, "{\"buzz\":{\"tone\":880,\"ms\":200,\"name\":\"beep\"}}", unk, sizeof(unk));
    int i = dash_find(&d, "buzz");
    TEST_ASSERT_TRUE(d.components[i].snd_pending);
    TEST_ASSERT_EQUAL_UINT16(880, d.components[i].snd_tone);
    TEST_ASSERT_EQUAL_UINT16(200, d.components[i].snd_ms);
    TEST_ASSERT_EQUAL_STRING("beep", d.components[i].snd_name);
}

// --- chart : fenêtre glissante d'historique (native-testable) ---
void test_chart_ring_keeps_last_n(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d,
        "{\"components\":{\"g\":{\"type\":\"chart\",\"points\":30}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"g\"}]}]}", err, sizeof(err));
    int i = dash_find(&d, "g");
    char body[24];
    for (int v = 1; v <= 35; v++) { snprintf(body, sizeof(body), "{\"g\":%d}", v); dash_apply_update(&d, body, unk, sizeof(unk)); }
    TEST_ASSERT_EQUAL_INT(30, d.components[i].hist_count);
    TEST_ASSERT_EQUAL_INT(6,  d.components[i].hist[0]);    // v1..v5 sont tombées
    TEST_ASSERT_EQUAL_INT(35, d.components[i].hist[29]);
}
void test_chart_points_parsed_and_clamped(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, "{\"components\":{\"g\":{\"type\":\"chart\",\"points\":999}},\"pages\":[]}", err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(CHART_MAX_POINTS, d.components[dash_find(&d,"g")].chart_points);
    Dashboard d2{}; char err2[80];
    dash_set_layout(&d2, "{\"components\":{\"g\":{\"type\":\"chart\"}},\"pages\":[]}", err2, sizeof(err2));
    TEST_ASSERT_EQUAL_INT(30, d2.components[dash_find(&d2,"g")].chart_points);
}
void test_update_meter_value(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d,
        "{\"components\":{\"m\":{\"type\":\"meter\",\"min\":0,\"max\":100}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"m\"}]}]}", err, sizeof(err));
    dash_apply_update(&d, "{\"m\":72}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(72, d.components[dash_find(&d,"m")].value);
}

// --- Étape 1 : push scalaire en forme objet {value|text} (raccourci scalaire nu conservé) ---
void test_update_bar_object_or_bare_value(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d,
        "{\"components\":{\"b\":{\"type\":\"bar\",\"min\":0,\"max\":100}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"b\"}]}]}", err, sizeof(err));
    int ib = dash_find(&d, "b");
    dash_apply_update(&d, "{\"b\":{\"value\":42}}", unk, sizeof(unk));   // forme objet
    TEST_ASSERT_EQUAL_INT(42, d.components[ib].value);
    dash_apply_update(&d, "{\"b\":7}", unk, sizeof(unk));               // raccourci nu (rétro-compat)
    TEST_ASSERT_EQUAL_INT(7, d.components[ib].value);
}
void test_update_label_object_or_bare_text(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d,
        "{\"components\":{\"l\":{\"type\":\"label\",\"text\":\"hi\"}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"l\"}]}]}", err, sizeof(err));
    int il = dash_find(&d, "l");
    dash_apply_update(&d, "{\"l\":{\"text\":\"world\"}}", unk, sizeof(unk));  // forme objet
    TEST_ASSERT_EQUAL_STRING("world", d.components[il].vstr);
    dash_apply_update(&d, "{\"l\":\"bare\"}", unk, sizeof(unk));             // raccourci nu
    TEST_ASSERT_EQUAL_STRING("bare", d.components[il].vstr);
}
void test_update_readout_object_value_formats(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    int icpu = dash_find(&d, "cpu");
    dash_apply_update(&d, "{\"cpu\":{\"value\":42}}", unk, sizeof(unk));  // num en forme objet -> format avec unit
    TEST_ASSERT_EQUAL_STRING("42 %", d.components[icpu].vstr);
}

// --- Étape 1 : commande universelle visible (montre/cache) ---
void test_visible_defaults_true(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));      // memset zéroe la struct -> doit être forcé à true
    TEST_ASSERT_TRUE(d.components[dash_find(&d,"cpu")].visible);
}
void test_update_visible_toggles(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    int icpu = dash_find(&d, "cpu");
    dash_apply_update(&d, "{\"cpu\":{\"visible\":false}}", unk, sizeof(unk));
    TEST_ASSERT_FALSE(d.components[icpu].visible);
    TEST_ASSERT_TRUE(d.components[icpu].dirty);            // un changement de visible doit re-synchroniser
    dash_apply_update(&d, "{\"cpu\":{\"visible\":true}}", unk, sizeof(unk));
    TEST_ASSERT_TRUE(d.components[icpu].visible);
}
void test_update_visible_only_keeps_value(void) {         // le footgun : visible seul n'écrase pas value
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d,
        "{\"components\":{\"b\":{\"type\":\"bar\"}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"b\"}]}]}", err, sizeof(err));
    int ib = dash_find(&d, "b");
    d.components[ib].value = 55;
    dash_apply_update(&d, "{\"b\":{\"visible\":false}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(55, d.components[ib].value);     // value PRÉSERVÉE
    TEST_ASSERT_FALSE(d.components[ib].visible);
}
void test_update_value_and_visible_together(void) {
    Dashboard d{}; char err[80], unk[UNKNOWN_CSV_LEN];
    dash_set_layout(&d,
        "{\"components\":{\"b\":{\"type\":\"bar\"}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"b\"}]}]}", err, sizeof(err));
    int ib = dash_find(&d, "b");
    dash_apply_update(&d, "{\"b\":{\"value\":80,\"visible\":false}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(80, d.components[ib].value);
    TEST_ASSERT_FALSE(d.components[ib].visible);
}

void test_layout_visible_config_time(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d,
        "{\"components\":{"
          "\"a\":{\"type\":\"bar\",\"visible\":false},"
          "\"b\":{\"type\":\"bar\"},"
          "\"c\":{\"type\":\"bar\",\"visible\":true}},"
        "\"pages\":[{\"name\":\"p\",\"place\":["
          "{\"ref\":\"a\"},{\"ref\":\"b\"},{\"ref\":\"c\"}]}]}", err, sizeof(err));
    TEST_ASSERT_FALSE(d.components[dash_find(&d,"a")].visible);   // visible:false honoré (config-time)
    TEST_ASSERT_TRUE (d.components[dash_find(&d,"b")].visible);   // absent -> true
    TEST_ASSERT_TRUE (d.components[dash_find(&d,"c")].visible);   // visible:true explicite
}

void test_bgkey_valid_hex(void)      { TEST_ASSERT_TRUE(bg_key_valid("a1b2c3d4e5f60718")); }   // 16 hex
void test_bgkey_valid_short(void)    { TEST_ASSERT_TRUE(bg_key_valid("0")); }
void test_bgkey_reject_empty(void)   { TEST_ASSERT_FALSE(bg_key_valid("")); }
void test_bgkey_reject_slash(void)   { TEST_ASSERT_FALSE(bg_key_valid("../x")); }
void test_bgkey_reject_dot(void)     { TEST_ASSERT_FALSE(bg_key_valid("a.b")); }
void test_bgkey_reject_upper(void)   { TEST_ASSERT_FALSE(bg_key_valid("ABCD")); }
void test_bgkey_reject_toolong(void) { TEST_ASSERT_FALSE(bg_key_valid("00112233445566778")); } // 17

void test_next_mid(void)     { TEST_ASSERT_EQUAL_INT(2, nav_next(1, 3, true)); }
void test_next_wrap(void)    { TEST_ASSERT_EQUAL_INT(0, nav_next(2, 3, true)); }
void test_next_clamp(void)   { TEST_ASSERT_EQUAL_INT(2, nav_next(2, 3, false)); }
void test_prev_wrap(void)    { TEST_ASSERT_EQUAL_INT(2, nav_prev(0, 3, true)); }
void test_prev_clamp(void)   { TEST_ASSERT_EQUAL_INT(0, nav_prev(0, 3, false)); }
void test_single_page(void)  { TEST_ASSERT_EQUAL_INT(0, nav_next(0, 1, true)); }
void test_empty(void)        { TEST_ASSERT_EQUAL_INT(0, nav_next(0, 0, true)); }

void test_threshold_none(void) {
    Threshold t[1] = {{70,0x22C55E}};
    TEST_ASSERT_EQUAL_HEX32(0xABCDEF, threshold_color(t,0,50,0xABCDEF));
}

void test_led_is_lit_boundary(void) {
    TEST_ASSERT_FALSE(led_is_lit(0, 1));
    TEST_ASSERT_TRUE (led_is_lit(1, 1));   // limite incluse
    TEST_ASSERT_TRUE (led_is_lit(5, 1));
    TEST_ASSERT_TRUE (led_is_lit(0, 0));   // off_below 0 -> toujours allume
}

static const char* LAYOUT_SHAPES =
  "{\"components\":{"
    "\"r1\":{\"type\":\"rect\",\"fill\":\"#FF0000\",\"border_width\":3,\"border_color\":\"#00FF00\"},"
    "\"c1\":{\"type\":\"circle\"},"
    "\"l1\":{\"type\":\"line\",\"color\":\"#0000FF\",\"orientation\":\"vertical\",\"dash\":\"dashed\",\"rounded\":true}},"
  "\"pages\":[{\"name\":\"p\",\"place\":["
    "{\"ref\":\"r1\",\"width\":120,\"height\":60,\"radius\":8},"
    "{\"ref\":\"c1\",\"size\":50},"
    "{\"ref\":\"l1\",\"width\":100,\"thickness\":2}]}]}";

void test_shapes_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_SHAPES, err, sizeof(err)), err);
    int ir = dash_find(&d, "r1"), ic = dash_find(&d, "c1"), il = dash_find(&d, "l1");
    TEST_ASSERT_TRUE(ir >= 0 && ic >= 0 && il >= 0);
    TEST_ASSERT_EQUAL_INT(COMP_RECT, d.components[ir].type);
    TEST_ASSERT_TRUE(d.components[ir].fill_set);
    TEST_ASSERT_EQUAL_HEX32(0xFF0000, d.components[ir].fill);
    TEST_ASSERT_EQUAL_INT(3, d.components[ir].border_width);
    TEST_ASSERT_EQUAL_HEX32(0x00FF00, d.components[ir].border_color);
    TEST_ASSERT_EQUAL_INT(8, d.pages[0].places[0].radius);
    TEST_ASSERT_EQUAL_INT(COMP_CIRCLE, d.components[ic].type);
    TEST_ASSERT_FALSE(d.components[ic].fill_set);
    TEST_ASSERT_EQUAL_INT(50, d.pages[0].places[1].size);
    TEST_ASSERT_EQUAL_INT(COMP_LINE, d.components[il].type);
    TEST_ASSERT_EQUAL_HEX32(0x0000FF, d.components[il].color);
    TEST_ASSERT_TRUE(d.components[il].bar_vertical);
    TEST_ASSERT_EQUAL_INT(LINE_DASHED, d.components[il].line_dash);
    TEST_ASSERT_TRUE(d.components[il].line_rounded);
    TEST_ASSERT_EQUAL_INT(100, d.pages[0].places[2].width);
    TEST_ASSERT_EQUAL_INT(2, d.pages[0].places[2].thickness);
}

// Le label porte desormais un style de boite (fond/contour/marge), parse comme rect + pad_x/pad_y.
static const char* LAYOUT_LABEL_BOX =
  "{\"components\":{"
    "\"b\":{\"type\":\"label\",\"text\":\"CPU\",\"fill\":\"#1E293B\",\"border_width\":2,\"border_color\":\"#38BDF8\",\"pad_x\":8,\"pad_y\":4},"
    "\"p\":{\"type\":\"label\",\"text\":\"plain\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":["
    "{\"ref\":\"b\",\"anchor\":\"CENTER\",\"radius\":6},"
    "{\"ref\":\"p\",\"anchor\":\"CENTER\"}]}]}";

void test_label_box_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_LABEL_BOX, err, sizeof(err)), err);
    int ib = dash_find(&d, "b"), ip = dash_find(&d, "p");
    TEST_ASSERT_TRUE(ib >= 0 && ip >= 0);
    TEST_ASSERT_TRUE(d.components[ib].fill_set);
    TEST_ASSERT_EQUAL_HEX32(0x1E293B, d.components[ib].fill);
    TEST_ASSERT_EQUAL_INT(2, d.components[ib].border_width);
    TEST_ASSERT_EQUAL_HEX32(0x38BDF8, d.components[ib].border_color);
    TEST_ASSERT_EQUAL_INT(8, d.components[ib].pad_x);
    TEST_ASSERT_EQUAL_INT(4, d.components[ib].pad_y);
    TEST_ASSERT_EQUAL_INT(6, d.pages[0].places[0].radius);
    // Opt-in : un label sans style de boite reste a zero (pas de fond, pas de marge).
    TEST_ASSERT_FALSE(d.components[ip].fill_set);
    TEST_ASSERT_EQUAL_INT(0, d.components[ip].border_width);
    TEST_ASSERT_EQUAL_INT(0, d.components[ip].pad_x);
    TEST_ASSERT_EQUAL_INT(0, d.components[ip].pad_y);
}

static const char* LAYOUT_LED =
    "{\"components\":{\"d\":{\"type\":\"led\",\"color\":\"#22C55E\",\"off_below\":3,"
    "\"thresholds\":[[1,\"#EF4444\"]]}},"
    "\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"d\",\"anchor\":\"CENTER\",\"size\":40}]}]}";

void test_led_parse(void) {
    Dashboard d{}; char err[128];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_LED, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(COMP_LED, d.components[0].type);
    TEST_ASSERT_EQUAL_INT(3, d.components[0].off_below);
    TEST_ASSERT_EQUAL_HEX32(0x22C55E, d.components[0].color);
    TEST_ASSERT_EQUAL_INT(1, d.components[0].threshold_count);
    TEST_ASSERT_EQUAL_INT(40, d.pages[0].places[0].size);
}

static const char* LAYOUT_LED_LOOK =
    "{\"components\":{"
    "\"a\":{\"type\":\"led\",\"glow\":false,\"bezel\":false,\"specular\":false,\"off_glass\":false},"
    "\"b\":{\"type\":\"led\"}},"
    "\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"a\"},{\"ref\":\"b\"}]}]}";

void test_led_look_flags(void) {
    Dashboard d{}; char err[128];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_LED_LOOK, err, sizeof(err)));
    // a : tout désactivé explicitement
    TEST_ASSERT_FALSE(d.components[0].led_glow);
    TEST_ASSERT_FALSE(d.components[0].led_bezel);
    TEST_ASSERT_FALSE(d.components[0].led_specular);
    TEST_ASSERT_FALSE(d.components[0].led_off_glass);
    // b : défauts (true)
    TEST_ASSERT_TRUE(d.components[1].led_glow);
    TEST_ASSERT_TRUE(d.components[1].led_bezel);
    TEST_ASSERT_TRUE(d.components[1].led_specular);
    TEST_ASSERT_TRUE(d.components[1].led_off_glass);
}

// --- contexte (blackboard) ---
void test_ctx_set_find_num(void) {
    Context c{};
    TEST_ASSERT_TRUE(ctx_set_num(&c, "cpu", 42, 100));
    int i = ctx_find(&c, "cpu");
    TEST_ASSERT_TRUE(i >= 0);
    TEST_ASSERT_EQUAL_INT(CTX_NUM, c.vars[i].type);
    TEST_ASSERT_EQUAL_INT(42, (int)c.vars[i].num);
    TEST_ASSERT_EQUAL_UINT32(100, c.vars[i].updated_at);
}
void test_ctx_overwrite_keeps_one_slot(void) {
    Context c{};
    ctx_set_num(&c, "x", 1, 0);
    ctx_set_str(&c, "x", "hi", 5);
    TEST_ASSERT_EQUAL_INT(1, c.count);                 // meme nom = meme slot
    int i = ctx_find(&c, "x");
    TEST_ASSERT_EQUAL_INT(CTX_STR, c.vars[i].type);
    TEST_ASSERT_EQUAL_STRING("hi", c.vars[i].str);
}
void test_ctx_full_rejects(void) {
    Context c{};
    char nm[8];
    for (int k = 0; k < MAX_CTX_VARS; k++) { snprintf(nm, sizeof(nm), "v%d", k); TEST_ASSERT_TRUE(ctx_set_num(&c, nm, k, 0)); }
    TEST_ASSERT_FALSE(ctx_set_num(&c, "over", 1, 0));  // plein -> refus
}

// --- extracteur JSON Pointer ---
void test_ptr_nested_object(void) {
    JsonDocument d; deserializeJson(d, "{\"main\":{\"temp\":21}}");
    JsonVariantConst v = ctx_extract_pointer(d.as<JsonVariantConst>(), "/main/temp");
    TEST_ASSERT_FALSE(v.isNull());
    TEST_ASSERT_EQUAL_INT(21, v.as<int>());
}
void test_ptr_array_index(void) {
    JsonDocument d; deserializeJson(d, "{\"list\":[10,20,30]}");
    JsonVariantConst v = ctx_extract_pointer(d.as<JsonVariantConst>(), "/list/1");
    TEST_ASSERT_EQUAL_INT(20, v.as<int>());
}
void test_ptr_missing_is_null(void) {
    JsonDocument d; deserializeJson(d, "{\"a\":1}");
    TEST_ASSERT_TRUE(ctx_extract_pointer(d.as<JsonVariantConst>(), "/a/b").isNull());
    TEST_ASSERT_TRUE(ctx_extract_pointer(d.as<JsonVariantConst>(), "/nope").isNull());
}
void test_ptr_escape(void) {
    JsonDocument d; deserializeJson(d, "{\"a/b\":7}");
    TEST_ASSERT_EQUAL_INT(7, ctx_extract_pointer(d.as<JsonVariantConst>(), "/a~1b").as<int>());
}

void test_ctx_apply_json_num_and_str(void) {
    Context c{};
    JsonDocument d; deserializeJson(d, "{\"cpu\":42,\"host\":\"srv1\"}");
    int n = ctx_apply_json(&c, d.as<JsonObjectConst>(), 7);
    TEST_ASSERT_EQUAL_INT(2, n);
    TEST_ASSERT_EQUAL_INT(42, (int)c.vars[ctx_find(&c,"cpu")].num);
    TEST_ASSERT_EQUAL_INT(CTX_STR, c.vars[ctx_find(&c,"host")].type);
    TEST_ASSERT_EQUAL_STRING("srv1", c.vars[ctx_find(&c,"host")].str);
}

void test_layout_bind_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"t\":{\"type\":\"readout\",\"bind\":\"temp\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_EQUAL_STRING("temp", d.components[dash_find(&d,"t")].bind);
}
void test_dash_set_context_writes_ctx(void) {
    Dashboard d{};
    dash_set_context(&d, "{\"temp\":21}", 3);
    TEST_ASSERT_TRUE(ctx_find(&d.ctx, "temp") >= 0);
    TEST_ASSERT_EQUAL_INT(21, (int)d.ctx.vars[ctx_find(&d.ctx,"temp")].num);
}

// --- parse des sources (pull P2) ---
static const char* LAYOUT_SOURCES =
  "{\"title\":\"T\",\"background\":\"#000000\","
  "\"sources\":[{"
    "\"name\":\"weather\",\"url\":\"https://api.example/w?city=Paris\",\"interval_s\":600,"
    "\"headers\":{\"X-API-Key\":\"$weather_key\"},"
    "\"vars\":{\"temp\":\"/main/temp\",\"hum\":\"/main/humidity\"}}],"
  "\"components\":{\"t\":{\"type\":\"readout\",\"unit\":\"C\",\"bind\":\"temp\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"t\"}]}]}";

void test_sources_parse_counts(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_SOURCES, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(1, d.source_count);
    TEST_ASSERT_EQUAL_STRING("weather", d.sources[0].name);
    TEST_ASSERT_EQUAL_STRING("https://api.example/w?city=Paris", d.sources[0].url);
    TEST_ASSERT_EQUAL_UINT32(600, d.sources[0].interval_s);
}
void test_sources_headers_and_vars(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SOURCES, err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(1, d.sources[0].header_count);
    TEST_ASSERT_EQUAL_STRING("X-API-Key",    d.sources[0].headers[0].name);
    TEST_ASSERT_EQUAL_STRING("$weather_key", d.sources[0].headers[0].value);
    TEST_ASSERT_EQUAL_INT(2, d.sources[0].var_count);
    TEST_ASSERT_EQUAL_STRING("temp",       d.sources[0].vars[0].name);   // ArduinoJson préserve l'ordre des clés
    TEST_ASSERT_EQUAL_STRING("/main/temp", d.sources[0].vars[0].ptr);
}
void test_sources_interval_floor(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sources\":[{\"name\":\"s\",\"url\":\"http://x/\",\"interval_s\":1}],"
                    "\"components\":{},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_EQUAL_UINT32(CTX_MIN_INTERVAL_S, d.sources[0].interval_s);   // 1 -> borné à 5
}
void test_sources_url_required(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sources\":[{\"name\":\"s\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_FALSE(dash_set_layout(&d, L, err, sizeof(err)));   // url manquante -> rejet
}
void test_no_sources_is_zero(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));   // layout sans 'sources'
    TEST_ASSERT_EQUAL_INT(0, d.source_count);           // rétro-compat
}

// --- parse des sinks (push P-A) ---
static const char* LAYOUT_SINKS =
  "{\"sinks\":[{"
    "\"name\":\"Lampe\",\"watch\":\"lamp\",\"method\":\"PUT\","
    "\"url\":\"http://ha.local/api/states/light.salon\","
    "\"headers\":{\"Authorization\":\"$ha_token\"},"
    "\"debounce_ms\":300,"
    "\"body\":{\"state\":\"{{lamp}}\"}}],"
  "\"components\":{},\"pages\":[]}";

void test_sinks_parse_counts(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_SINKS, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(1, d.sink_count);
    TEST_ASSERT_EQUAL_STRING("Lampe", d.sinks[0].name);
    TEST_ASSERT_EQUAL_STRING("lamp",  d.sinks[0].watch);
    TEST_ASSERT_EQUAL_STRING("http://ha.local/api/states/light.salon", d.sinks[0].url);
    TEST_ASSERT_EQUAL_INT(SINK_PUT, d.sinks[0].method);
    TEST_ASSERT_EQUAL_UINT32(300, d.sinks[0].debounce_ms);
}
void test_sinks_headers_and_body(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINKS, err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(1, d.sinks[0].header_count);
    TEST_ASSERT_EQUAL_STRING("Authorization", d.sinks[0].headers[0].name);
    TEST_ASSERT_EQUAL_STRING("$ha_token",     d.sinks[0].headers[0].value);
    TEST_ASSERT_EQUAL_STRING("{\"state\":\"{{lamp}}\"}", d.sinks[0].body);
}
void test_sinks_method_defaults_post(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sinks\":[{\"watch\":\"x\",\"url\":\"http://h/\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(SINK_POST, d.sinks[0].method);
    TEST_ASSERT_EQUAL_STRING("", d.sinks[0].body);
}
void test_sinks_url_required(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sinks\":[{\"watch\":\"x\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_FALSE(dash_set_layout(&d, L, err, sizeof(err)));
}
void test_sinks_watch_required(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sinks\":[{\"url\":\"http://h/\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_FALSE(dash_set_layout(&d, L, err, sizeof(err)));
}
void test_no_sinks_is_zero(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(0, d.sink_count);
}

// --- origine d'écriture : dash_ctx_write_ui_* arme les sinks ---
static const char* LAYOUT_SINK_LAMP =
  "{\"sinks\":[{\"watch\":\"lamp\",\"url\":\"http://h/\"}],\"components\":{},\"pages\":[]}";

void test_ui_write_arms_sink(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_LAMP, err, sizeof(err));
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);
    dash_ctx_write_ui_num(&d, "lamp", 1, 5000);
    TEST_ASSERT_EQUAL_UINT32(5000, d.sinks[0].pending_since);
    TEST_ASSERT_EQUAL_INT(1, (int)d.ctx.vars[ctx_find(&d.ctx,"lamp")].num);
}
void test_external_write_does_not_arm(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_LAMP, err, sizeof(err));
    dash_set_context(&d, "{\"lamp\":1}", 5000);
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);
}
void test_ui_write_arms_only_matching_watch(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_LAMP, err, sizeof(err));
    dash_ctx_write_ui_num(&d, "volume", 30, 5000);
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);
}

// --- momentary : capture à l'armement ---
static const char* LAYOUT_SINK_BELL =
  "{\"sinks\":[{\"watch\":\"bell\",\"url\":\"http://h/\",\"body\":{\"v\":\"{{bell}}\"}}],"
  "\"components\":{},\"pages\":[]}";

void test_pulse_arms_and_captures_num(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "bell", 1, 5000);
    TEST_ASSERT_EQUAL_UINT32(5000, d.sinks[0].pending_since);              // armé
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);                             // capturé
    TEST_ASSERT_EQUAL_STRING("{\"v\":\"1\"}", d.sinks[0].captured_body);  // impulsion figée
    TEST_ASSERT_EQUAL_INT(0, (int)d.ctx.vars[ctx_find(&d.ctx,"bell")].num); // ctx retombé à 0
}
void test_pulse_captures_and_resets_str(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, "{\"sinks\":[{\"watch\":\"scene\",\"url\":\"http://h/\"}],"
                        "\"components\":{},\"pages\":[]}", err, sizeof(err));
    dash_ctx_pulse_str(&d, "scene", "ring", 7000);
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);
    TEST_ASSERT_EQUAL_STRING("{\"scene\":\"ring\"}", d.sinks[0].captured_body);  // corps défaut typé
    TEST_ASSERT_EQUAL_STRING("", d.ctx.vars[ctx_find(&d.ctx,"scene")].str);      // retombé à ""
}
void test_live_write_clears_stale_capture(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "bell", 1, 5000);
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);
    dash_ctx_write_ui_num(&d, "bell", 2, 6000);          // write live sur la même var
    TEST_ASSERT_FALSE(d.sinks[0].has_capture);           // capture effacée
    TEST_ASSERT_EQUAL_UINT32(6000, d.sinks[0].pending_since);
}
void test_pulse_arms_only_matching_watch(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "other", 1, 5000);
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);
    TEST_ASSERT_FALSE(d.sinks[0].has_capture);
}
void test_repeated_pulse_rearms_same_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "bell", 1, 5000);
    d.sinks[0].pending_since = 0; d.sinks[0].has_capture = false;   // simule un tir consommé
    dash_ctx_pulse_num(&d, "bell", 1, 8000);                        // même valeur
    TEST_ASSERT_EQUAL_UINT32(8000, d.sinks[0].pending_since);       // ré-armé malgré valeur inchangée
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);
}

// --- context_apply : variables liees -> composants ---
static const char* bound_layout(const char* type, const char* extra) {
    static char b[256];
    snprintf(b, sizeof(b),
        "{\"components\":{\"x\":{\"type\":\"%s\",\"bind\":\"v\"%s}},"
        "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"x\"}]}]}", type, extra);
    return b;
}
void test_ctxapply_readout_num_formats(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("readout", ",\"unit\":\"C\""), err, sizeof(err));
    dash_set_context(&d, "{\"v\":21}", 1);
    context_apply(&d);
    int i = dash_find(&d,"x");
    TEST_ASSERT_EQUAL_STRING("21 C", d.components[i].vstr);
    TEST_ASSERT_TRUE(d.components[i].dirty);
}
void test_ctxapply_readout_string(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("readout", ""), err, sizeof(err));
    dash_set_context(&d, "{\"v\":\"OK\"}", 1);
    context_apply(&d);
    TEST_ASSERT_EQUAL_STRING("OK", d.components[dash_find(&d,"x")].vstr);
}
void test_ctxapply_bar_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("bar", ""), err, sizeof(err));
    dash_set_context(&d, "{\"v\":63}", 1);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(63, d.components[dash_find(&d,"x")].value);
}
void test_ctxapply_slider_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("slider", ",\"min\":0,\"max\":100"), err, sizeof(err));
    dash_set_context(&d, "{\"v\":42}", 1);
    context_apply(&d);
    int i = dash_find(&d,"x");
    TEST_ASSERT_EQUAL_INT(42, d.components[i].value);
    TEST_ASSERT_TRUE(d.components[i].dirty);
}
void test_ctxapply_arc_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("arc", ",\"min\":0,\"max\":255"), err, sizeof(err));
    dash_set_context(&d, "{\"v\":128}", 1);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(128, d.components[dash_find(&d,"x")].value);
}
void test_ctxapply_roller_index(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("roller", ",\"options\":[\"A\",\"B\",\"C\"]"), err, sizeof(err));
    dash_set_context(&d, "{\"v\":2}", 1);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(2, d.components[dash_find(&d,"x")].value);
}
void test_switch_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"s\":{\"type\":\"switch\",\"bind\":\"lamp\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "s");
    TEST_ASSERT_EQUAL_INT(COMP_SWITCH, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("lamp", d.components[i].bind);
}
void test_ctxapply_switch_reflects(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("switch", ""), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":1}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(1, d.components[i].value);
    TEST_ASSERT_TRUE(d.components[i].dirty);
    dash_set_context(&d, "{\"v\":0}", 2); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[i].value);
}
void test_button_parsed_num(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"scene\",\"value\":2,\"text\":\"Film\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_EQUAL_INT(COMP_BUTTON, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("scene", d.components[i].bind);
    TEST_ASSERT_TRUE(d.components[i].set_is_num);
    TEST_ASSERT_TRUE(d.components[i].set_value_num == 2.0);   // double pre-parse, pas de round-trip %g
    TEST_ASSERT_EQUAL_STRING("2", d.components[i].set_value);
    TEST_ASSERT_EQUAL_STRING("Film", d.components[i].text);
}
void test_button_parsed_str(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"mode\",\"value\":\"movie\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_FALSE(d.components[i].set_is_num);
    TEST_ASSERT_EQUAL_STRING("movie", d.components[i].set_value);
}
void test_slider_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"s\":{\"type\":\"slider\",\"bind\":\"vol\",\"min\":0,\"max\":10,"
                    "\"step\":2,\"orientation\":\"vertical\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "s");
    TEST_ASSERT_EQUAL_INT(COMP_SLIDER, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("vol", d.components[i].bind);
    TEST_ASSERT_EQUAL_INT(0,  d.components[i].vmin);
    TEST_ASSERT_EQUAL_INT(10, d.components[i].vmax);
    TEST_ASSERT_EQUAL_INT(2,  d.components[i].step);
    TEST_ASSERT_TRUE(d.components[i].bar_vertical);
}
void test_slider_quantize_snaps(void) {
    TEST_ASSERT_EQUAL_INT(10, slider_quantize(12, 0, 100, 5));   // 12 -> 10
    TEST_ASSERT_EQUAL_INT(15, slider_quantize(13, 0, 100, 5));   // 13 -> 15
    TEST_ASSERT_EQUAL_INT(20, slider_quantize(22, 10, 100, 5));  // offset vmin : (22-10)/5=2.4 -> 20
}
void test_slider_quantize_off_when_step_zero(void) {
    TEST_ASSERT_EQUAL_INT(42, slider_quantize(42, 0, 100, 0));   // step<=0 -> pas de quantification
    TEST_ASSERT_EQUAL_INT(42, slider_quantize(42, 0, 100, -3));
}
void test_slider_quantize_clamps_to_vmax(void) {
    TEST_ASSERT_EQUAL_INT(10, slider_quantize(10, 0, 10, 4));    // arrondi donnerait 12 -> borné à 10
    TEST_ASSERT_EQUAL_INT(10, slider_quantize(10, 0, 10, 6));    // idem : 12 -> 10
}
void test_slider_quantize_clamps_to_vmin(void) {
    TEST_ASSERT_EQUAL_INT(0, slider_quantize(-5, 0, 10, 4));     // arrondi donnerait -4 -> borné à 0
}
void test_arc_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"a\":{\"type\":\"arc\",\"bind\":\"dim\",\"min\":0,\"max\":255}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "a");
    TEST_ASSERT_EQUAL_INT(COMP_ARC, d.components[i].type);
    TEST_ASSERT_EQUAL_INT(255, d.components[i].vmax);
}
void test_roller_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"r\":{\"type\":\"roller\",\"bind\":\"src\","
                    "\"options\":[\"HDMI\",\"TV\",\"AUX\"],\"rows\":5}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "r");
    TEST_ASSERT_EQUAL_INT(COMP_ROLLER, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("HDMI\nTV\nAUX", d.components[i].roller_options);
    TEST_ASSERT_EQUAL_INT(5, d.components[i].roller_rows);
}
void test_button_momentary_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"bell\",\"value\":1,"
                    "\"momentary\":true}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_TRUE(d.components[i].momentary);
}
void test_button_set_defaults_not_momentary(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"scene\",\"value\":2}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_FALSE(d.components[dash_find(&d,"b")].momentary);
}
void test_ctxapply_button_radio(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("button", ",\"value\":2"), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":2}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(1, d.components[i].value);
    dash_set_context(&d, "{\"v\":3}", 2); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[i].value);
}
void test_ctxapply_button_radio_str(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("button", ",\"value\":\"movie\""), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":\"movie\"}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(1, d.components[i].value);
    dash_set_context(&d, "{\"v\":\"music\"}", 2); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[i].value);
}
void test_bar_label_style_parsed(void) {
    Dashboard d{}; char err[80];
    const char* j = "{\"components\":{\"b\":{\"type\":\"bar\",\"label\":\"RAM\","
                    "\"label_color\":\"#FF0000\",\"label_font\":20,\"label_align\":\"BOTTOM_MID\"}},"
                    "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"b\"}]}]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, j, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_EQUAL_HEX32(0xFF0000, d.components[i].label_color);
    TEST_ASSERT_EQUAL_INT(20, d.components[i].label_font);
    TEST_ASSERT_EQUAL_INT(A_BOTTOM_MID, d.components[i].label_align);
}
void test_bar_label_style_defaults(void) {
    Dashboard d{}; char err[80];
    const char* j = "{\"components\":{\"b\":{\"type\":\"bar\",\"label\":\"RAM\"}},"
                    "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"b\"}]}]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, j, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_EQUAL_HEX32(0x9AA0AA, d.components[i].label_color);
    TEST_ASSERT_EQUAL_INT(14, d.components[i].label_font);
    TEST_ASSERT_EQUAL_INT(A_TOP_MID, d.components[i].label_align);
}
void test_ctxapply_unchanged_not_dirty(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("bar", ""), err, sizeof(err));
    dash_set_context(&d, "{\"v\":63}", 1);
    context_apply(&d);
    d.components[dash_find(&d,"x")].dirty = false;
    context_apply(&d);                                  // meme valeur : pas de re-dirty
    TEST_ASSERT_FALSE(d.components[dash_find(&d,"x")].dirty);
}
void test_ctxapply_missing_var_keeps_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("bar", ""), err, sizeof(err));
    d.components[dash_find(&d,"x")].value = 7;
    context_apply(&d);                                  // variable "v" absente
    TEST_ASSERT_EQUAL_INT(7, d.components[dash_find(&d,"x")].value);
}
void test_ctxapply_meter_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("meter", ""), err, sizeof(err));
    dash_set_context(&d, "{\"v\":55}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(55, d.components[dash_find(&d,"x")].value);
}
void test_ctxapply_chart_appends_on_change(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("chart", ",\"points\":5"), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":10}", 1); context_apply(&d);
    dash_set_context(&d, "{\"v\":10}", 2); context_apply(&d);   // même valeur -> pas de 2e append
    TEST_ASSERT_EQUAL_INT(1, d.components[i].hist_count);
    dash_set_context(&d, "{\"v\":20}", 3); context_apply(&d);   // change -> append
    TEST_ASSERT_EQUAL_INT(2,  d.components[i].hist_count);
    TEST_ASSERT_EQUAL_INT(10, d.components[i].hist[0]);
    TEST_ASSERT_EQUAL_INT(20, d.components[i].hist[1]);
}

// --- image_anim : parse du layout ---
static const char* LAYOUT_AIMG =
  "{\"components\":{"
  "  \"sp\":{\"type\":\"image_anim\",\"src\":\"abcd1234\",\"w\":64,\"h\":64,"
  "         \"frames\":6,\"period\":80,\"rest_frame\":2,\"loop\":3,\"autoplay\":true}},"
  " \"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"sp\",\"anchor\":\"CENTER\"}]}]}";

static const char* LAYOUT_AIMG_BIND =
  "{\"components\":{"
  "  \"sp\":{\"type\":\"image_anim\",\"src\":\"abcd1234\",\"w\":64,\"h\":64,"
  "         \"frames\":4,\"bind\":\"st\"}},"
  " \"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"sp\",\"anchor\":\"CENTER\"}]}]}";

void test_layout_image_anim_parsed(void) {
    static Dashboard d; char err[64];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err)));
    Component& c = d.components[0];
    TEST_ASSERT_EQUAL_INT(COMP_IMAGE_ANIM, c.type);
    TEST_ASSERT_EQUAL_STRING("abcd1234", c.image_src);
    TEST_ASSERT_EQUAL_INT(64, c.image_w);
    TEST_ASSERT_EQUAL_INT(64, c.image_h);
    TEST_ASSERT_EQUAL_INT(6,  c.aimg_frames);
    TEST_ASSERT_EQUAL_INT(80, c.aimg_period);
    TEST_ASSERT_EQUAL_INT(2,  c.aimg_rest);
    TEST_ASSERT_EQUAL_INT(3,  c.aimg_loop);
    TEST_ASSERT_TRUE(c.aimg_autoplay);
    TEST_ASSERT_TRUE(c.aimg_playing);
    TEST_ASSERT_EQUAL_INT(0, c.value);
    TEST_ASSERT_EQUAL_INT(3, c.aimg_loops_left);
}

// --- image_anim : apply /update ---
void test_update_aimg_frame_jumps_and_stops(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"frame\":4}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(4, d.components[0].value);
    TEST_ASSERT_FALSE(d.components[0].aimg_playing);
}
void test_update_aimg_frame_clamps(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"frame\":99}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(5, d.components[0].value);
}
void test_update_aimg_play_sets_state(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"play\":true,\"loop\":2,\"period\":40}}", unk, sizeof(unk));
    Component& c = d.components[0];
    TEST_ASSERT_TRUE(c.aimg_playing);
    TEST_ASSERT_EQUAL_INT(40, c.aimg_period_ms);
    TEST_ASSERT_EQUAL_INT(2, c.aimg_loops_left);
    TEST_ASSERT_EQUAL_INT(0, c.value);
}
void test_update_aimg_play_loop0_infinite(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"play\":true,\"loop\":0}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(-1, d.components[0].aimg_loops_left);
}
void test_update_aimg_stop(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"stop\":true}}", unk, sizeof(unk));
    TEST_ASSERT_FALSE(d.components[0].aimg_playing);
    TEST_ASSERT_EQUAL_INT(2, d.components[0].value);   // stop -> frame de repos (spec)
}
void test_update_aimg_frame_clamps_negative(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"frame\":-3}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(0, d.components[0].value);
}
void test_update_aimg_play_period_defaults(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));   // period 80 in layout
    dash_apply_update(&d, "{\"sp\":{\"play\":true}}", unk, sizeof(unk));
    TEST_ASSERT_EQUAL_INT(80, d.components[0].aimg_period_ms);
}

// --- context_apply : image_anim bind = frame d'etat ---
void test_ctxapply_aimg_bind_selects_frame(void) {
    static Dashboard d; char err[64];
    dash_set_layout(&d, LAYOUT_AIMG_BIND, err, sizeof(err));
    dash_set_context(&d, "{\"st\":3}", 1000);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(3, d.components[0].value);
}
void test_ctxapply_aimg_bind_clamps(void) {
    static Dashboard d; char err[64];
    dash_set_layout(&d, LAYOUT_AIMG_BIND, err, sizeof(err));
    dash_set_context(&d, "{\"st\":9}", 1000);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(3, d.components[0].value);   // clamp a frames-1 = 3
}
void test_ctxapply_aimg_bind_ignored_while_playing(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG_BIND, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"play\":true}}", unk, sizeof(unk));  // value->0, playing
    dash_set_context(&d, "{\"st\":3}", 1000);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[0].value);   // bind ignore pendant la lecture
}

// --- dash_tick_aimg : moteur d'avance de frame ---
void test_aimg_tick_advances_after_period(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));
    dash_apply_update(&d, "{\"sp\":{\"play\":true,\"loop\":0,\"period\":50}}", unk, sizeof(unk));
    dash_tick_aimg(&d, 1000);                  // 1er tick : pose last, n'avance pas (frame 0 affichee)
    TEST_ASSERT_EQUAL_INT(0, d.components[0].value);
    dash_tick_aimg(&d, 1040);                  // < periode : rien
    TEST_ASSERT_EQUAL_INT(0, d.components[0].value);
    dash_tick_aimg(&d, 1060);                  // >= periode : frame 0 -> 1
    TEST_ASSERT_EQUAL_INT(1, d.components[0].value);
    TEST_ASSERT_TRUE(d.components[0].dirty);
}
void test_aimg_tick_finite_loop_settles_to_rest(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));   // 6 frames, rest_frame=2
    dash_apply_update(&d, "{\"sp\":{\"play\":true,\"loop\":1,\"period\":10}}", unk, sizeof(unk));
    uint32_t t = 1000;
    dash_tick_aimg(&d, t);                                // pose last (frame 0)
    for (int i = 0; i < 6; i++) { t += 10; dash_tick_aimg(&d, t); }  // 0->1->2->3->4->5->wrap
    TEST_ASSERT_FALSE(d.components[0].aimg_playing);
    TEST_ASSERT_EQUAL_INT(2, d.components[0].value);      // settle a rest_frame
}
void test_aimg_tick_infinite_keeps_playing(void) {
    static Dashboard d; char err[64], unk[64];
    dash_set_layout(&d, LAYOUT_AIMG, err, sizeof(err));   // 6 frames
    dash_apply_update(&d, "{\"sp\":{\"play\":true,\"loop\":0,\"period\":10}}", unk, sizeof(unk));
    uint32_t t = 1000;
    dash_tick_aimg(&d, t);
    for (int i = 0; i < 14; i++) { t += 10; dash_tick_aimg(&d, t); }  // > 2 tours
    TEST_ASSERT_TRUE(d.components[0].aimg_playing);       // infini : ne s'arrete jamais seul
}

void test_icon_resolve(void) {
    // base = (sym 2, couleur 0x00FF00). Bandes : <15 -> (sym 0, 0xFF0000) ; <50 -> (couleur 0xFFAA00, sym omis)
    IconState st[2];
    st[0].at = 15; st[0].symbol = 0; st[0].color = 0xFF0000; st[0].has_symbol = true;  st[0].has_color = true;
    st[1].at = 50; st[1].symbol = 0; st[1].color = 0xFFAA00; st[1].has_symbol = false; st[1].has_color = true;
    uint8_t sym; uint32_t col;
    icon_resolve(st, 2, 10, 2, 0x00FF00, &sym, &col);   // <15
    TEST_ASSERT_EQUAL_UINT8(0, sym); TEST_ASSERT_EQUAL_HEX32(0xFF0000, col);
    icon_resolve(st, 2, 30, 2, 0x00FF00, &sym, &col);   // <50 : sym omis -> base 2
    TEST_ASSERT_EQUAL_UINT8(2, sym); TEST_ASSERT_EQUAL_HEX32(0xFFAA00, col);
    icon_resolve(st, 2, 15, 2, 0x00FF00, &sym, &col);  // == st[0].at : pas de match band0, puis 15 < 50 -> band1 (couleur seule)
    TEST_ASSERT_EQUAL_UINT8(2, sym); TEST_ASSERT_EQUAL_HEX32(0xFFAA00, col);
    icon_resolve(st, 2, 90, 2, 0x00FF00, &sym, &col);   // aucune -> base
    TEST_ASSERT_EQUAL_UINT8(2, sym); TEST_ASSERT_EQUAL_HEX32(0x00FF00, col);
    icon_resolve(st, 0, 90, 5, 0x123456, &sym, &col);   // table vide -> base
    TEST_ASSERT_EQUAL_UINT8(5, sym); TEST_ASSERT_EQUAL_HEX32(0x123456, col);
}

static const char* LAYOUT_ICON =
  "{\"components\":{"
    "\"i1\":{\"type\":\"icon\",\"symbol\":\"wifi\",\"color\":\"#00FF00\",\"font\":36,"
      "\"states\":[{\"at\":1,\"symbol\":\"close\",\"color\":\"#FF0000\"},{\"at\":50,\"color\":\"#FFAA00\"}]},"
    "\"i2\":{\"type\":\"icon\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"i1\"},{\"ref\":\"i2\"}]}]}";

void test_icon_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_ICON, err, sizeof(err)), err);
    int i1 = dash_find(&d, "i1"), i2 = dash_find(&d, "i2");
    TEST_ASSERT_TRUE(i1 >= 0 && i2 >= 0);
    const Component& a = d.components[i1];
    TEST_ASSERT_EQUAL_INT(COMP_ICON, a.type);
    TEST_ASSERT_EQUAL_HEX32(0x00FF00, a.color);
    TEST_ASSERT_EQUAL_INT(36, a.font);
    TEST_ASSERT_EQUAL_UINT8(0, a.icon_symbol);                       // "wifi" -> index 0
    TEST_ASSERT_EQUAL_INT(2, a.icon_state_count);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, a.icon_states[0].at);
    TEST_ASSERT_TRUE(a.icon_states[0].has_symbol);
    TEST_ASSERT_TRUE(a.icon_states[0].has_color);
    TEST_ASSERT_EQUAL_HEX32(0xFF0000, a.icon_states[0].color);
    TEST_ASSERT_FALSE(a.icon_states[1].has_symbol);    // 2e bande : color seul
    TEST_ASSERT_TRUE(a.icon_states[1].has_color);
    // i2 : défauts (font 28 specifique icon, base bell, pas d'états)
    TEST_ASSERT_EQUAL_INT(28, d.components[i2].font);
    TEST_ASSERT_EQUAL_UINT8(11, d.components[i2].icon_symbol);       // défaut "bell" -> index 11
    TEST_ASSERT_EQUAL_INT(0, d.components[i2].icon_state_count);
}

#define LAYOUT_FONTS "{\"components\":{\"l\":{\"type\":\"label\",\"text\":\"x\",\"font\":24,\"font_family\":\"lora\",\"bold\":true,\"italic\":true}},\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"l\",\"anchor\":\"CENTER\"}]}]}"

void test_font_family_parse(void) {
    Dashboard d; char err[128];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_FONTS, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(1, d.comp_count);
    TEST_ASSERT_EQUAL_INT(24, d.components[0].font);
    TEST_ASSERT_EQUAL_INT(FAMILY_LORA, d.components[0].font_family);
    TEST_ASSERT_TRUE(d.components[0].bold);
    TEST_ASSERT_TRUE(d.components[0].italic);
}

void test_font_family_default(void) {
    Dashboard d; char err[128];
    const char *L = "{\"components\":{\"l\":{\"type\":\"label\",\"text\":\"x\"}},\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"l\",\"anchor\":\"CENTER\"}]}]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(FAMILY_MONTSERRAT, d.components[0].font_family);
    TEST_ASSERT_FALSE(d.components[0].bold);
    TEST_ASSERT_FALSE(d.components[0].italic);
}

void test_sink_should_fire_debounce(void) {
    TEST_ASSERT_FALSE(sink_should_fire(0, 1000, 300));        // pending_since=0 -> jamais
    TEST_ASSERT_FALSE(sink_should_fire(1000, 1200, 300));     // armé t=1000, pas encore à t=1200
    TEST_ASSERT_TRUE (sink_should_fire(1000, 1300, 300));     // oui à t=1300
    TEST_ASSERT_TRUE (sink_should_fire(1000, 1000, 0));       // débounce 0 -> dès armé
}

void test_sink_body_default(void) {
    Context c{}; ctx_set_num(&c, "lamp", 1, 0);
    char out[128];
    sink_render_body("", "lamp", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"lamp\":1}", out);
}
void test_sink_body_default_str(void) {
    Context c{}; ctx_set_str(&c, "mode", "eco", 0);
    char out[128];
    sink_render_body("", "mode", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"mode\":\"eco\"}", out);
}
void test_sink_body_template_num_quoted(void) {
    Context c{}; ctx_set_num(&c, "lamp", 42, 0);
    char out[128];
    sink_render_body("{\"state\":\"{{lamp}}\"}", "lamp", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"state\":\"42\"}", out);
}
void test_sink_body_template_num_raw(void) {
    Context c{}; ctx_set_num(&c, "lamp", 42, 0);
    char out[128];
    sink_render_body("{\"v\":{{lamp}}}", "lamp", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"v\":42}", out);
}
void test_sink_body_template_missing_var(void) {
    Context c{};
    char out[128];
    sink_render_body("{\"v\":\"{{absent}}\"}", "absent", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"v\":\"\"}", out);
}

// --- ctx_to_json : sérialisation du contexte ---
void test_ctx_to_json_all(void) {
    Context c{}; ctx_set_num(&c, "lamp", 1, 0); ctx_set_num(&c, "volume", 42, 0);
    char out[256];
    ctx_to_json(&c, nullptr, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"lamp\":1,\"volume\":42}", out);
}
void test_ctx_to_json_filter(void) {
    Context c{}; ctx_set_num(&c, "lamp", 1, 0); ctx_set_num(&c, "volume", 42, 0);
    char out[256];
    ctx_to_json(&c, "volume", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"volume\":42}", out);
}
void test_ctx_to_json_filter_multi(void) {
    Context c{}; ctx_set_num(&c, "a", 1, 0); ctx_set_num(&c, "b", 2, 0); ctx_set_num(&c, "c", 3, 0);
    char out[256];
    ctx_to_json(&c, "a,c", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"a\":1,\"c\":3}", out);
}
void test_ctx_to_json_str(void) {
    Context c{}; ctx_set_str(&c, "host", "srv1", 0);
    char out[256];
    ctx_to_json(&c, nullptr, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"host\":\"srv1\"}", out);
}

// --- wifi_list (cœur pur du provisioning WiFi) ---
void test_wifi_upsert_append_and_replace(void) {
    WifiNet n[5]; int c = 0;
    TEST_ASSERT_EQUAL_INT(0, wifi_list_upsert(n, &c, 5, "home", "pw1"));
    TEST_ASSERT_EQUAL_INT(1, c);
    TEST_ASSERT_EQUAL_INT(0, wifi_list_upsert(n, &c, 5, "home", "pw2"));  // même SSID -> remplace
    TEST_ASSERT_EQUAL_INT(1, c);                                         // pas d'ajout
    TEST_ASSERT_EQUAL_STRING("pw2", n[0].pass);
}
void test_wifi_upsert_full_rejects(void) {
    WifiNet n[2]; int c = 0;
    wifi_list_upsert(n, &c, 2, "a", "");
    wifi_list_upsert(n, &c, 2, "b", "");
    TEST_ASSERT_EQUAL_INT(-1, wifi_list_upsert(n, &c, 2, "c", ""));      // plein -> -1
    TEST_ASSERT_EQUAL_INT(2, c);
}
void test_wifi_remove(void) {
    WifiNet n[3]; int c = 0;
    wifi_list_upsert(n, &c, 3, "a", "");
    wifi_list_upsert(n, &c, 3, "b", "");
    TEST_ASSERT_TRUE(wifi_list_remove(n, &c, "a"));
    TEST_ASSERT_EQUAL_INT(1, c);
    TEST_ASSERT_EQUAL_STRING("b", n[0].ssid);                           // décalage vers le bas
    TEST_ASSERT_FALSE(wifi_list_remove(n, &c, "zzz"));                  // absent -> false
}
void test_wifi_roundtrip(void) {
    WifiNet n[5]; int c = 0;
    wifi_list_upsert(n, &c, 5, "home", "secret");
    wifi_list_upsert(n, &c, 5, "cafe", "");
    char json[256]; wifi_list_serialize(n, c, json, sizeof(json));
    WifiNet m[5]; int mc = wifi_list_parse(json, m, 5);
    TEST_ASSERT_EQUAL_INT(2, mc);
    TEST_ASSERT_EQUAL_STRING("home", m[0].ssid);
    TEST_ASSERT_EQUAL_STRING("secret", m[0].pass);
    TEST_ASSERT_EQUAL_STRING("cafe", m[1].ssid);
}
void test_wifi_parse_garbage_empty(void) {
    WifiNet m[5];
    TEST_ASSERT_EQUAL_INT(0, wifi_list_parse("not json", m, 5));        // corrompu -> 0
    TEST_ASSERT_EQUAL_INT(0, wifi_list_parse("{}", m, 5));              // pas de clé nets -> 0
}

// --- clock_geom : logique pure des aiguilles + format digital ---
void test_clock_angles_noon(void) {
    float h, m, s; clock_hand_angles(12, 0, 0, &h, &m, &s);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, h);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, m);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, s);
}
void test_clock_angles_quarter(void) {
    float h, m, s; clock_hand_angles(3, 0, 0, &h, &m, &s);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 90.0f, h);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, m);
}
void test_clock_angles_half_past(void) {
    float h, m, s; clock_hand_angles(6, 30, 0, &h, &m, &s);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 195.0f, h);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 180.0f, m);
}
void test_clock_digital(void) {
    char buf[16];
    clock_format_digital(9, 5, 7, false, buf, sizeof(buf));
    TEST_ASSERT_EQUAL_STRING("09:05", buf);
    clock_format_digital(9, 5, 7, true, buf, sizeof(buf));
    TEST_ASSERT_EQUAL_STRING("09:05:07", buf);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_remaining_seconds);
    RUN_TEST(test_remaining_min_boundary);
    RUN_TEST(test_remaining_minutes);
    RUN_TEST(test_remaining_hour);
    RUN_TEST(test_remaining_h_m);
    RUN_TEST(test_remaining_days);
    RUN_TEST(test_remaining_zero);
    RUN_TEST(test_value_unit);
    RUN_TEST(test_value_float);
    RUN_TEST(test_value_no_unit);
    RUN_TEST(test_countdown_decrements_and_formats);
    RUN_TEST(test_countdown_floor_zero);
    RUN_TEST(test_update_partial_leaves_others);
    RUN_TEST(test_update_ring_object);
    RUN_TEST(test_update_unknown_reported_not_applied);
    RUN_TEST(test_update_led_ring_mode_color_value);
    RUN_TEST(test_led_ring_config_drives_boot);
    RUN_TEST(test_led_ring_config_defaults_off);
    RUN_TEST(test_update_sound_sets_pending);
    RUN_TEST(test_chart_ring_keeps_last_n);
    RUN_TEST(test_chart_points_parsed_and_clamped);
    RUN_TEST(test_update_meter_value);
    RUN_TEST(test_update_bar_object_or_bare_value);
    RUN_TEST(test_update_label_object_or_bare_text);
    RUN_TEST(test_update_readout_object_value_formats);
    RUN_TEST(test_visible_defaults_true);
    RUN_TEST(test_update_visible_toggles);
    RUN_TEST(test_update_visible_only_keeps_value);
    RUN_TEST(test_update_value_and_visible_together);
    RUN_TEST(test_layout_visible_config_time);
    RUN_TEST(test_layout_image_anim_parsed);
    RUN_TEST(test_update_aimg_frame_jumps_and_stops);
    RUN_TEST(test_update_aimg_frame_clamps);
    RUN_TEST(test_update_aimg_play_sets_state);
    RUN_TEST(test_update_aimg_play_loop0_infinite);
    RUN_TEST(test_update_aimg_stop);
    RUN_TEST(test_update_aimg_frame_clamps_negative);
    RUN_TEST(test_update_aimg_play_period_defaults);
    RUN_TEST(test_ctxapply_meter_value);
    RUN_TEST(test_ctxapply_chart_appends_on_change);
    RUN_TEST(test_switch_parsed);
    RUN_TEST(test_ctxapply_switch_reflects);
    RUN_TEST(test_button_parsed_num);
    RUN_TEST(test_button_parsed_str);
    RUN_TEST(test_slider_parsed);
    RUN_TEST(test_slider_quantize_snaps);
    RUN_TEST(test_slider_quantize_off_when_step_zero);
    RUN_TEST(test_slider_quantize_clamps_to_vmax);
    RUN_TEST(test_slider_quantize_clamps_to_vmin);
    RUN_TEST(test_arc_parsed);
    RUN_TEST(test_roller_parsed);
    RUN_TEST(test_button_momentary_parsed);
    RUN_TEST(test_button_set_defaults_not_momentary);
    RUN_TEST(test_ctxapply_button_radio);
    RUN_TEST(test_ctxapply_button_radio_str);
    RUN_TEST(test_layout_parse_counts);
    RUN_TEST(test_page_background_override_and_inherit);
    RUN_TEST(test_page_background_image_parsed);
    RUN_TEST(test_layout_types_and_geom);
    RUN_TEST(test_ring_center_pct_parsed);
    RUN_TEST(test_ring_start_angle_parsed);
    RUN_TEST(test_ring_start_angle_default_zero);
    RUN_TEST(test_ring_center_color_set);
    RUN_TEST(test_ring_center_color_defaults_to_color);
    RUN_TEST(test_ring_cap_prefix_parsed);
    RUN_TEST(test_ring_cap_prefix_default_empty);
    RUN_TEST(test_ring_cap_font_parsed);
    RUN_TEST(test_bar_options_parsed);
    RUN_TEST(test_ring_mode_rounded_parsed);
    RUN_TEST(test_bar_ring_option_defaults);
    RUN_TEST(test_ring_center_parsed);
    RUN_TEST(test_layout_unknown_type_rejected);
    RUN_TEST(test_schema_types_all_resolve);
    RUN_TEST(test_icon_resolve);
    RUN_TEST(test_icon_parsed);
    RUN_TEST(test_shapes_parsed);
    RUN_TEST(test_label_box_parsed);
    RUN_TEST(test_ctx_set_find_num);
    RUN_TEST(test_ctx_overwrite_keeps_one_slot);
    RUN_TEST(test_ctx_full_rejects);
    RUN_TEST(test_wifi_upsert_append_and_replace);
    RUN_TEST(test_wifi_upsert_full_rejects);
    RUN_TEST(test_wifi_remove);
    RUN_TEST(test_wifi_roundtrip);
    RUN_TEST(test_wifi_parse_garbage_empty);
    RUN_TEST(test_ptr_nested_object);
    RUN_TEST(test_ptr_array_index);
    RUN_TEST(test_ptr_missing_is_null);
    RUN_TEST(test_ptr_escape);
    RUN_TEST(test_ctx_apply_json_num_and_str);
    RUN_TEST(test_layout_bind_parsed);
    RUN_TEST(test_dash_set_context_writes_ctx);
    RUN_TEST(test_sources_parse_counts);
    RUN_TEST(test_sources_headers_and_vars);
    RUN_TEST(test_sources_interval_floor);
    RUN_TEST(test_sources_url_required);
    RUN_TEST(test_no_sources_is_zero);
    RUN_TEST(test_sinks_parse_counts);
    RUN_TEST(test_sinks_headers_and_body);
    RUN_TEST(test_sinks_method_defaults_post);
    RUN_TEST(test_sinks_url_required);
    RUN_TEST(test_sinks_watch_required);
    RUN_TEST(test_no_sinks_is_zero);
    RUN_TEST(test_ctxapply_readout_num_formats);
    RUN_TEST(test_ctxapply_readout_string);
    RUN_TEST(test_ctxapply_bar_value);
    RUN_TEST(test_ctxapply_slider_value);
    RUN_TEST(test_ctxapply_arc_value);
    RUN_TEST(test_ctxapply_roller_index);
    RUN_TEST(test_bar_label_style_parsed);
    RUN_TEST(test_bar_label_style_defaults);
    RUN_TEST(test_ctxapply_unchanged_not_dirty);
    RUN_TEST(test_ctxapply_missing_var_keeps_value);
    RUN_TEST(test_ctxapply_aimg_bind_selects_frame);
    RUN_TEST(test_ctxapply_aimg_bind_clamps);
    RUN_TEST(test_ctxapply_aimg_bind_ignored_while_playing);
    RUN_TEST(test_aimg_tick_advances_after_period);
    RUN_TEST(test_aimg_tick_finite_loop_settles_to_rest);
    RUN_TEST(test_aimg_tick_infinite_keeps_playing);
    RUN_TEST(test_layout_invalid_keeps_old);
    RUN_TEST(test_hex_parse);
    RUN_TEST(test_hex_no_hash);
    RUN_TEST(test_hex_fallback);
    RUN_TEST(test_bgkey_valid_hex);
    RUN_TEST(test_bgkey_valid_short);
    RUN_TEST(test_bgkey_reject_empty);
    RUN_TEST(test_bgkey_reject_slash);
    RUN_TEST(test_bgkey_reject_dot);
    RUN_TEST(test_bgkey_reject_upper);
    RUN_TEST(test_bgkey_reject_toolong);
    RUN_TEST(test_threshold_below);
    RUN_TEST(test_threshold_mid);
    RUN_TEST(test_threshold_over);
    RUN_TEST(test_threshold_none);
    RUN_TEST(test_led_is_lit_boundary);
    RUN_TEST(test_led_parse);
    RUN_TEST(test_led_look_flags);
    RUN_TEST(test_next_mid);
    RUN_TEST(test_next_wrap);
    RUN_TEST(test_next_clamp);
    RUN_TEST(test_prev_wrap);
    RUN_TEST(test_prev_clamp);
    RUN_TEST(test_single_page);
    RUN_TEST(test_empty);
    RUN_TEST(test_asset_read_sd_when_active_and_present);
    RUN_TEST(test_asset_read_fallback_when_absent_on_sd);
    RUN_TEST(test_asset_read_littlefs_when_no_card);
    RUN_TEST(test_asset_resolve_prefixes_on_sd);
    RUN_TEST(test_asset_resolve_bare_on_littlefs);
    RUN_TEST(test_asset_resolve_truncates_gracefully);
    RUN_TEST(test_font_family_parse);
    RUN_TEST(test_font_family_default);
    RUN_TEST(test_sink_should_fire_debounce);
    RUN_TEST(test_sink_body_default);
    RUN_TEST(test_sink_body_default_str);
    RUN_TEST(test_sink_body_template_num_quoted);
    RUN_TEST(test_sink_body_template_num_raw);
    RUN_TEST(test_sink_body_template_missing_var);
    RUN_TEST(test_ui_write_arms_sink);
    RUN_TEST(test_external_write_does_not_arm);
    RUN_TEST(test_ui_write_arms_only_matching_watch);
    RUN_TEST(test_pulse_arms_and_captures_num);
    RUN_TEST(test_pulse_captures_and_resets_str);
    RUN_TEST(test_live_write_clears_stale_capture);
    RUN_TEST(test_pulse_arms_only_matching_watch);
    RUN_TEST(test_repeated_pulse_rearms_same_value);
    RUN_TEST(test_ctx_to_json_all);
    RUN_TEST(test_ctx_to_json_filter);
    RUN_TEST(test_ctx_to_json_filter_multi);
    RUN_TEST(test_ctx_to_json_str);
    RUN_TEST(test_clock_angles_noon);
    RUN_TEST(test_clock_angles_quarter);
    RUN_TEST(test_clock_angles_half_past);
    RUN_TEST(test_clock_digital);
    return UNITY_END();
}
