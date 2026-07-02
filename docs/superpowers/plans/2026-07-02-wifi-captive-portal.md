# Provisioning WiFi (portail captif + NVS + gestion designer) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les identifiants WiFi compilés (`src/secrets.h`) par un provisioning runtime — liste de réseaux en NVS, essayée dans l'ordre au boot, repli sur portail captif AP ouvert, gérable depuis le designer — puis supprimer `secrets.h`.

**Architecture:** Cœur pur testable `wifi_list` (parse/serialize/upsert/remove, tests Unity natifs) enrobé par `wifi_store` (persistance NVS via `Preferences`). `wifi_prov` orchestre : connexion STA dans l'ordre, sinon `softAP` + `DNSServer` + page captive embarquée, reboot après enregistrement. `api.cpp` expose `/wifi` write-only pour le designer (panneau dédié gaté par réglage).

**Tech Stack:** C++/Arduino (ESP32-S3), LVGL 9.5, ArduinoJson v7, `Preferences` (NVS), `DNSServer`, `WebServer` ; designer JS modules + `node --test`.

**Réf. spec :** `docs/superpowers/specs/2026-07-02-wifi-captive-portal-design.md`

---

## Structure des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `src/wifi_list.{h,cpp}` | **pur** : liste `WifiNet[]` en mémoire ⇄ JSON, upsert/remove. Compilé natif (Unity). |
| `src/wifi_store.{h,cpp}` | persistance NVS de la liste (`Preferences`). Enrobe `wifi_list`. |
| `src/wifi_prov.{h,cpp}` | machine à états : connexion ordre strict, portail AP+DNS, page captive. |
| `src/view.{h,cpp}` | +`view_show_provisioning()` (écran LVGL minimal). |
| `src/api.cpp` | +routes `/wifi` (GET/POST/DELETE) et `/wifi/scan`. |
| `src/main.cpp` | boot via `wifi_prov`, retrait `secrets.h`. |
| `src/config.h` | +constantes `MAX_WIFI_NETS`, timeouts, préfixe AP, namespace NVS. |
| `designer/js/device.js` | +transport `getWifi/scanWifi/addWifi/removeWifi`. |
| `designer/js/wifi.js` | `formatWifiList()` (pur, testé) + panneau UI. |
| `designer/tests/wifi.test.js` | tests node du format + invariant write-only. |
| glue designer | `settings.js`/`app.js`/`index.htm`/`style.css`/`i18n/*` : afficher le panneau. |

**Ordre** : firmware d'abord (chaque commit compile `pio run -e esp32s3`), designer ensuite. `wifi_list`/`store`/`prov` compilent dès l'ajout (env esp32s3 compile tout `src/`), mais ne sont appelés qu'en Task 7.

---

## Task 1 : Constantes de configuration

**Files:**
- Modify: `src/config.h` (après la ligne `#define SECRETS_PATH "/secrets.json"`, l.31)

- [ ] **Step 1 : Ajouter les constantes**

Ajouter après la ligne `SECRETS_PATH` :

```c
#define MAX_WIFI_NETS           5           // réseaux WiFi stockés (NVS)
#define WIFI_ATTEMPT_TIMEOUT_MS 8000        // timeout par réseau au boot
#define WIFI_AP_PREFIX          "Dialboard-" // nom softAP = préfixe + 6 hex MAC
#define WIFI_STORE_NS           "dbwifi"     // namespace Preferences (NVS)
```

- [ ] **Step 2 : Compiler**

Run: `pio run -e esp32s3`
Expected: build OK (constantes non encore utilisées, aucune régression).

- [ ] **Step 3 : Commit**

```bash
git add src/config.h
git commit -m "feat(wifi): constantes de provisioning (NVS, timeout, préfixe AP)"
```

---

## Task 2 : Cœur pur `wifi_list` (TDD natif)

**Files:**
- Create: `src/wifi_list.h`, `src/wifi_list.cpp`
- Test: `test/test_core/test_main.cpp` (ajout de tests + `RUN_TEST`)
- Modify: `platformio.ini:32` (`build_src_filter` += `wifi_list.cpp`)

- [ ] **Step 1 : Écrire l'en-tête**

Create `src/wifi_list.h` :

```c
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
```

- [ ] **Step 2 : Écrire les tests qui échouent**

Dans `test/test_core/test_main.cpp` : ajouter `#include "wifi_list.h"` près des autres includes (après `#include "sink.h"`), puis ajouter ce bloc de fonctions de test (par ex. juste avant `int main(`) :

```c
// --- wifi_list (cœur pur du provisioning WiFi) ---
void test_wifi_upsert_append_and_replace(void) {
    WifiNet n[5]; int c = 0;
    TEST_ASSERT_EQUAL_INT(0, wifi_list_upsert(n, &c, 5, "home", "pw1"));
    TEST_ASSERT_EQUAL_INT(1, c);
    TEST_ASSERT_EQUAL_INT(0, wifi_list_upsert(n, &c, 5, "home", "pw2"));  // même SSID -> remplace
    TEST_ASSERT_EQUAL_INT(1, c);                                         // pas d'ajout
    TEST_ASSERT_EQUAL_STRING("pw2", n[0].pass);
}
void test_wifi_upsert_full_rejects(void) {
    WifiNet n[2]; int c = 0;
    wifi_list_upsert(n, &c, 2, "a", "");
    wifi_list_upsert(n, &c, 2, "b", "");
    TEST_ASSERT_EQUAL_INT(-1, wifi_list_upsert(n, &c, 2, "c", ""));      // plein -> -1
    TEST_ASSERT_EQUAL_INT(2, c);
}
void test_wifi_remove(void) {
    WifiNet n[3]; int c = 0;
    wifi_list_upsert(n, &c, 3, "a", "");
    wifi_list_upsert(n, &c, 3, "b", "");
    TEST_ASSERT_TRUE(wifi_list_remove(n, &c, "a"));
    TEST_ASSERT_EQUAL_INT(1, c);
    TEST_ASSERT_EQUAL_STRING("b", n[0].ssid);                           // décalage vers le bas
    TEST_ASSERT_FALSE(wifi_list_remove(n, &c, "zzz"));                  // absent -> false
}
void test_wifi_roundtrip(void) {
    WifiNet n[5]; int c = 0;
    wifi_list_upsert(n, &c, 5, "home", "secret");
    wifi_list_upsert(n, &c, 5, "cafe", "");
    char json[256]; wifi_list_serialize(n, c, json, sizeof(json));
    WifiNet m[5]; int mc = wifi_list_parse(json, m, 5);
    TEST_ASSERT_EQUAL_INT(2, mc);
    TEST_ASSERT_EQUAL_STRING("home", m[0].ssid);
    TEST_ASSERT_EQUAL_STRING("secret", m[0].pass);
    TEST_ASSERT_EQUAL_STRING("cafe", m[1].ssid);
}
void test_wifi_parse_garbage_empty(void) {
    WifiNet m[5];
    TEST_ASSERT_EQUAL_INT(0, wifi_list_parse("not json", m, 5));        // corrompu -> 0
    TEST_ASSERT_EQUAL_INT(0, wifi_list_parse("{}", m, 5));              // pas de clé nets -> 0
}
```

Dans `int main(`, ajouter les `RUN_TEST` (par ex. après `RUN_TEST(test_ctx_full_rejects);`) :

```c
    RUN_TEST(test_wifi_upsert_append_and_replace);
    RUN_TEST(test_wifi_upsert_full_rejects);
    RUN_TEST(test_wifi_remove);
    RUN_TEST(test_wifi_roundtrip);
    RUN_TEST(test_wifi_parse_garbage_empty);
```

Ajouter `wifi_list.cpp` au filtre natif — `platformio.ini:32`, à la fin de `build_src_filter` :

```
build_src_filter = -<*> +<dashboard.cpp> +<format.cpp> +<color.cpp> +<nav_logic.cpp> +<context.cpp> +<asset_path.cpp> +<sink.cpp> +<wifi_list.cpp>
```

- [ ] **Step 3 : Lancer les tests → échec de compilation/link**

Run: `pio test -e native`
Expected: FAIL au link (`wifi_list_*` non défini) — `wifi_list.cpp` n'existe pas encore.

- [ ] **Step 4 : Implémenter**

Create `src/wifi_list.cpp` :

```c
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
```

- [ ] **Step 5 : Lancer les tests → succès**

Run: `pio test -e native`
Expected: PASS (5 nouveaux tests verts, aucun régressé).

- [ ] **Step 6 : Vérifier que le firmware compile aussi**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 7 : Commit**

```bash
git add src/wifi_list.h src/wifi_list.cpp test/test_core/test_main.cpp platformio.ini
git commit -m "feat(wifi): cœur pur wifi_list (upsert/remove/JSON) + tests natifs"
```

---

## Task 3 : Persistance NVS `wifi_store`

**Files:**
- Create: `src/wifi_store.h`, `src/wifi_store.cpp`

Note : NVS/`Preferences` = HW, non testable en natif (comme `net_pull`). Vérification on-device en Task 12.

- [ ] **Step 1 : Écrire l'en-tête**

Create `src/wifi_store.h` :

```c
#pragma once
#include "wifi_list.h"

void wifi_store_begin();                                    // ouvre le namespace NVS
int  wifi_store_load(WifiNet* out, int max);                // liste complète (pass inclus) — usage boot interne
int  wifi_store_list_ssids(char out[][33], int max);        // SSID seuls — pour GET /wifi
bool wifi_store_upsert(const char* ssid, const char* pass); // charge -> upsert -> sauve ; false si plein
bool wifi_store_remove(const char* ssid);                   // charge -> remove -> sauve ; false si absent
```

- [ ] **Step 2 : Implémenter**

Create `src/wifi_store.cpp` :

```c
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
```

- [ ] **Step 3 : Compiler**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/wifi_store.h src/wifi_store.cpp
git commit -m "feat(wifi): persistance NVS de la liste (wifi_store, Preferences)"
```

---

## Task 4 : Écran de provisioning LVGL

**Files:**
- Modify: `src/view.h` (déclaration), `src/view.cpp` (implémentation)

⚠️ Vérifier les helpers LVGL/police réellement utilisés dans `view.cpp` (`get_font`, création d'écran) et **s'aligner dessus** — le code ci-dessous est la cible fonctionnelle.

- [ ] **Step 1 : Déclarer**

Dans `src/view.h`, ajouter près des autres prototypes `view_*` :

```c
// Affiche un écran plein « configuration WiFi » (mode provisioning AP). ap_name = SSID du softAP.
void view_show_provisioning(const char* ap_name);
```

- [ ] **Step 2 : Implémenter**

Dans `src/view.cpp`, ajouter (adapter `get_font` à la signature réelle du fichier) :

```c
void view_show_provisioning(const char* ap_name) {
    lv_obj_t* scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x0B0F14), 0);

    lv_obj_t* box = lv_obj_create(scr);
    lv_obj_set_size(box, 300, 300);
    lv_obj_center(box);
    lv_obj_set_flex_flow(box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(box, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_obj_t* title = lv_label_create(box);
    lv_label_set_text(title, "Configuration WiFi");
    lv_obj_set_style_text_font(title, get_font(FAMILY_MONTSERRAT, 22, true, false), 0);

    lv_obj_t* ssid = lv_label_create(box);
    lv_label_set_text_fmt(ssid, "Rejoins le WiFi :\n%s", ap_name);
    lv_obj_set_style_text_align(ssid, LV_TEXT_ALIGN_CENTER, 0);

    lv_obj_t* hint = lv_label_create(box);
    lv_label_set_text(hint, "puis ouvre http://192.168.4.1");
    lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);

    lv_screen_load(scr);
    lv_timer_handler();
}
```

- [ ] **Step 3 : Compiler**

Run: `pio run -e esp32s3`
Expected: build OK. (Si `get_font`/`lv_screen_load` diffèrent, corriger selon `view.cpp`.)

- [ ] **Step 4 : Commit**

```bash
git add src/view.h src/view.cpp
git commit -m "feat(wifi): écran LVGL de provisioning (nom AP + invite)"
```

---

## Task 5 : Machine à états `wifi_prov` (connexion + portail AP)

**Files:**
- Create: `src/wifi_prov.h`, `src/wifi_prov.cpp`

⚠️ HW (WiFi/DNS/WebServer) : vérification on-device en Task 12.

- [ ] **Step 1 : Écrire l'en-tête**

Create `src/wifi_prov.h` :

```c
#pragma once
#include <stddef.h>

// STA : essaie la liste NVS dans l'ordre. Renvoie le SSID connecté (statique) ou nullptr.
const char* wifi_prov_connect();
// Construit le nom du softAP (WIFI_AP_PREFIX + 6 hex MAC) dans out (taille n).
void        wifi_prov_ap_name(char* out, size_t n);
// Mode provisioning : softAP ouvert + DNSServer + page captive. Ne rend la main qu'via ESP.restart().
void        wifi_prov_start_ap();
```

- [ ] **Step 2 : Implémenter**

Create `src/wifi_prov.cpp`. Note : la page captive et son script sont construits **sans `innerHTML`** (DOM sûr) — un SSID scanné pourrait contenir des caractères HTML.

```c
#include "wifi_prov.h"
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <lvgl.h>
#include "config.h"
#include "wifi_store.h"

void wifi_prov_ap_name(char* out, size_t n) {
    uint8_t mac[6]; WiFi.macAddress(mac);
    snprintf(out, n, "%s%02X%02X%02X", WIFI_AP_PREFIX, mac[3], mac[4], mac[5]);
}

const char* wifi_prov_connect() {
    static char connected[33];
    WifiNet nets[MAX_WIFI_NETS];
    int c = wifi_store_load(nets, MAX_WIFI_NETS);
    if (c == 0) return nullptr;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    for (int i = 0; i < c; i++) {
        WiFi.begin(nets[i].ssid, nets[i].pass);
        uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_ATTEMPT_TIMEOUT_MS) {
            delay(200); Serial.print("."); lv_timer_handler();
        }
        if (WiFi.status() == WL_CONNECTED) {
            strlcpy(connected, nets[i].ssid, sizeof(connected));
            return connected;
        }
        WiFi.disconnect();
    }
    return nullptr;
}

// --- portail captif ---
static WebServer  s_ap_server(80);
static DNSServer  s_dns;
static bool       s_reboot = false;

// Page captive. Le script remplit le <datalist> via createElement/.value (pas d'innerHTML -> pas d'XSS SSID).
static const char PORTAL_HTML[] PROGMEM =
    "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>Dialboard WiFi</title>"
    "<style>body{font-family:sans-serif;max-width:22rem;margin:2rem auto;padding:0 1rem}"
    "input,button{width:100%;padding:.6rem;margin:.3rem 0;box-sizing:border-box}</style>"
    "<h2>Configuration WiFi</h2>"
    "<form method=POST action=/save>"
    "<input name=ssid placeholder='Nom du reseau (SSID)' list=nets required>"
    "<datalist id=nets></datalist>"
    "<input name=pass type=password placeholder='Mot de passe'>"
    "<button type=submit>Enregistrer et redemarrer</button></form>"
    "<script>fetch('/scan').then(function(r){return r.json()}).then(function(a){"
    "var d=document.getElementById('nets');"
    "a.forEach(function(n){var o=document.createElement('option');o.value=n.ssid;d.appendChild(o)})"
    "}).catch(function(){})</script>";

static void h_portal_root() { s_ap_server.send_P(200, "text/html", PORTAL_HTML); }

static void h_portal_scan() {
    int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < n; i++) {
        JsonObject o = arr.add<JsonObject>();
        o["ssid"] = WiFi.SSID(i);
        o["rssi"] = WiFi.RSSI(i);
    }
    String out; serializeJson(doc, out);
    s_ap_server.send(200, "application/json", out);
}

static void h_portal_save() {
    String ssid = s_ap_server.arg("ssid");
    String pass = s_ap_server.arg("pass");
    if (!ssid.length()) { s_ap_server.send(400, "text/html", "SSID vide"); return; }
    wifi_store_upsert(ssid.c_str(), pass.c_str());
    s_ap_server.send(200, "text/html", "<meta http-equiv=refresh content='3'><h2>Enregistre. Redemarrage...</h2>");
    s_reboot = true;
}

void wifi_prov_start_ap() {
    char name[33]; wifi_prov_ap_name(name, sizeof(name));
    WiFi.mode(WIFI_AP);
    WiFi.softAP(name);                                   // ouvert (pas de mot de passe)
    IPAddress ip = WiFi.softAPIP();
    s_dns.start(53, "*", ip);                            // catch-all -> détection captive

    s_ap_server.on("/",                    h_portal_root);
    s_ap_server.on("/scan",                h_portal_scan);
    s_ap_server.on("/save", HTTP_POST,     h_portal_save);
    s_ap_server.on("/generate_204",        h_portal_root);   // Android
    s_ap_server.on("/hotspot-detect.html", h_portal_root);   // iOS/macOS
    s_ap_server.on("/ncsi.txt",            h_portal_root);   // Windows
    s_ap_server.onNotFound(                h_portal_root);
    s_ap_server.enableCORS(true);
    s_ap_server.begin();
    Serial.printf("[prov] AP '%s' http://%s\n", name, ip.toString().c_str());

    for (;;) {
        s_dns.processNextRequest();
        s_ap_server.handleClient();
        lv_timer_handler();
        delay(5);
        if (s_reboot) { delay(300); ESP.restart(); }
    }
}
```

- [ ] **Step 3 : Compiler**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/wifi_prov.h src/wifi_prov.cpp
git commit -m "feat(wifi): wifi_prov — connexion ordre strict + portail captif AP"
```

---

## Task 6 : Routes `/wifi` (mode STA)

**Files:**
- Modify: `src/api.cpp` (handlers + enregistrement ; miroir de `h_set_secrets`/`h_get_context`)

- [ ] **Step 1 : Ajouter les handlers**

Dans `src/api.cpp`, ajouter `#include "wifi_store.h"` (`<WiFi.h>` déjà présent). Ajouter après `h_set_secrets` (l.63) :

```c
static void h_wifi_get() {
    char ssids[MAX_WIFI_NETS][33];
    int n = wifi_store_list_ssids(ssids, MAX_WIFI_NETS);
    JsonDocument doc;
    JsonArray arr = doc["nets"].to<JsonArray>();
    for (int i = 0; i < n; i++) arr.add(ssids[i]);
    doc["connected"] = WiFi.isConnected() ? WiFi.SSID() : String();
    String out; serializeJson(doc, out); out += "\n";
    S->send(200, "application/json", out);
}

static void h_wifi_post() {
    if (!S->hasArg("plain")) { S->send(400, "text/plain", "Empty body\n"); return; }
    JsonDocument doc;
    if (deserializeJson(doc, S->arg("plain"))) { S->send(400, "text/plain", "Invalid JSON\n"); return; }
    const char* ssid = doc["ssid"] | "";
    if (!ssid[0]) { S->send(400, "text/plain", "Missing ssid\n"); return; }
    if (!wifi_store_upsert(ssid, doc["pass"] | "")) { S->send(507, "text/plain", "Store full\n"); return; }
    S->send(200, "application/json", "{\"ok\":true}\n");   // ne renvoie JAMAIS le pass
}

static void h_wifi_delete() {
    String ssid = S->hasArg("ssid") ? S->arg("ssid") : String();
    if (!ssid.length())                   { S->send(400, "text/plain", "Missing ssid\n"); return; }
    if (!wifi_store_remove(ssid.c_str())) { S->send(404, "text/plain", "Not found\n");   return; }
    S->send(200, "application/json", "{\"ok\":true}\n");
}

static void h_wifi_scan() {
    int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < n; i++) {
        JsonObject o = arr.add<JsonObject>();
        o["ssid"] = WiFi.SSID(i);
        o["rssi"] = WiFi.RSSI(i);
    }
    String out; serializeJson(doc, out); out += "\n";
    S->send(200, "application/json", out);
}
```

- [ ] **Step 2 : Enregistrer les routes**

Dans `api_register` (près de `server.on("/secrets", …)`, l.451) :

```c
    server.on("/wifi",      HTTP_GET,    h_wifi_get);
    server.on("/wifi",      HTTP_POST,   h_wifi_post);
    server.on("/wifi",      HTTP_DELETE, h_wifi_delete);
    server.on("/wifi/scan", HTTP_GET,    h_wifi_scan);
```

- [ ] **Step 3 : Compiler**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(wifi): routes /wifi (GET/POST/DELETE) + /wifi/scan, pass write-only"
```

---

## Task 7 : Intégration boot `main.cpp` (bascule sur wifi_prov)

**Files:**
- Modify: `src/main.cpp` (l.7 include, l.27-37 `wifi_connect`, l.71-77 setup)

- [ ] **Step 1 : Remplacer l'include et la connexion**

Retirer `#include "secrets.h"` (l.7). Ajouter `#include "wifi_prov.h"` et `#include "wifi_store.h"`.
Supprimer la fonction `wifi_connect()` (l.27-37).

Dans `setup()`, après `secret_store_begin();` (l.60), ajouter :

```c
    wifi_store_begin();
```

Remplacer le bloc l.71-77 :

```c
    const char* ssid = wifi_prov_connect();
    if (ssid) {
        g_wifi_up = true;
        Serial.printf("[wifi] IP=%s (%s)\n", WiFi.localIP().toString().c_str(), ssid);
        start_services();
    } else {
        char apn[33]; wifi_prov_ap_name(apn, sizeof(apn));
        Serial.printf("[wifi] aucun reseau connu -> provisioning AP '%s'\n", apn);
        view_show_provisioning(apn);
        wifi_prov_start_ap();   // ne revient pas (reboot après enregistrement)
    }
```

- [ ] **Step 2 : Compiler (sans secrets.h utilisé)**

Run: `pio run -e esp32s3`
Expected: build OK. `secrets.h` n'est plus référencé (mais existe encore).

- [ ] **Step 3 : Commit**

```bash
git add src/main.cpp
git commit -m "feat(wifi): boot via wifi_prov (connexion liste ou portail), retrait secrets.h"
```

---

## Task 8 : Suppression de `secrets.h`

**Files:**
- Delete: `src/secrets.h.example`, `src/secrets.h` (local, gitignoré)
- Modify: `.gitignore` (retirer la section `src/secrets.h`)

- [ ] **Step 1 : Vérifier qu'aucune référence ne subsiste**

Run: `grep -rn 'secrets.h"' src/ | grep -v secret_store`
Expected: aucune ligne (seul `secret_store.h` subsiste, sans rapport).

- [ ] **Step 2 : Supprimer les fichiers et la ligne gitignore**

```bash
git rm src/secrets.h.example
rm -f src/secrets.h
```

Dans `.gitignore`, supprimer les 2 lignes (commentaire + `src/secrets.h`, l.10-11).

- [ ] **Step 3 : Compiler**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add -A
git commit -m "feat(wifi): supprime secrets.h (WiFi désormais provisionné au runtime)"
```

---

## Task 9 : Transport designer + `formatWifiList` (TDD node)

**Files:**
- Modify: `designer/js/device.js` (fonctions de transport)
- Create: `designer/js/wifi.js` (format pur ; panneau en Task 10)
- Test: `designer/tests/wifi.test.js`

- [ ] **Step 1 : Ajouter le transport dans `device.js`**

Ajouter après `getContext` (l.46) :

```js
// GET /wifi : { nets:[ssid,…], connected }. SSID seuls — les pass ne sont jamais renvoyés.
export async function getWifi(base) {
  const r = await devFetch(base, '/wifi');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// GET /wifi/scan : [{ssid,rssi},…] réseaux visibles.
export async function scanWifi(base) {
  const r = await devFetch(base, '/wifi/scan');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// POST /wifi : ajoute/maj {ssid,pass}. Le pass part vers le device, jamais relu.
export async function addWifi(base, ssid, pass) {
  const r = await devFetch(base, '/wifi', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssid, pass })
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return b;
}
// DELETE /wifi?ssid=… : retire un réseau stocké.
export async function removeWifi(base, ssid) {
  const r = await devFetch(base, '/wifi?ssid=' + encodeURIComponent(ssid), { method: 'DELETE' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json().catch(() => ({}));
}
```

- [ ] **Step 2 : Écrire le test qui échoue**

Create `designer/tests/wifi.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWifiList } from '../js/wifi.js';

test('formatWifiList : marque le SSID connecté (intent : voir d\'un coup d\'œil le réseau actif)', () => {
  const r = formatWifiList({ nets: ['home', 'cafe'], connected: 'cafe' });
  assert.deepEqual(r, [{ ssid: 'home', connected: false }, { ssid: 'cafe', connected: true }]);
});

test('formatWifiList : réponse malformée tolérée (intent : Array.isArray, cf. device dump)', () => {
  assert.deepEqual(formatWifiList({ nets: null }), []);
  assert.deepEqual(formatWifiList({}), []);
  assert.deepEqual(formatWifiList(null), []);
});

test('formatWifiList : aucun mot de passe ne fuit dans la sortie (intent : write-only)', () => {
  const r = formatWifiList({ nets: ['home'], connected: '', pass: 'leak' });
  assert.equal(JSON.stringify(r).includes('leak'), false);
});
```

- [ ] **Step 3 : Lancer → échec**

Run: `cd designer && node --test`
Expected: FAIL (`wifi.js` introuvable / `formatWifiList` non exporté).

- [ ] **Step 4 : Implémenter le format pur**

Create `designer/js/wifi.js` :

```js
// Présentation de GET /wifi pour le panneau — séparée du transport (testable node).
// Ne remonte QUE des SSID + un drapeau « connecté » ; aucun mot de passe (write-only).
export function formatWifiList(data) {
  const d = (data && typeof data === 'object') ? data : {};
  const connected = typeof d.connected === 'string' ? d.connected : '';
  const nets = Array.isArray(d.nets) ? d.nets.filter(s => typeof s === 'string') : [];
  return nets.map(ssid => ({ ssid, connected: ssid === connected }));
}
```

- [ ] **Step 5 : Lancer → succès**

Run: `cd designer && node --test`
Expected: PASS (3 tests wifi verts, aucun régressé).

- [ ] **Step 6 : Commit**

```bash
git add designer/js/device.js designer/js/wifi.js designer/tests/wifi.test.js
git commit -m "feat(designer): transport /wifi + formatWifiList (write-only) + tests"
```

---

## Task 10 : Panneau WiFi designer + câblage

**Files:**
- Modify: `designer/js/wifi.js` (ajout du builder de panneau)
- Modify: `designer/js/settings.js` (réglage `deviceWifi`, miroir `deviceContext` l.14,31,153)
- Modify: `designer/js/app.js` (instanciation + affichage du panneau, miroir Device)
- Modify: `designer/index.htm` (conteneur `#wifi-panel`)
- Modify: `designer/style.css` (`.console-wifi[hidden]{display:none}`, cf. note panneaux masqués)
- Modify: `designer/i18n/fr.json`, `designer/i18n/en.js`

⚠️ Reproduire le pattern du panneau **Device** (`deviceContext`) : mêmes points d'ancrage. Le code
ci-dessous est la cible ; ajuster les sélecteurs aux id réels du panneau Device.

- [ ] **Step 1 : Builder de panneau dans `wifi.js` (DOM sûr, sans innerHTML)**

Ajouter à `designer/js/wifi.js` :

```js
import { getWifi, scanWifi, addWifi, removeWifi } from './device.js';

// petit helper : crée un élément avec un texte (textContent -> pas d'injection HTML)
function el(tag, text) { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; }

// Monte le panneau WiFi dans `root`. getBase()->URL device ; t()->i18n ; toast()->feedback.
export function createWifiPanel(root, { getBase, t, toast }) {
  root.replaceChildren();
  const refreshBtn = el('button', '⟳'); refreshBtn.type = 'button'; refreshBtn.className = 'wifi-refresh';
  const list = el('ul'); list.className = 'wifi-list';
  const form = el('form'); form.className = 'wifi-add';
  const ssid = el('input'); ssid.className = 'wifi-ssid'; ssid.required = true; ssid.setAttribute('list', 'wifi-scan');
  const scan = el('datalist'); scan.id = 'wifi-scan';
  const pass = el('input'); pass.className = 'wifi-pass'; pass.type = 'password'; pass.autocomplete = 'new-password';
  const save = el('button', t('wifi.add')); save.type = 'submit'; save.className = 'wifi-save';
  form.append(ssid, scan, pass, save);
  root.append(refreshBtn, list, form);

  async function refresh() {
    const base = getBase();
    try {
      const rows = formatWifiList(await getWifi(base));
      list.replaceChildren();
      for (const r of rows) {
        const li = el('li', r.ssid + (r.connected ? ' ●' : ''));
        const del = el('button', '✕');
        del.onclick = async () => { await removeWifi(base, r.ssid); toast(t('wifi.removed')); refresh(); };
        li.append(del);
        list.append(li);
      }
      scan.replaceChildren();
      for (const n of await scanWifi(base).catch(() => [])) {
        const opt = el('option'); opt.value = n.ssid;   // .value = attribut -> pas d'injection
        scan.append(opt);
      }
    } catch (e) { toast(t('wifi.err')); }
  }

  refreshBtn.onclick = refresh;
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await addWifi(getBase(), ssid.value, pass.value); pass.value = ''; toast(t('wifi.added')); refresh(); }
    catch (err) { toast(t('wifi.err')); }
  };
  return { refresh };
}
```

- [ ] **Step 2 : Réglage `deviceWifi` (`settings.js`)**

Miroir de `deviceContext` :
- l.14 defaults : ajouter `deviceWifi: false`.
- l.31 coercition : ajouter `deviceWifi: typeof r.deviceWifi === 'boolean' ? r.deviceWifi : d.deviceWifi,`.
- l.153 (bloc `devCtxRow`) : ajouter une ligne analogue branchant `setSettings({ deviceWifi: v })`.

- [ ] **Step 3 : Câblage `app.js` + `index.htm` + `style.css`**

- `index.htm` : ajouter un conteneur `<div id="wifi-panel" class="console-wifi" hidden></div>` là où vit le panneau Device.
- `app.js` : instancier `createWifiPanel(document.getElementById('wifi-panel'), { getBase, t, toast })` et refléter `settings.deviceWifi` sur `panel.hidden` (miroir du panneau Device / `deviceContext`).
- `style.css` : ajouter `.console-wifi[hidden]{display:none}` (l'auteur l'emporte sur la règle UA — cf. mémoire « panneaux console masqués »).

- [ ] **Step 4 : i18n (`fr.json` + `en.js`)**

Ajouter dans les deux fichiers (mêmes clés) :

```
"wifi.title": "WiFi",               / "WiFi"
"wifi.add": "Ajouter",              / "Add"
"wifi.removed": "Réseau supprimé",  / "Network removed"
"wifi.added": "Réseau ajouté",      / "Network added"
"wifi.err": "Erreur WiFi device",   / "Device WiFi error"
```

- [ ] **Step 5 : Tests designer (non régressés)**

Run: `cd designer && node --test`
Expected: PASS (les tests existants + `wifi.test.js`).

- [ ] **Step 6 : Vérif navigateur (manuelle)**

Servir le designer en no-store et vérifier : le réglage `deviceWifi` affiche/masque le panneau ; le champ mot de passe n'est jamais pré-rempli. (cf. mémoire « Vérif navigateur du designer ».)

- [ ] **Step 7 : Commit**

```bash
git add designer/js/wifi.js designer/js/settings.js designer/js/app.js designer/index.htm designer/style.css designer/i18n/fr.json designer/i18n/en.js
git commit -m "feat(designer): panneau WiFi (liste/ajout/suppression) gaté par réglage"
```

---

## Task 11 : Documentation

**Files:**
- Modify: `context.md` (§5 Secrets — le WiFi n'est plus compilé)
- Modify: `docs/_internal/HANDOFF.md`

- [ ] **Step 1 : Mettre à jour `context.md` §5.a**

Remplacer le paragraphe « Identifiants WiFi — au build » par : identifiants WiFi désormais **provisionnés au runtime** (liste NVS via portail captif / designer), `secrets.h` supprimé ; renvoyer vers `docs/superpowers/specs/2026-07-02-wifi-captive-portal-design.md`.

- [ ] **Step 2 : Note HANDOFF**

Ajouter à `docs/_internal/HANDOFF.md` : provisioning WiFi livré ; 1er boot NVS vide → AP `Dialboard-XXXXXX` ; creds survivent à `uploadfs` (NVS) ; reprovisionner via portail ou panneau designer.

- [ ] **Step 3 : Commit**

```bash
git add context.md docs/_internal/HANDOFF.md
git commit -m "docs(wifi): context.md §5 + HANDOFF — WiFi provisionné au runtime"
```

---

## Task 12 : Vérification on-device (manuelle, critères de succès)

Aucun code — valider le tout sur la carte. **Sauvegarder d'abord les assets device** (mémoire : `uploadfs` efface LittleFS ; ici NVS non touché, mais assets LittleFS oui).

- [ ] **Step 1 : Flash firmware + FS**

Run: `pio run -e esp32s3 -t upload && bash tools/stage_fs.sh && pio run -e esp32s3 -t uploadfs`

- [ ] **Step 2 : 1er boot NVS vide → portail**

Effacer NVS si besoin (`pio run -e esp32s3 -t erase` puis reflash) ; au boot : l'écran affiche « Configuration WiFi — Dialboard-XXXXXX » ; le SSID AP est visible depuis un téléphone ; ouvrir `http://192.168.4.1` → page ; saisir un réseau → le device redémarre et se connecte.

- [ ] **Step 3 : Connexion + gestion designer**

Device en ligne : `GET /wifi` liste le réseau + `connected` ; ajouter un 2ᵉ réseau via le panneau ; `GET /wifi` ne renvoie **aucun** mot de passe.

- [ ] **Step 4 : Survie à uploadfs**

`pio run -e esp32s3 -t uploadfs` → rebooter → le device **se reconnecte sans reprovisionner** (creds NVS intacts).

- [ ] **Step 5 : Ordre strict**

Avec 2 réseaux stockés dont le 1er hors de portée : au boot, le device essaie le 1er (timeout ~8 s) puis se connecte au 2ᵉ.

---

## Auto-revue (writing-plans)

- **Couverture spec** : store NVS (T1-3), connexion ordre strict (T5), portail AP ouvert + DNS + captive (T5), écran provisioning (T4), routes write-only (T6), boot (T7), suppression secrets.h (T8), panneau designer + réglage (T9-10), tests natif+node (T2,T9), docs (T11), vérif on-device incl. survie uploadfs (T12). ✅
- **Placeholders** : aucun TBD ; les 2 zones à confirmer (LVGL `view.cpp`, points d'ancrage du panneau Device) sont explicitement signalées ⚠️ avec code cible complet.
- **Cohérence des types** : `WifiNet{ssid[33],pass[64]}`, `wifi_list_*`/`wifi_store_*` cohérents T1→T7 ; `formatWifiList` idem T9→T10 ; routes `/wifi` alignées entre firmware (T6) et transport (T9).
- **Sécurité** : page captive et panneau construits sans `innerHTML` (SSID via `.value`/`textContent`) ; pass write-only (jamais dans un GET ni pré-rempli).
```
