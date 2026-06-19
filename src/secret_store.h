#pragma once
#include <Arduino.h>
// Store write-only de secrets sur LittleFS (/secrets.json), distinct du layout.
// Jamais servi par GET : seul le fetch (net_pull) le lit pour résoudre les $refs.
bool secret_store_begin();                                     // s'assure que le fichier existe
bool secret_store_merge(const char* json);                     // {nom:val,...} -> merge + écrit ; false si JSON invalide
bool secret_store_get(const char* name, char* out, size_t n);  // copie la valeur ; false si absente
