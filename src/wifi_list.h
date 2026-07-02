#pragma once
#include <stddef.h>
#include "config.h"

// Un réseau WiFi. SSID ≤ 32 octets + NUL ; PSK WPA2 ≤ 63 + NUL.
struct WifiNet { char ssid[33]; char pass[64]; };

// {"nets":[{"ssid":..,"pass":..},…]} -> tableau ; renvoie le nombre lu (SSID vide ignoré).
int  wifi_list_parse(const char* json, WifiNet* out, int max);
// Sérialise en {"nets":[…]} dans out (taille n).
void wifi_list_serialize(const WifiNet* nets, int count, char* out, size_t n);
// Ajoute, ou remplace le pass si le SSID existe. Renvoie l'index ; -1 si plein & SSID absent.
int  wifi_list_upsert(WifiNet* nets, int* count, int max, const char* ssid, const char* pass);
// Supprime par SSID (décale). false si absent.
bool wifi_list_remove(WifiNet* nets, int* count, const char* ssid);
