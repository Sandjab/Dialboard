#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include "k718_lvgl.h"
#include "config.h"
#include "secrets.h"
#include "view.h"
#include "api.h"
#include "led_ring_comp.h"
#include "sound_comp.h"
#include "nav_input.h"
#include "touch_cst816.h"
#include "persist.h"
#include "secret_store.h"
#include "net_pull.h"
#include "freertos/semphr.h"

static WebServer server(HTTP_PORT);
static Dashboard g_dash;
static bool g_wifi_up = false;
String g_layout_json;
SemaphoreHandle_t g_ctx_mutex = nullptr;   // sérialise l'accès à g_dash.ctx / g_dash.sources

static bool wifi_connect() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_BOOT_TIMEOUT_MS) {
        delay(200); Serial.print("."); lv_timer_handler();
    }
    Serial.println();
    return WiFi.status() == WL_CONNECTED;
}

static void start_services() {
    static bool started = false;
    if (started) return;
    started = true;
    if (MDNS.begin(MDNS_HOST)) MDNS.addService("http", "tcp", HTTP_PORT);
    api_register(server, &g_dash);
    server.begin();
    net_pull_begin(&g_dash, g_ctx_mutex);   // garde-fou `started` au-dessus -> lancée une seule fois
    Serial.printf("[http] :%d  http://%s.local\n", HTTP_PORT, MDNS_HOST);
}

void setup() {
    Serial.begin(115200); delay(200);
    g_ctx_mutex = xSemaphoreCreateMutex();
    Serial.println("\nK718 - Dialboard");
    k718_lvgl_init();
    touch_begin();
    lv_timer_handler();
    char err[80];
    persist_begin();
    secret_store_begin();   // LittleFS déjà monté par persist_begin()
    if (!persist_load(g_layout_json) ||
        !dash_set_layout(&g_dash, g_layout_json.c_str(), err, sizeof(err))) {
        g_layout_json = view_default_layout();          // fallback compile
        dash_set_layout(&g_dash, g_layout_json.c_str(), err, sizeof(err));
    }
    view_rebuild(&g_dash);
    led_ring_begin();
    sound_begin();
    nav_begin();
    g_wifi_up = wifi_connect();
    if (g_wifi_up) {
        Serial.printf("[wifi] IP=%s\n", WiFi.localIP().toString().c_str());
        start_services();
    } else {
        Serial.println("[wifi] ECHEC (verifie secrets.h)");
    }
}

void loop() {
    server.handleClient();
    static uint32_t last = 0;
    if (millis() - last > 1000) {
        last = millis();
        bool now = (WiFi.status() == WL_CONNECTED);
        if (now && !g_wifi_up) start_services();
        g_wifi_up = now;
    }
    if (g_dash.layout_dirty) view_rebuild(&g_dash);
    // Décompte basé sur le temps réellement écoulé (pas un pas fixe de 1 s) : si la boucle
    // ralentit (WiFi, LittleFS, HTTP), on rattrape les secondes perdues -> pas de dérive.
    static uint32_t last_sec = 0;
    uint32_t now_ms = millis();
    if (now_ms - last_sec >= 1000) {
        uint32_t elapsed = (now_ms - last_sec) / 1000;
        last_sec += elapsed * 1000;
        dash_tick_countdown(&g_dash, elapsed);
    }
    static uint32_t last_ctx = 0;
    if (millis() - last_ctx >= 100) {
        last_ctx = millis();
        if (g_ctx_mutex && xSemaphoreTake(g_ctx_mutex, 0) == pdTRUE) {   // 0 = non bloquant : on saute le tour si occupé
            context_apply(&g_dash);
            xSemaphoreGive(g_ctx_mutex);
        }
    }
    dash_tick_aimg(&g_dash, now_ms);     // avance les frames des image_anim en lecture (marque dirty)
    if (g_dash.values_dirty) view_sync(&g_dash);
    static uint32_t last_led = 0;
    if (millis() - last_led >= 33) { last_led = millis(); led_ring_tick(&g_dash, millis()); }
    sound_tick(&g_dash);
    nav_tick(&g_dash);
    lv_timer_handler();
    delay(5);
}
