#include "persist.h"
#include <LittleFS.h>
#include "config.h"

bool persist_begin() { return LittleFS.begin(true); }   // true = formate si non monte

bool persist_load(String& out) {
    File f = LittleFS.open(LAYOUT_PATH, "r");
    if (!f) return false;
    out = f.readString();
    f.close();
    return out.length() > 0;
}

bool persist_save(const String& json) {
    File f = LittleFS.open(LAYOUT_PATH, "w");
    if (!f) return false;
    size_t w = f.print(json);
    f.close();
    return w == json.length();
}
