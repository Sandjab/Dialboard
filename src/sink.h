#pragma once
#include <stdint.h>
#include <stddef.h>
#include "context.h"

// Débounce de traîne : vrai si armé (pending_since != 0) ET au moins debounce_ms écoulé depuis.
bool sink_should_fire(uint32_t pending_since, uint32_t now, uint32_t debounce_ms);

// Construit le corps HTTP du sink dans out (taille n).
//   tmpl == "" : corps par défaut {"<watch>": <valeur de watch>} (typé via ArduinoJson).
//   sinon      : macro textuelle — chaque {{nom}} est remplacé par le TEXTE de la var
//                (number: entier si entier, sinon %g ; string: caractères bruts).
//                L'auteur du gabarit met les guillemets s'il veut une string JSON.
void sink_render_body(const char* tmpl, const char* watch, const Context* ctx, char* out, size_t n);
