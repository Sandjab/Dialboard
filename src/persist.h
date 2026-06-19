#pragma once
#include <Arduino.h>
bool persist_begin();                  // monte LittleFS (formate si besoin)
bool persist_load(String& out);        // lit LAYOUT_PATH -> out ; false si absent/vide
bool persist_save(const String& json); // ecrit LAYOUT_PATH
