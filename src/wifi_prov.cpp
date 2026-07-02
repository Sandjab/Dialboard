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
    if (!wifi_store_upsert(ssid.c_str(), pass.c_str())) {   // liste pleine -> rien enregistre : ne PAS rebooter (sinon cul-de-sac)
        s_ap_server.send(507, "text/html", "<h2>Liste pleine</h2><p>Trop de reseaux. Supprime-en un depuis le designer, puis reessaie.</p>");
        return;
    }
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
