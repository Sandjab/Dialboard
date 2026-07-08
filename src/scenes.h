#pragma once
#include <stdint.h>

// Vocabulaire d'animation d'une couche. Toutes les valeurs de frame sont calculees par
// scene_frame_at() en fonction du temps ; view.cpp applique le resultat (transform/opa/align).
enum SceneAnim : uint8_t {
    SC_STATIC = 0,        // fixe
    SC_ROTATE,            // rotation continue
    SC_TRANSLATE_LOOP,    // translation verticale cyclique + fondu aux extremites
    SC_DRIFT,             // va-et-vient horizontal (sinus)
    SC_PULSE,             // echelle + opacite (0.5*(1-cos))
    SC_SWING,             // oscillation d'angle (sinus)
    SC_FLASH              // opacite en creneau
};

// Role couleur : PRINCIPAL suit la couleur reglable du cas ; ACCENT = couleur fixe.
enum SceneRole : uint8_t { SC_PRINCIPAL = 0, SC_ACCENT = 1 };

// Une couche = un glyphe MDI positionne + anime. Coordonnees relatives 0..100 (mises a
// l'echelle par `size` au rendu). scale_rel = taille du glyphe / size. Table figee (const).
struct SceneLayer {
    const char* symbol;    // nom MDI (resolu en index via icon_symbol_index au rendu)
    float    cx, cy;       // centre en 0..100 (relatif a la boite size x size)
    float    scale_rel;    // taille de police = round(scale_rel * size)
    uint8_t  role;         // SceneRole
    uint32_t accent;       // couleur si role == SC_ACCENT (0xRRGGBB)
    uint8_t  anim;         // SceneAnim
    uint16_t period;       // periode ms (>0)
    float    amp;          // amplitude (deg pour SWING ; fraction 0..100 pour TRANSLATE_LOOP/DRIFT ; facteur pour PULSE)
    uint16_t phase;        // decalage de phase ms (desynchronise les couches)
};

struct Scene { const char* name; const SceneLayer* layers; int count; };

// Etat anime d'une couche a un instant donne (ce que le rendu applique). rgb/symbol sont
// STATIQUES (resolus au build depuis la table + couleur principale), pas dans la frame.
struct LayerFrame {
    float   cx, cy;        // centre anime en 0..100
    int16_t angle_ddeg;    // rotation en 1/10 degre (ROTATE : 0..3600 ; SWING : signe autour de 0), pour transform_rotation
    float   scale;         // facteur d'echelle (1.0 = nominal), pour transform_scale
    uint8_t opa;           // opacite 0..255
};

#define MAX_SCENE_LAYERS 6

extern const Scene SCENE_CATALOG[];
int scene_count();
int scene_name_index(const char* name);                 // -1 si inconnu
uint32_t scene_layer_color(const SceneLayer* l, uint32_t principal);   // principal si role==PRINCIPAL, sinon accent
// Remplit out[0..count) pour la scene `scene_id` a l'instant `t_ms`. Retourne le nb de couches
// (== SCENE_CATALOG[scene_id].count). scene_id invalide -> 0. Pure, sans LVGL. Miroir scenes.js.
int scene_frame_at(int scene_id, uint32_t t_ms, LayerFrame* out);
