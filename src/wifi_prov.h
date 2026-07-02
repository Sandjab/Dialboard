#pragma once
#include <stddef.h>

// STA : essaie la liste NVS dans l'ordre. Renvoie le SSID connecté (statique) ou nullptr.
const char* wifi_prov_connect();
// Construit le nom du softAP (WIFI_AP_PREFIX + 6 hex MAC) dans out (taille n).
void        wifi_prov_ap_name(char* out, size_t n);
// Mode provisioning : softAP ouvert + DNSServer + page captive. Ne rend la main qu'via ESP.restart().
void        wifi_prov_start_ap();
