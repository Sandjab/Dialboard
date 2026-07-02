#pragma once
#include "wifi_list.h"

void wifi_store_begin();                                    // ouvre le namespace NVS
int  wifi_store_load(WifiNet* out, int max);                // liste complète (pass inclus) — usage boot interne
int  wifi_store_list_ssids(char out[][33], int max);        // SSID seuls — pour GET /wifi
bool wifi_store_upsert(const char* ssid, const char* pass); // charge -> upsert -> sauve ; false si plein
bool wifi_store_remove(const char* ssid);                   // charge -> remove -> sauve ; false si absent
