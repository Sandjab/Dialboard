#pragma once
#include <stdint.h>
#include <stddef.h>
#include <ArduinoJson.h>
#include "config.h"

enum CtxType { CTX_NONE, CTX_NUM, CTX_STR };

// Variable nommee du contexte partage (blackboard). num XOR str selon type.
struct CtxVar {
    char     name[ID_LEN];
    CtxType  type;
    double   num;
    char     str[TEXT_LEN];
    uint32_t updated_at;     // timestamp fourni par l'appelant (millis() device, libre en test)
};

struct Context {
    CtxVar vars[MAX_CTX_VARS];
    int    count;
};

int  ctx_find(const Context* c, const char* name);                                  // index ou -1
bool ctx_set_num(Context* c, const char* name, double v, uint32_t now);             // false si plein
bool ctx_set_str(Context* c, const char* name, const char* v, uint32_t now);
int  ctx_apply_json(Context* c, JsonObjectConst obj, uint32_t now);                 // {nom:val} -> nb ecrites
JsonVariantConst ctx_extract_pointer(JsonVariantConst root, const char* ptr);       // RFC 6901 ; nul si non resolu
