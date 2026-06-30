#include "net_push.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <string.h>
#include "config.h"
#include "context.h"
#include "sink.h"
#include "secret_store.h"

static Dashboard*        s_d   = nullptr;
static SemaphoreHandle_t s_mtx = nullptr;

static inline void lock()   { if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY); }
static inline void unlock() { if (s_mtx) xSemaphoreGive(s_mtx); }

// Résout "$nom" via le store de secrets ; sinon copie la valeur littérale. (Identique à net_pull.)
static void resolve_header(const char* in, char* out, size_t n) {
    if (in[0] == '$') { if (!secret_store_get(in + 1, out, n) && n) out[0] = '\0'; return; }
    strlcpy(out, in, n);
}

// Snapshot local pour relâcher le mutex pendant le HTTP (long).
struct SinkJob {
    uint8_t method;
    char    url[URL_LEN];
    char    hname[MAX_HEADERS_PER_SINK][HEADER_NAME_LEN];
    char    hval [MAX_HEADERS_PER_SINK][HEADER_VAL_LEN];
    int     header_count;
    char    body[SINK_BODY_LEN + TEXT_LEN];     // marge pour la substitution {{var}}
};

static void fire_one(int idx) {
    SinkJob job;
    // 1) snapshot config + secrets + rendu du corps, sous mutex
    lock();
    Sink& s = s_d->sinks[idx];
    job.method = s.method;
    strlcpy(job.url, s.url, sizeof(job.url));
    job.header_count = s.header_count;
    for (int i = 0; i < s.header_count; i++) {
        strlcpy(job.hname[i], s.headers[i].name, HEADER_NAME_LEN);
        resolve_header(s.headers[i].value, job.hval[i], HEADER_VAL_LEN);
    }
    sink_render_body(s.body, s.watch, &s_d->ctx, job.body, sizeof(job.body));
    s.pending_since = 0;                         // désarme AVANT le tir (un nouvel UI write ré-armera)
    unlock();

    // 2) HTTP hors mutex
    bool https = strncmp(job.url, "https", 5) == 0;
    WiFiClientSecure tls;
    WiFiClient       tcp;
    HTTPClient http;
    bool begun = https ? (tls.setInsecure(), http.begin(tls, job.url)) : http.begin(tcp, job.url);
    if (!begun) { lock(); s_d->sinks[idx].last_status = -1; s_d->sinks[idx].err_count++; unlock(); return; }
    http.addHeader("Content-Type", "application/json");
    for (int i = 0; i < job.header_count; i++)
        if (job.hval[i][0]) http.addHeader(job.hname[i], job.hval[i]);
    int code = job.method == SINK_GET ? http.GET()
             : job.method == SINK_PUT ? http.PUT(String(job.body))
             :                          http.POST(String(job.body));
    http.end();

    // 3) statut sous mutex
    lock();
    s_d->sinks[idx].last_status = code;
    if (code <= 0) s_d->sinks[idx].err_count++;
    else           s_d->sinks[idx].fired_at = millis();
    unlock();
}

static void push_task(void*) {
    for (;;) {
        if (WiFi.status() == WL_CONNECTED) {
            int n; lock(); n = s_d->sink_count; unlock();
            uint32_t now = millis();
            for (int i = 0; i < n; i++) {
                uint32_t pending, deb;
                lock(); pending = s_d->sinks[i].pending_since; deb = s_d->sinks[i].debounce_ms; unlock();
                if (sink_should_fire(pending, now, deb)) fire_one(i);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(100));     // réactif (100 ms) : le débounce vit dans le sink
    }
}

void net_push_begin(Dashboard* d, SemaphoreHandle_t mutex) {
    s_d = d; s_mtx = mutex;
    // Cœur 0 (PRO_CPU), comme net_pull. Pile 16 KB pour le handshake TLS mbedtls (HTTPS).
    xTaskCreatePinnedToCore(push_task, "push", 16384, nullptr, 1, nullptr, 0);
}
