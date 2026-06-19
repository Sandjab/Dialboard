#include "net_pull.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <string.h>
#include "config.h"
#include "context.h"
#include "secret_store.h"

static Dashboard*        s_d   = nullptr;
static SemaphoreHandle_t s_mtx = nullptr;

static inline void lock()   { if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY); }
static inline void unlock() { if (s_mtx) xSemaphoreGive(s_mtx); }

// Résout "$nom" via le store de secrets ; sinon copie la valeur littérale.
static void resolve_header(const char* in, char* out, size_t n) {
    if (in[0] == '$') { if (!secret_store_get(in + 1, out, n) && n) out[0] = '\0'; return; }
    strlcpy(out, in, n);
}

static void record_error(int idx, int code) {
    lock();
    s_d->sources[idx].last_status = code;
    s_d->sources[idx].err_count++;
    unlock();
}

// Copie locale de la config d'une source : permet de relâcher le mutex pendant le fetch (long).
struct SourceJob {
    char url[URL_LEN];
    char hname[MAX_HEADERS_PER_SOURCE][HEADER_NAME_LEN];
    char hval [MAX_HEADERS_PER_SOURCE][HEADER_VAL_LEN];
    int  header_count;
    char vname[MAX_VARS_PER_SOURCE][ID_LEN];
    char vptr [MAX_VARS_PER_SOURCE][PTR_LEN];
    int  var_count;
};

static void fetch_one(int idx) {
    SourceJob job;
    // 1) snapshot config + résolution des secrets, sous mutex
    lock();
    Source& s = s_d->sources[idx];
    strlcpy(job.url, s.url, sizeof(job.url));
    job.header_count = s.header_count;
    for (int i = 0; i < s.header_count; i++) {
        strlcpy(job.hname[i], s.headers[i].name, HEADER_NAME_LEN);
        resolve_header(s.headers[i].value, job.hval[i], HEADER_VAL_LEN);
    }
    job.var_count = s.var_count;
    for (int i = 0; i < s.var_count; i++) {
        strlcpy(job.vname[i], s.vars[i].name, ID_LEN);
        strlcpy(job.vptr[i],  s.vars[i].ptr,  PTR_LEN);
    }
    unlock();

    // 2) fetch HORS mutex (peut bloquer plusieurs secondes)
    bool https = strncmp(job.url, "https", 5) == 0;
    WiFiClientSecure tls;
    WiFiClient       tcp;
    HTTPClient http;
    bool begun = https ? (tls.setInsecure(), http.begin(tls, job.url)) : http.begin(tcp, job.url);
    if (!begun) { record_error(idx, -1); return; }
    for (int i = 0; i < job.header_count; i++)
        if (job.hval[i][0]) http.addHeader(job.hname[i], job.hval[i]);
    int code = http.GET();
    if (code != 200) { http.end(); record_error(idx, code); return; }
    String payload = http.getString();
    http.end();

    // 3) parse réponse
    JsonDocument doc;
    if (deserializeJson(doc, payload)) { record_error(idx, -2); return; }
    JsonVariantConst root = doc.as<JsonVariantConst>();

    // 4) extraction + écriture du contexte, sous mutex
    lock();
    uint32_t now = millis();
    for (int i = 0; i < job.var_count; i++) {
        JsonVariantConst v = ctx_extract_pointer(root, job.vptr[i]);
        if (v.isNull()) continue;                         // chemin non résolu -> garde la dernière valeur
        if (v.is<const char*>())               ctx_set_str(&s_d->ctx, job.vname[i], v.as<const char*>(), now);
        else if (v.is<float>() || v.is<int>()) ctx_set_num(&s_d->ctx, job.vname[i], v.as<double>(), now);
    }
    s_d->sources[idx].last_status = code;
    s_d->sources[idx].updated_at  = now;
    unlock();
}

static void pull_task(void*) {
    for (;;) {
        if (WiFi.status() == WL_CONNECTED) {
            int n; lock(); n = s_d->source_count; unlock();
            uint32_t now = millis();
            for (int i = 0; i < n; i++) {
                uint32_t last, iv;
                lock(); last = s_d->sources[i].last_fetch_ms; iv = s_d->sources[i].interval_s; unlock();
                if (last != 0 && now - last < iv * 1000UL) continue;     // pas encore l'heure
                lock(); s_d->sources[i].last_fetch_ms = now; unlock();   // marque avant fetch (anti double-tir)
                fetch_one(i);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}

void net_pull_begin(Dashboard* d, SemaphoreHandle_t mutex) {
    s_d = d; s_mtx = mutex;
    // Cœur 0 (PRO_CPU) : le loopTask Arduino tourne sur le cœur 1. Pile 16 KB pour le
    // handshake TLS mbedtls — si HTTPS reset le device (stack overflow), monter à 20480.
    xTaskCreatePinnedToCore(pull_task, "pull", 16384, nullptr, 1, nullptr, 0);
}
