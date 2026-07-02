#pragma once
#define MAX_COMPONENTS          32
#define MAX_PAGES               8
#define MAX_PLACEMENTS_PER_PAGE 12
#define MAX_THRESHOLDS          4
#define MAX_ICON_STATES         4
#define CHART_MAX_POINTS        60
#define MAX_CTX_VARS            32
#define MAX_SOURCES             6
#define MAX_HEADERS_PER_SOURCE  4
#define MAX_VARS_PER_SOURCE     6
#define MAX_SINKS              6
#define MAX_HEADERS_PER_SINK   4
#define SINK_BODY_LEN          192
#define ROLLER_OPTS_LEN        160
#define MAX_ROLLER_ROWS          7
#define URL_LEN                 192
#define HEADER_NAME_LEN         32
#define HEADER_VAL_LEN          64
#define PTR_LEN                 48
#define CTX_MIN_INTERVAL_S      5
#define ID_LEN                  24
#define TEXT_LEN                32
#define CAPTION_LEN             24
#define UNKNOWN_CSV_LEN         128

#define HTTP_PORT               80
#define MDNS_HOST               "dialboard"
#define WIFI_BOOT_TIMEOUT_MS    20000
#define LAYOUT_PATH             "/layout.json"
#define SECRETS_PATH            "/secrets.json"
#define MAX_WIFI_NETS           5           // réseaux WiFi stockés (NVS)
#define WIFI_ATTEMPT_TIMEOUT_MS 8000        // timeout par réseau au boot
#define WIFI_AP_PREFIX          "Dialboard-" // nom softAP = préfixe + 6 hex MAC
#define WIFI_STORE_NS           "dbwifi"     // namespace Preferences (NVS)

#define BG_IMG_W       360
#define BG_IMG_H       360
#define BG_IMG_BYTES   (BG_IMG_W * BG_IMG_H * 2)   // RGB565 plein ecran = 259200
#define BG_DIR         "/bg"                        // repertoire LittleFS des fonds

#define IMG_MAX_W      360                                   // image placee : ne depasse pas l'ecran
#define IMG_MAX_H      360
#define IMG_PX_BYTES   3                                     // RGB565A8 = 2 octets couleur + 1 alpha
#define IMG_MAX_BYTES  (IMG_MAX_W * IMG_MAX_H * IMG_PX_BYTES) // 388800
#define IMG_DIR        "/img"                                // repertoire LittleFS des images placees

#define AIMG_MAX_W      360                                   // image animee : frame <= ecran
#define AIMG_MAX_H      360
#define AIMG_PX_BYTES   3                                     // RGB565A8 (2 couleur + 1 alpha), comme l'image statique
#define AIMG_MAX_FRAMES 32                                    // nombre max de frames par pack
#define AIMG_MAX_BYTES  1572864                               // ~1,5 Mo : plafond du pack par composant
#define AIMG_DIR        "/aimg"                               // repertoire LittleFS des packs animes
