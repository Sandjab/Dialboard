#include "api.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <string.h>
#include "config.h"
#include "nav_input.h"
#include "view.h"
#include "persist.h"
#include "secret_store.h"
#include "wifi_store.h"
#include "freertos/semphr.h"
#include <lvgl.h>
#include "esp_heap_caps.h"
#include <LittleFS.h>
#include <Update.h>
#include "asset_fs.h"
#include "context.h"

extern String g_layout_json;
extern SemaphoreHandle_t g_ctx_mutex;

static Dashboard* D = nullptr;
static WebServer* S = nullptr;

static void h_update() {
    if (!S->hasArg("plain")) { S->send(400, "text/plain", "Empty body\n"); return; }
    char unk[UNKNOWN_CSV_LEN];
    int n = dash_apply_update(D, S->arg("plain").c_str(), unk, sizeof(unk));
    if (n < 0) { S->send(400, "text/plain", "Invalid JSON\n"); return; }
    JsonDocument res; res["ok"] = true; res["updated"] = n;
    if (unk[0]) res["unknown"] = unk;
    String out; serializeJson(res, out); out += "\n";
    S->send(200, "application/json", out);
}

static void h_get_context() {
    String filter = S->hasArg("vars") ? S->arg("vars") : String();
    // Heap, pas la pile du loop-task (~8 KB) — meme raison que le `static Dashboard t` de
    // dash_set_layout. 3072 couvre le pire cas 32 vars (MAX_CTX_VARS) avec strings echappees ;
    // ctx_to_json ecrit toujours (>= "{}", \0-termine), donc pas besoin d'init prealable.
    const size_t cap = 3072;
    char* out = (char*)malloc(cap);
    if (!out) { S->send(503, "text/plain", "Out of memory\n"); return; }
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    ctx_to_json(&D->ctx, filter.length() ? filter.c_str() : nullptr, out, cap);
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    String body = out; body += "\n";
    free(out);
    S->send(200, "application/json", body);
}

static void h_set_context() {
    if (!S->hasArg("plain")) { S->send(400, "text/plain", "Empty body\n"); return; }
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_set_context(D, S->arg("plain").c_str(), millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_set_secrets() {
    if (!S->hasArg("plain")) { S->send(400, "text/plain", "Empty body\n"); return; }
    if (!secret_store_merge(S->arg("plain").c_str())) { S->send(400, "text/plain", "Invalid JSON\n"); return; }
    S->send(200, "application/json", "{\"ok\":true}\n");   // ne renvoie JAMAIS le contenu
}

static void h_wifi_get() {
    char ssids[MAX_WIFI_NETS][33];
    int n = wifi_store_list_ssids(ssids, MAX_WIFI_NETS);
    JsonDocument doc;
    JsonArray arr = doc["nets"].to<JsonArray>();
    for (int i = 0; i < n; i++) arr.add(ssids[i]);
    doc["connected"] = WiFi.isConnected() ? WiFi.SSID() : String();
    String out; serializeJson(doc, out); out += "\n";
    S->send(200, "application/json", out);
}

static void h_wifi_post() {
    if (!S->hasArg("plain")) { S->send(400, "text/plain", "Empty body\n"); return; }
    JsonDocument doc;
    if (deserializeJson(doc, S->arg("plain"))) { S->send(400, "text/plain", "Invalid JSON\n"); return; }
    const char* ssid = doc["ssid"] | "";
    if (!ssid[0]) { S->send(400, "text/plain", "Missing ssid\n"); return; }
    if (!wifi_store_upsert(ssid, doc["pass"] | "")) { S->send(507, "text/plain", "Store full\n"); return; }
    S->send(200, "application/json", "{\"ok\":true}\n");   // ne renvoie JAMAIS le pass
}

static void h_wifi_delete() {
    String ssid = S->hasArg("ssid") ? S->arg("ssid") : String();
    if (!ssid.length())                   { S->send(400, "text/plain", "Missing ssid\n"); return; }
    if (!wifi_store_remove(ssid.c_str())) { S->send(404, "text/plain", "Not found\n");   return; }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_wifi_scan() {
    int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < n; i++) {
        JsonObject o = arr.add<JsonObject>();
        o["ssid"] = WiFi.SSID(i);
        o["rssi"] = WiFi.RSSI(i);
    }
    String out; serializeJson(doc, out); out += "\n";
    S->send(200, "application/json", out);
}

static void h_status() {
    JsonDocument doc;
    doc["ip"]         = WiFi.localIP().toString();
    doc["hostname"]   = String(MDNS_HOST) + ".local";
    doc["rssi"]       = WiFi.RSSI();
    doc["uptime_s"]   = (uint32_t)(millis() / 1000);
    doc["page"]       = D->active_page;
    doc["pages"]      = D->page_count;
    doc["components"] = D->comp_count;
    JsonObject sd = doc["sd"].to<JsonObject>();
    bool sd_mounted = asset_fs_sd_active();
    sd["mounted"] = sd_mounted;
    if (sd_mounted) {
        sd["size_mb"] = asset_fs_card_size_mb();
        sd["used_mb"] = asset_fs_card_used_mb();
    }
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    JsonArray arr = doc["sources"].to<JsonArray>();
    for (int i = 0; i < D->source_count; i++) {
        JsonObject o     = arr.add<JsonObject>();
        o["name"]        = D->sources[i].name;          // char[] -> ArduinoJson copie
        o["last_status"] = D->sources[i].last_status;
        o["err_count"]   = D->sources[i].err_count;
        o["updated_at"]  = D->sources[i].updated_at;
    }
    JsonArray sk = doc["sinks"].to<JsonArray>();
    for (int i = 0; i < D->sink_count; i++) {
        JsonObject o     = sk.add<JsonObject>();
        o["name"]        = D->sinks[i].name;
        o["last_status"] = D->sinks[i].last_status;
        o["err_count"]   = D->sinks[i].err_count;
        o["fired_at"]    = D->sinks[i].fired_at;
    }
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    String out; serializeJson(doc, out); out += "\n";
    S->send(200, "application/json", out);
}

static void h_root() {
    String ip = WiFi.localIP().toString();
    String html =
        "<!doctype html><meta charset=utf-8><title>Dialboard</title>"
        "<h2>K718 - Dialboard</h2>"
        "<p>POST /update (valeurs partielles), POST /layout, POST /page.</p>"
        "<pre>curl -X POST http://" + ip + "/update -H 'Content-Type: application/json' \\\n"
        "  -d '{\"w5h\":{\"pct\":63,\"reset_in_s\":6600}}'</pre>"
        "<p><a href=/status>/status</a> &middot; <a href=/layout>/layout</a> &middot; "
        "<a href=/screenshot>/screenshot</a> (capture ecran, image/bmp)</p>"
        "<p><a href=/designer/>Designer embarque</a> (editeur WYSIWYG du layout)</p>";
    S->send(200, "text/html", html);
}

static void h_set_layout() {
    if (!S->hasArg("plain")) { S->send(400, "text/plain", "Empty body\n"); return; }
    String body = S->arg("plain");
    char err[80];
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    bool ok = dash_set_layout(D, body.c_str(), err, sizeof(err));
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    if (!ok) {
        S->send(400, "application/json", String("{\"ok\":false,\"error\":\"") + err + "\"}\n");
        return;
    }
    g_layout_json = body;
    if (!persist_save(g_layout_json)) { S->send(500, "text/plain", "FS write failed\n"); return; }
    // Sweep : supprime les fonds /bg/*.565 que plus aucune page ne reference.
    {
        String victims[16]; int nv = 0;
        File dir = asset_fs_target().open(asset_resolve(BG_DIR));
        if (dir && dir.isDirectory()) {
            for (File e = dir.openNextFile(); e && nv < 16; e = dir.openNextFile()) {
                String full = e.name();                 // peut etre "/bg/<x>.565" ou "<x>.565" selon le core
                e.close();
                int slash = full.lastIndexOf('/');
                String base = (slash >= 0) ? full.substring(slash + 1) : full;
                if (!base.endsWith(".565")) continue;   // ignore _upload.tmp et autres
                String key = base.substring(0, base.length() - 4);
                bool referenced = false;
                for (int p = 0; p < D->page_count; p++)
                    if (key.length() && strcmp(D->pages[p].background_image, key.c_str()) == 0) { referenced = true; break; }
                if (!referenced) victims[nv++] = asset_resolve((String(BG_DIR) + "/" + base).c_str());
            }
            dir.close();
        }
        for (int i = 0; i < nv; i++) asset_fs_target().remove(victims[i]);
    }
    // Sweep : supprime les images /img/*.565a que plus aucun composant image ne reference.
    {
        String victims[16]; int nv = 0;
        File dir = asset_fs_target().open(asset_resolve(IMG_DIR));
        if (dir && dir.isDirectory()) {
            for (File e = dir.openNextFile(); e && nv < 16; e = dir.openNextFile()) {
                String full = e.name();
                e.close();
                int slash = full.lastIndexOf('/');
                String b = (slash >= 0) ? full.substring(slash + 1) : full;
                if (!b.endsWith(".565a")) continue;           // ignore _upload.tmp
                String key = b.substring(0, b.length() - 5);  // ".565a" = 5 caracteres
                bool referenced = false;
                for (int c = 0; c < D->comp_count; c++)
                    if (D->components[c].type == COMP_IMAGE && key.length() &&
                        strcmp(D->components[c].image_src, key.c_str()) == 0) { referenced = true; break; }
                if (!referenced) victims[nv++] = asset_resolve((String(IMG_DIR) + "/" + b).c_str());
            }
            dir.close();
        }
        for (int i = 0; i < nv; i++) asset_fs_target().remove(victims[i]);
    }
    // Sweep : supprime les packs /aimg/*.565p que plus aucun composant image_anim ne reference.
    {
        String victims[16]; int nv = 0;
        File dir = asset_fs_target().open(asset_resolve(AIMG_DIR));
        if (dir && dir.isDirectory()) {
            for (File e = dir.openNextFile(); e && nv < 16; e = dir.openNextFile()) {
                String full = e.name();
                e.close();
                int slash = full.lastIndexOf('/');
                String b = (slash >= 0) ? full.substring(slash + 1) : full;
                if (!b.endsWith(".565p")) continue;
                String key = b.substring(0, b.length() - 5);   // ".565p" = 5 caracteres
                bool referenced = false;
                for (int c = 0; c < D->comp_count; c++)
                    if (D->components[c].type == COMP_IMAGE_ANIM && key.length() &&
                        strcmp(D->components[c].image_src, key.c_str()) == 0) { referenced = true; break; }
                if (!referenced) victims[nv++] = asset_resolve((String(AIMG_DIR) + "/" + b).c_str());
            }
            dir.close();
        }
        for (int i = 0; i < nv; i++) asset_fs_target().remove(victims[i]);
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_get_layout() {
    S->send(200, "application/json", g_layout_json.length() ? g_layout_json : String("{}"));
}

static void h_page() {
    JsonDocument doc;
    if (!S->hasArg("plain") || deserializeJson(doc, S->arg("plain"))) {
        S->send(400, "text/plain", "Invalid JSON\n"); return;
    }
    if (doc["dir"].is<const char*>()) {
        nav_goto_dir(D, strcmp(doc["dir"], "prev") == 0 ? -1 : +1);
    } else if (doc["index"].is<int>()) {
        int idx = doc["index"];
        if (idx < 0 || idx >= D->page_count) {
            S->send(404, "text/plain", "page index out of range\n"); return;
        }
        view_show_page(D, idx);
    } else if (doc["name"].is<const char*>()) {
        const char* nm = doc["name"];
        int found = -1;
        for (int p = 0; p < D->page_count; p++)
            if (strcmp(D->pages[p].name, nm) == 0) { found = p; break; }
        if (found < 0) { S->send(404, "text/plain", "page name not found\n"); return; }
        view_show_page(D, found);
    }
    JsonDocument res; res["page"] = D->active_page;
    res["name"] = D->pages[D->active_page].name;
    String out; serializeJson(res, out); out += "\n";
    S->send(200, "application/json", out);
}

// GET /screenshot : capture pixel-perfect de l'ecran actif, encodee BMP 24-bit.
// LVGL est en double buffer partiel (pas de framebuffer plein ecran a relire), donc on
// re-rend l'ecran off-screen via lv_snapshot dans un buffer PSRAM, puis on streame le BMP
// ligne par ligne. Sur depuis ce handler : meme thread que lv_timer_handler() (cf. loop()).
// Contrepartie : bloque loop() (UI figee) le temps de la requete -- acceptable a la demande.
static void put_u32le(uint8_t* p, uint32_t v) {
    p[0] = v & 0xFF; p[1] = (v >> 8) & 0xFF; p[2] = (v >> 16) & 0xFF; p[3] = (v >> 24) & 0xFF;
}
static void h_screenshot() {
    lv_obj_t* scr = lv_screen_active();
    const uint32_t w = lv_display_get_horizontal_resolution(NULL);
    const uint32_t h = lv_display_get_vertical_resolution(NULL);
    // On snapshot en RGB565 NON swappe (rendu deterministe, independant du format du display),
    // puis on expanse R5G6B5 -> RGB888. Buffer alloue en PSRAM a la main : lv_snapshot_take()
    // passerait par l'allocateur LVGL (pool builtin 48 Ko) et echouerait sur 360x360.
    const uint32_t src_stride = lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565);
    const uint32_t data_size  = src_stride * h;
    uint8_t* mem = (uint8_t*)heap_caps_malloc(data_size, MALLOC_CAP_SPIRAM);
    if (!mem) { S->send(503, "text/plain", "PSRAM alloc failed\n"); return; }

    lv_draw_buf_t snap;
    lv_draw_buf_init(&snap, w, h, LV_COLOR_FORMAT_RGB565, src_stride, mem, data_size);
    if (lv_snapshot_take_to_draw_buf(scr, LV_COLOR_FORMAT_RGB565, &snap) != LV_RESULT_OK) {
        heap_caps_free(mem);
        S->send(500, "text/plain", "snapshot failed\n");
        return;
    }

    const uint32_t dst_stride = w * 3;       // BMP 24-bit ; 360*3 = 1080, deja multiple de 4
    const uint32_t img_size   = dst_stride * h;

    uint8_t hdr[54] = {0};                    // BITMAPFILEHEADER(14) + BITMAPINFOHEADER(40)
    hdr[0] = 'B'; hdr[1] = 'M';
    put_u32le(hdr + 2, 54 + img_size);        // taille fichier
    hdr[10] = 54;                             // offset des pixels
    hdr[14] = 40;                             // taille BITMAPINFOHEADER
    put_u32le(hdr + 18, w);
    put_u32le(hdr + 22, h);                   // h > 0 => bottom-up
    hdr[26] = 1;                              // planes
    hdr[28] = 24;                             // bits/pixel
    put_u32le(hdr + 34, img_size);            // biSizeImage

    uint8_t* row = (uint8_t*)malloc(dst_stride);
    if (!row) { heap_caps_free(mem); S->send(503, "text/plain", "row alloc failed\n"); return; }

    S->setContentLength(54 + img_size);
    S->send(200, "image/bmp", "");
    S->sendContent((const char*)hdr, 54);

    const uint8_t* data = snap.data;
    for (int32_t y = (int32_t)h - 1; y >= 0; y--) {     // bottom-up
        const uint8_t* line = data + (uint32_t)y * src_stride;
        uint8_t* p = row;
        for (uint32_t x = 0; x < w; x++) {
            uint16_t px = (uint16_t)line[x * 2] | ((uint16_t)line[x * 2 + 1] << 8);  // RGB565 LE
            uint8_t r = (px >> 11) & 0x1F; r = (r << 3) | (r >> 2);
            uint8_t g = (px >> 5)  & 0x3F; g = (g << 2) | (g >> 4);
            uint8_t b =  px        & 0x1F; b = (b << 3) | (b >> 2);
            *p++ = b; *p++ = g; *p++ = r;     // BMP = BGR
        }
        S->sendContent((const char*)row, dst_stride);
    }
    free(row);
    heap_caps_free(mem);
}

// --- POST /bgimage?key=<hex> : upload d'un fond RGB565 (360x360, 259200 octets) ---
// Multipart streame directement vers le FS cible (SD ou LittleFS) (pas de gros buffer RAM, supporte les octets nuls).
// Ecrit dans un fichier temp puis renomme vers /bg/<cle>.565 si la taille est exacte.
static File   s_bg_up;
static size_t s_bg_written = 0;
static const char* BG_TMP = BG_DIR "/_upload.tmp";

static void h_bgimage_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START) {
        String dir = asset_resolve(BG_DIR);
        if (!asset_fs_target().exists(dir)) asset_fs_target().mkdir(dir);
        s_bg_written = 0;
        s_bg_up = asset_fs_target().open(asset_resolve(BG_TMP), "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (s_bg_up) s_bg_written += s_bg_up.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        if (s_bg_up) s_bg_up.close();
    }
}

static void h_bgimage_done() {
    String key = S->arg("key");
    String tmp = asset_resolve(BG_TMP);
    if (s_bg_written != BG_IMG_BYTES) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad size (expected 259200)\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = asset_resolve((String(BG_DIR) + "/" + key + ".565").c_str());
    asset_fs_target().remove(dst);                       // rename echoue si la cible existe
    if (!asset_fs_target().rename(tmp, dst)) {
        asset_fs_target().remove(tmp);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_bgimage_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(BG_DIR) + "/" + key + ".565";
    File f = asset_open_read(path.c_str());
    if (!f) { S->send(404, "text/plain", "not found\n"); return; }
    S->streamFile(f, "application/octet-stream");
    f.close();
}

// --- POST /image?key=<hex> : upload d'une image placee RGB565A8 (taille variable) ---
static File   s_img_up;
static size_t s_img_written = 0;
static const char* IMG_TMP = IMG_DIR "/_upload.tmp";

static void h_image_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START) {
        String dir = asset_resolve(IMG_DIR);
        if (!asset_fs_target().exists(dir)) asset_fs_target().mkdir(dir);
        s_img_written = 0;
        s_img_up = asset_fs_target().open(asset_resolve(IMG_TMP), "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (s_img_up) s_img_written += s_img_up.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        if (s_img_up) s_img_up.close();
    }
}

static void h_image_done() {
    String key = S->arg("key");
    String tmp = asset_resolve(IMG_TMP);
    // Taille variable : on borne (<= plein ecran) et on exige un multiple de 3 (RGB565A8). La validation
    // forte len == w*h*3 a lieu au chargement (img_load_component, ou w/h sont connus).
    if (s_img_written == 0 || s_img_written > (size_t)IMG_MAX_BYTES || (s_img_written % IMG_PX_BYTES) != 0) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad size\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = asset_resolve((String(IMG_DIR) + "/" + key + ".565a").c_str());
    asset_fs_target().remove(dst);
    if (!asset_fs_target().rename(tmp, dst)) {
        asset_fs_target().remove(tmp);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_image_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(IMG_DIR) + "/" + key + ".565a";
    File f = asset_open_read(path.c_str());
    if (!f) { S->send(404, "text/plain", "not found\n"); return; }
    S->streamFile(f, "application/octet-stream");
    f.close();
}

// --- POST /aimg?key=<hex> : upload d'un pack image animee RGB565A8 (N frames concatenees) ---
static File   s_aimg_up;
static size_t s_aimg_written = 0;
static const char* AIMG_TMP = AIMG_DIR "/_upload.tmp";

static void h_aimg_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START) {
        String dir = asset_resolve(AIMG_DIR);
        if (!asset_fs_target().exists(dir)) asset_fs_target().mkdir(dir);
        s_aimg_written = 0;
        s_aimg_up = asset_fs_target().open(asset_resolve(AIMG_TMP), "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (s_aimg_up) s_aimg_written += s_aimg_up.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        if (s_aimg_up) s_aimg_up.close();
    }
}
static void h_aimg_done() {
    String key = S->arg("key");
    String tmp = asset_resolve(AIMG_TMP);
    // Borne (<= AIMG_MAX_BYTES) + multiple de 3 (RGB565A8). Validation forte (== N*w*h*3) au chargement.
    if (s_aimg_written == 0 || s_aimg_written > (size_t)AIMG_MAX_BYTES || (s_aimg_written % AIMG_PX_BYTES) != 0) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad size\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = asset_resolve((String(AIMG_DIR) + "/" + key + ".565p").c_str());
    asset_fs_target().remove(dst);
    if (!asset_fs_target().rename(tmp, dst)) {
        asset_fs_target().remove(tmp);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}
static void h_aimg_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(AIMG_DIR) + "/" + key + ".565p";
    File f = asset_open_read(path.c_str());
    if (!f) { S->send(404, "text/plain", "not found\n"); return; }
    S->streamFile(f, "application/octet-stream");
    f.close();
}

// --- OTA firmware : ecrit le slot app INACTIF ; bascule otadata au reboot. Calque du pattern
// d'upload streame de /image (S->upload() : START/WRITE/END). Le double-slot protege d'un
// transfert rate (l'ancien slot reste actif tant que Update.end(true) n'a pas reussi). ---
static void h_firmware_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START)      Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH);
    else if (up.status == UPLOAD_FILE_WRITE) Update.write(up.buf, up.currentSize);
    else if (up.status == UPLOAD_FILE_END)   Update.end(true);
}
static void h_firmware_done() {
    if (Update.hasError()) { S->send(500, "text/plain", "update failed\n"); return; }
    S->send(200, "text/plain", "ok, rebooting\n");
    delay(200); ESP.restart();
}

void api_register(WebServer& server, Dashboard* d) {
    S = &server; D = d;
    server.enableCORS(true);   // Allow-Origin/Methods/Headers: * sur toutes les réponses (outil de dev LAN mono-utilisateur)
    server.on("/update", HTTP_POST, h_update);
    server.on("/context", HTTP_GET,  h_get_context);
    server.on("/context", HTTP_POST, h_set_context);
    server.on("/secrets", HTTP_POST, h_set_secrets);   // pas de route GET : write-only par conception
    server.on("/wifi",      HTTP_GET,    h_wifi_get);
    server.on("/wifi",      HTTP_POST,   h_wifi_post);
    server.on("/wifi",      HTTP_DELETE, h_wifi_delete);
    server.on("/wifi/scan", HTTP_GET,    h_wifi_scan);
    server.on("/status", HTTP_GET,  h_status);
    server.on("/layout", HTTP_POST, h_set_layout);
    server.on("/layout", HTTP_GET,  h_get_layout);
    server.on("/page",   HTTP_POST, h_page);
    server.on("/screenshot", HTTP_GET, h_screenshot);   // capture ecran -> image/bmp
    server.on("/bgimage", HTTP_POST, h_bgimage_done, h_bgimage_upload);  // done + upload handler
    server.on("/bgimage", HTTP_GET,  h_bgimage_get);
    server.on("/image", HTTP_POST, h_image_done, h_image_upload);
    server.on("/image", HTTP_GET,  h_image_get);
    server.on("/aimg", HTTP_POST, h_aimg_done, h_aimg_upload);
    server.on("/aimg", HTTP_GET,  h_aimg_get);
    server.on("/firmware", HTTP_POST, h_firmware_done, h_firmware_upload);   // OTA firmware (U_FLASH)
    // Designer embarque (LittleFS) : http://<ip>/designer/ sert l'editeur en MEME origin (plus de
    // serveur local ni de CORS). serveStatic cherche index.htm pour une URL de repertoire ("/designer/").
    // Fichiers stages par tools/stage_fs.sh puis flashes via --uploadfs. Le schema partage est servi a
    // part car le designer le fetch en ../schema/.
    server.serveStatic("/designer", LittleFS, "/designer");
    server.serveStatic("/schema",   LittleFS, "/schema");
    server.on("/",       HTTP_GET,  h_root);
    server.onNotFound([](){
        // enableCORS(true) ajoute déjà Allow-Origin/Methods/Headers: * à chaque réponse ;
        // le preflight OPTIONS a juste besoin d'un statut 2xx (sinon le navigateur le rejette).
        if (S->method() == HTTP_OPTIONS) S->send(204);
        else                             S->send(404, "text/plain", "Not found\n");
    });
}
