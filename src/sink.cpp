#include "sink.h"
#include <ArduinoJson.h>
#include <string.h>
#include <stdio.h>

bool sink_should_fire(uint32_t pending_since, uint32_t now, uint32_t debounce_ms) {
    if (pending_since == 0) return false;
    return (now - pending_since) >= debounce_ms;   // arithmétique uint32 (wrap), comme net_pull
}

// Formate une CtxVar en texte sans guillemets : entier si entier, sinon %g ; string brute.
static void var_text(const CtxVar& v, char* out, size_t n) {
    if (v.type == CTX_STR) { strlcpy(out, v.str, n); return; }
    double d = v.num;
    if (d == (double)(long)d) snprintf(out, n, "%ld", (long)d);
    else                      snprintf(out, n, "%g", d);
}

void sink_render_body(const char* tmpl, const char* watch, const Context* ctx, char* out, size_t n) {
    if (!tmpl || tmpl[0] == '\0') {                 // corps par défaut, typé
        JsonDocument doc;
        int i = ctx_find(ctx, watch);
        if (i < 0)                              doc[watch] = nullptr;
        else if (ctx->vars[i].type == CTX_STR)  doc[watch] = ctx->vars[i].str;
        else                                    doc[watch] = ctx->vars[i].num;
        serializeJson(doc, out, n);
        return;
    }
    size_t o = 0;                                   // macro textuelle {{nom}}
    for (const char* p = tmpl; *p && o + 1 < n; ) {
        if (p[0] == '{' && p[1] == '{') {
            const char* end = strstr(p + 2, "}}");
            if (end) {
                char name[ID_LEN]; size_t k = 0;
                for (const char* q = p + 2; q < end && k < sizeof(name) - 1; q++) name[k++] = *q;
                name[k] = '\0';
                int vi = ctx_find(ctx, name);
                char val[TEXT_LEN] = "";
                if (vi >= 0) var_text(ctx->vars[vi], val, sizeof(val));
                for (const char* s = val; *s && o + 1 < n; s++) out[o++] = *s;
                p = end + 2;
                continue;
            }
        }
        out[o++] = *p++;
    }
    out[o] = '\0';
}
