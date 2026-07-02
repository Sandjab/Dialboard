#include "wifi_list.h"
#include <ArduinoJson.h>
#include <string.h>

int wifi_list_parse(const char* json, WifiNet* out, int max) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) return 0;
    int n = 0;
    for (JsonVariantConst e : doc["nets"].as<JsonArrayConst>()) {
        if (n >= max) break;
        const char* s = e["ssid"] | "";
        if (!s[0]) continue;                                  // SSID vide ignoré
        strlcpy(out[n].ssid, s, sizeof(out[n].ssid));
        strlcpy(out[n].pass, e["pass"] | "", sizeof(out[n].pass));
        n++;
    }
    return n;
}

void wifi_list_serialize(const WifiNet* nets, int count, char* out, size_t n) {
    JsonDocument doc;
    JsonArray arr = doc["nets"].to<JsonArray>();
    for (int i = 0; i < count; i++) {
        JsonObject o = arr.add<JsonObject>();
        o["ssid"] = nets[i].ssid;
        o["pass"] = nets[i].pass;
    }
    serializeJson(doc, out, n);
}

static int find_ssid(const WifiNet* nets, int count, const char* ssid) {
    for (int i = 0; i < count; i++)
        if (strcmp(nets[i].ssid, ssid) == 0) return i;
    return -1;
}

int wifi_list_upsert(WifiNet* nets, int* count, int max, const char* ssid, const char* pass) {
    int i = find_ssid(nets, *count, ssid);
    if (i < 0) {
        if (*count >= max) return -1;                         // plein
        i = (*count)++;
        strlcpy(nets[i].ssid, ssid, sizeof(nets[i].ssid));
    }
    strlcpy(nets[i].pass, pass ? pass : "", sizeof(nets[i].pass));
    return i;
}

bool wifi_list_remove(WifiNet* nets, int* count, const char* ssid) {
    int i = find_ssid(nets, *count, ssid);
    if (i < 0) return false;
    for (int k = i; k < *count - 1; k++) nets[k] = nets[k + 1];
    (*count)--;
    return true;
}
