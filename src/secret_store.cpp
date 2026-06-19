#include "secret_store.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"

bool secret_store_begin() {
    if (LittleFS.exists(SECRETS_PATH)) return true;
    File f = LittleFS.open(SECRETS_PATH, "w");
    if (!f) return false;
    f.print("{}");
    f.close();
    return true;
}

// Charge le store dans doc ; objet vide si absent ou corrompu (jamais d'échec dur).
static void load_doc(JsonDocument& doc) {
    File f = LittleFS.open(SECRETS_PATH, "r");
    if (!f) { doc.to<JsonObject>(); return; }
    DeserializationError e = deserializeJson(doc, f);
    f.close();
    if (e) doc.to<JsonObject>();
}

bool secret_store_merge(const char* json) {
    JsonDocument incoming;
    if (deserializeJson(incoming, json)) return false;
    JsonObjectConst in = incoming.as<JsonObjectConst>();
    if (in.isNull()) return false;

    JsonDocument store;
    load_doc(store);
    JsonObject obj = store.as<JsonObject>();
    if (obj.isNull()) obj = store.to<JsonObject>();
    for (JsonPairConst kv : in)
        if (kv.value().is<const char*>())            // secrets = chaînes uniquement
            obj[kv.key()] = kv.value().as<const char*>();

    File f = LittleFS.open(SECRETS_PATH, "w");        // incoming/store restent vivants jusqu'ici
    if (!f) return false;
    serializeJson(store, f);
    f.close();
    return true;
}

bool secret_store_get(const char* name, char* out, size_t n) {
    JsonDocument store;
    load_doc(store);
    JsonVariantConst v = store[name];
    if (!v.is<const char*>()) { if (n) out[0] = '\0'; return false; }
    strlcpy(out, v.as<const char*>(), n);
    return true;
}
