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
#include "freertos/semphr.h"
#include <lvgl.h>
#include "esp_heap_caps.h"
#include <LittleFS.h>

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

static void h_status() {
    JsonDocument doc;
    doc["ip"]         = WiFi.localIP().toString();
    doc["hostname"]   = String(MDNS_HOST) + ".local";
    doc["rssi"]       = WiFi.RSSI();
    doc["uptime_s"]   = (uint32_t)(millis() / 1000);
    doc["page"]       = D->active_page;
    doc["pages"]      = D->page_count;
    doc["components"] = D->comp_count;
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    JsonArray arr = doc["sources"].to<JsonArray>();
    for (int i = 0; i < D->source_count; i++) {
        JsonObject o     = arr.add<JsonObject>();
        o["name"]        = D->sources[i].name;          // char[] -> ArduinoJson copie
        o["last_status"] = D->sources[i].last_status;
        o["err_count"]   = D->sources[i].err_count;
        o["updated_at"]  = D->sources[i].updated_at;
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
        File dir = LittleFS.open(BG_DIR);
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
                if (!referenced) victims[nv++] = String(BG_DIR) + "/" + base;
            }
            dir.close();
        }
        for (int i = 0; i < nv; i++) LittleFS.remove(victims[i]);
    }
    // Sweep : supprime les images /img/*.565a que plus aucun composant image ne reference.
    {
        String victims[16]; int nv = 0;
        File dir = LittleFS.open(IMG_DIR);
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
                if (!referenced) victims[nv++] = String(IMG_DIR) + "/" + b;
            }
            dir.close();
        }
        for (int i = 0; i < nv; i++) LittleFS.remove(victims[i]);
    }
    // Sweep : supprime les packs /aimg/*.565p que plus aucun composant image_anim ne reference.
    {
        String victims[16]; int nv = 0;
        File dir = LittleFS.open(AIMG_DIR);
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
                if (!referenced) victims[nv++] = String(AIMG_DIR) + "/" + b;
            }
            dir.close();
        }
        for (int i = 0; i < nv; i++) LittleFS.remove(victims[i]);
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
    lv_obj_t* scr = lv_scr_act();
    uint32_t need = lv_snapshot_buf_size_needed(scr, LV_IMG_CF_TRUE_COLOR);
    if (!need) { S->send(500, "text/plain", "snapshot size unavailable\n"); return; }
    uint8_t* buf = (uint8_t*)heap_caps_malloc(need, MALLOC_CAP_SPIRAM);
    if (!buf) { S->send(503, "text/plain", "PSRAM alloc failed\n"); return; }

    lv_img_dsc_t dsc;
    if (lv_snapshot_take_to_buf(scr, LV_IMG_CF_TRUE_COLOR, &dsc, buf, need) != LV_RES_OK) {
        heap_caps_free(buf);
        S->send(500, "text/plain", "snapshot failed\n");
        return;
    }
    // Dimensions remplies par take_to_buf (360x360 ici) -- jamais codees en dur.
    const uint32_t w = dsc.header.w, h = dsc.header.h;
    const uint32_t stride = w * 3;          // BMP 24-bit ; 360*3 = 1080, deja multiple de 4
    const uint32_t img_size = stride * h;

    uint8_t hdr[54] = {0};                   // BITMAPFILEHEADER(14) + BITMAPINFOHEADER(40)
    hdr[0] = 'B'; hdr[1] = 'M';
    put_u32le(hdr + 2, 54 + img_size);       // taille fichier
    hdr[10] = 54;                            // offset des pixels
    hdr[14] = 40;                            // taille BITMAPINFOHEADER
    put_u32le(hdr + 18, w);
    put_u32le(hdr + 22, h);                  // h > 0 => bottom-up
    hdr[26] = 1;                             // planes
    hdr[28] = 24;                            // bits/pixel
    put_u32le(hdr + 34, img_size);           // biSizeImage

    uint8_t* row = (uint8_t*)malloc(stride);
    if (!row) { heap_caps_free(buf); S->send(503, "text/plain", "row alloc failed\n"); return; }

    S->setContentLength(54 + img_size);
    S->send(200, "image/bmp", "");
    S->sendContent((const char*)hdr, 54);

    const lv_color_t* px = (const lv_color_t*)dsc.data;
    for (int32_t y = (int32_t)h - 1; y >= 0; y--) {     // bottom-up
        const lv_color_t* line = px + (uint32_t)y * w;
        uint8_t* p = row;
        for (uint32_t x = 0; x < w; x++) {
            uint32_t c = lv_color_to32(line[x]);        // gere LV_COLOR_16_SWAP
            *p++ = c & 0xFF;            // B
            *p++ = (c >> 8) & 0xFF;     // G
            *p++ = (c >> 16) & 0xFF;    // R
        }
        S->sendContent((const char*)row, stride);
    }
    free(row);
    heap_caps_free(buf);
}

// --- POST /bgimage?key=<hex> : upload d'un fond RGB565 (360x360, 259200 octets) ---
// Multipart streame directement en LittleFS (pas de gros buffer RAM, supporte les octets nuls).
// Ecrit dans un fichier temp puis renomme vers /bg/<cle>.565 si la taille est exacte.
static File   s_bg_up;
static size_t s_bg_written = 0;
static const char* BG_TMP = BG_DIR "/_upload.tmp";

static void h_bgimage_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START) {
        if (!LittleFS.exists(BG_DIR)) LittleFS.mkdir(BG_DIR);
        s_bg_written = 0;
        s_bg_up = LittleFS.open(BG_TMP, "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (s_bg_up) s_bg_written += s_bg_up.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        if (s_bg_up) s_bg_up.close();
    }
}

static void h_bgimage_done() {
    String key = S->arg("key");
    if (s_bg_written != BG_IMG_BYTES) {
        LittleFS.remove(BG_TMP);
        S->send(400, "text/plain", "bad size (expected 259200)\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        LittleFS.remove(BG_TMP);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = String(BG_DIR) + "/" + key + ".565";
    LittleFS.remove(dst);                       // rename echoue si la cible existe
    if (!LittleFS.rename(BG_TMP, dst)) {
        LittleFS.remove(BG_TMP);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_bgimage_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(BG_DIR) + "/" + key + ".565";
    File f = LittleFS.open(path, "r");
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
        if (!LittleFS.exists(IMG_DIR)) LittleFS.mkdir(IMG_DIR);
        s_img_written = 0;
        s_img_up = LittleFS.open(IMG_TMP, "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (s_img_up) s_img_written += s_img_up.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        if (s_img_up) s_img_up.close();
    }
}

static void h_image_done() {
    String key = S->arg("key");
    // Taille variable : on borne (<= plein ecran) et on exige un multiple de 3 (RGB565A8). La validation
    // forte len == w*h*3 a lieu au chargement (img_load_component, ou w/h sont connus).
    if (s_img_written == 0 || s_img_written > (size_t)IMG_MAX_BYTES || (s_img_written % IMG_PX_BYTES) != 0) {
        LittleFS.remove(IMG_TMP);
        S->send(400, "text/plain", "bad size\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        LittleFS.remove(IMG_TMP);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = String(IMG_DIR) + "/" + key + ".565a";
    LittleFS.remove(dst);
    if (!LittleFS.rename(IMG_TMP, dst)) {
        LittleFS.remove(IMG_TMP);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_image_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(IMG_DIR) + "/" + key + ".565a";
    File f = LittleFS.open(path, "r");
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
        if (!LittleFS.exists(AIMG_DIR)) LittleFS.mkdir(AIMG_DIR);
        s_aimg_written = 0;
        s_aimg_up = LittleFS.open(AIMG_TMP, "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (s_aimg_up) s_aimg_written += s_aimg_up.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        if (s_aimg_up) s_aimg_up.close();
    }
}
static void h_aimg_done() {
    String key = S->arg("key");
    // Borne (<= AIMG_MAX_BYTES) + multiple de 3 (RGB565A8). Validation forte (== N*w*h*3) au chargement.
    if (s_aimg_written == 0 || s_aimg_written > (size_t)AIMG_MAX_BYTES || (s_aimg_written % AIMG_PX_BYTES) != 0) {
        LittleFS.remove(AIMG_TMP);
        S->send(400, "text/plain", "bad size\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        LittleFS.remove(AIMG_TMP);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = String(AIMG_DIR) + "/" + key + ".565p";
    LittleFS.remove(dst);
    if (!LittleFS.rename(AIMG_TMP, dst)) {
        LittleFS.remove(AIMG_TMP);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}
static void h_aimg_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(AIMG_DIR) + "/" + key + ".565p";
    File f = LittleFS.open(path, "r");
    if (!f) { S->send(404, "text/plain", "not found\n"); return; }
    S->streamFile(f, "application/octet-stream");
    f.close();
}

void api_register(WebServer& server, Dashboard* d) {
    S = &server; D = d;
    server.enableCORS(true);   // Allow-Origin/Methods/Headers: * sur toutes les réponses (outil de dev LAN mono-utilisateur)
    server.on("/update", HTTP_POST, h_update);
    server.on("/context", HTTP_POST, h_set_context);
    server.on("/secrets", HTTP_POST, h_set_secrets);   // pas de route GET : write-only par conception
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
