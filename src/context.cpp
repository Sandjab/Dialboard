#include "context.h"
#include <string.h>
#include <stdlib.h>

int ctx_find(const Context* c, const char* name) {
    for (int i = 0; i < c->count; i++)
        if (strncmp(c->vars[i].name, name, ID_LEN) == 0) return i;
    return -1;
}

static CtxVar* ctx_slot(Context* c, const char* name) {
    int i = ctx_find(c, name);
    if (i >= 0) return &c->vars[i];
    if (c->count >= MAX_CTX_VARS) return nullptr;
    CtxVar* v = &c->vars[c->count++];
    strlcpy(v->name, name, sizeof(v->name));
    return v;
}

bool ctx_set_num(Context* c, const char* name, double v, uint32_t now) {
    CtxVar* s = ctx_slot(c, name);
    if (!s) return false;
    s->type = CTX_NUM; s->num = v; s->updated_at = now;
    return true;
}

bool ctx_set_str(Context* c, const char* name, const char* v, uint32_t now) {
    CtxVar* s = ctx_slot(c, name);
    if (!s) return false;
    s->type = CTX_STR; strlcpy(s->str, v ? v : "", sizeof(s->str)); s->updated_at = now;
    return true;
}

int ctx_apply_json(Context* c, JsonObjectConst obj, uint32_t now) {
    int n = 0;
    for (JsonPairConst kv : obj) {
        JsonVariantConst v = kv.value();
        if (v.is<const char*>())                 { if (ctx_set_str(c, kv.key().c_str(), v.as<const char*>(), now)) n++; }
        else if (v.is<float>() || v.is<int>())   { if (ctx_set_num(c, kv.key().c_str(), v.as<double>(), now)) n++; }
        // objet/array/bool/null ignores en v1
    }
    return n;
}

// Vrai si name figure dans le CSV "a,b,c" (correspondance de token exacte).
static bool csv_has(const char* csv, const char* name) {
    size_t len = strlen(name);
    for (const char* p = csv; *p; ) {
        const char* comma = strchr(p, ',');
        size_t tok = comma ? (size_t)(comma - p) : strlen(p);
        if (tok == len && strncmp(p, name, len) == 0) return true;
        if (!comma) break;
        p = comma + 1;
    }
    return false;
}

void ctx_to_json(const Context* c, const char* filter_csv, char* out, size_t n) {
    JsonDocument doc;
    for (int i = 0; i < c->count; i++) {
        const CtxVar& v = c->vars[i];
        if (filter_csv && !csv_has(filter_csv, v.name)) continue;
        if (v.type == CTX_STR) doc[v.name] = v.str;
        else                   doc[v.name] = v.num;
    }
    serializeJson(doc, out, n);
}

// JSON Pointer (RFC 6901) : "/a/b/0", avec desechappement ~1->/ et ~0->~.
JsonVariantConst ctx_extract_pointer(JsonVariantConst root, const char* ptr) {
    if (!ptr || ptr[0] != '/') return JsonVariantConst();
    JsonVariantConst cur = root;
    char token[64];
    for (const char* p = ptr; *p == '/'; ) {
        p++;
        size_t k = 0;
        while (*p && *p != '/' && k < sizeof(token) - 1) {
            char ch = *p++;
            if (ch == '~' && *p == '1')      { ch = '/'; p++; }
            else if (ch == '~' && *p == '0') { ch = '~'; p++; }
            token[k++] = ch;
        }
        token[k] = '\0';
        if (cur.is<JsonObjectConst>())      cur = cur.as<JsonObjectConst>()[token];
        else if (cur.is<JsonArrayConst>())  cur = cur.as<JsonArrayConst>()[(size_t)atoi(token)];
        else                                return JsonVariantConst();
        if (cur.isNull()) return JsonVariantConst();
    }
    return cur;
}
