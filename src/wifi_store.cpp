#include "wifi_store.h"
#include <Preferences.h>
#include <string.h>
#include "config.h"

static Preferences s_prefs;

// Charge le blob JSON NVS -> tableau. Absent/corrompu -> 0 (jamais d'échec dur, cf. secret_store).
static int load(WifiNet* out, int max) {
    String json = s_prefs.getString("nets", "{}");
    return wifi_list_parse(json.c_str(), out, max);
}

static void save(const WifiNet* nets, int count) {
    char json[64 + MAX_WIFI_NETS * 128];
    wifi_list_serialize(nets, count, json, sizeof(json));
    s_prefs.putString("nets", json);
}

void wifi_store_begin() { s_prefs.begin(WIFI_STORE_NS, false); }

int wifi_store_load(WifiNet* out, int max) { return load(out, max); }

int wifi_store_list_ssids(char out[][33], int max) {
    WifiNet nets[MAX_WIFI_NETS];
    int c = load(nets, MAX_WIFI_NETS);
    int n = c < max ? c : max;
    for (int i = 0; i < n; i++) strlcpy(out[i], nets[i].ssid, 33);
    return n;
}

bool wifi_store_upsert(const char* ssid, const char* pass) {
    WifiNet nets[MAX_WIFI_NETS];
    int c = load(nets, MAX_WIFI_NETS);
    if (wifi_list_upsert(nets, &c, MAX_WIFI_NETS, ssid, pass) < 0) return false;
    save(nets, c);
    return true;
}

bool wifi_store_remove(const char* ssid) {
    WifiNet nets[MAX_WIFI_NETS];
    int c = load(nets, MAX_WIFI_NETS);
    if (!wifi_list_remove(nets, &c, ssid)) return false;
    save(nets, c);
    return true;
}
