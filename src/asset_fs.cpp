#include "asset_fs.h"
#include <LittleFS.h>
#include <SD_MMC.h>
#include "k718_sd.h"
#include "asset_path.h"
#include "config.h"

// Buffer suffisant pour un chemin résolu : /dialboard/<dir>/<clé 16 hex>.<ext> (~37) + marge.
#define ASSET_PATH_MAX 64

static bool s_sd_active = false;

bool asset_fs_sd_active() { return s_sd_active; }

fs::FS& asset_fs_target() {
    return s_sd_active ? (fs::FS&)SD_MMC : (fs::FS&)LittleFS;
}

String asset_resolve(const char* logical) {
    char out[ASSET_PATH_MAX];
    asset_resolve_path(out, sizeof(out), logical, s_sd_active);
    return String(out);
}

void asset_fs_init() {
    s_sd_active = k718_sd_begin();
    if (!s_sd_active) { Serial.println("[sd] absente/non montee -> LittleFS"); return; }
    Serial.printf("[sd] montee, %lu Mo\n", (unsigned long)(SD_MMC.cardSize() >> 20));
    if (!SD_MMC.exists("/dialboard") && !SD_MMC.mkdir("/dialboard"))
        Serial.println("[sd] mkdir /dialboard echec");
    const char* dirs[] = { BG_DIR, IMG_DIR, AIMG_DIR };
    for (const char* d : dirs) {
        String p = asset_resolve(d);
        if (!SD_MMC.exists(p) && !SD_MMC.mkdir(p))
            Serial.printf("[sd] mkdir %s echec\n", p.c_str());
    }
}

File asset_open_read(const char* logical) {
    if (s_sd_active) {
        String sp = asset_resolve(logical);
        if (SD_MMC.exists(sp)) {
            File f = SD_MMC.open(sp, "r");
            if (f) return f;
        }
    }
    return LittleFS.open(logical, "r");   // fallback : chemin logique nu
}
