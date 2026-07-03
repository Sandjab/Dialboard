#pragma once
#include <stdint.h>
#include <stddef.h>
#include "config.h"
#include "context.h"

enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_ICON, COMP_SWITCH, COMP_BUTTON, COMP_SLIDER, COMP_ARC, COMP_ROLLER, COMP_CLOCK, COMP_RINGS, COMP_QR, COMP_COUNT };
enum LedMode  { LED_OFF, LED_SOLID, LED_PROGRESS, LED_SPINNER, LED_BLINK, LED_BREATHE };
enum BarMode  { BAR_NORMAL, BAR_SYMMETRICAL };               // bar : lv_bar_set_mode
enum ArcMode  { ARC_NORMAL, ARC_SYMMETRICAL, ARC_REVERSE };  // ring : lv_arc_set_mode
enum LineDash { LINE_SOLID, LINE_DASHED, LINE_DOTTED };      // line : motif du trait (line_dash_*)
enum Anchor   { A_CENTER, A_TOP_MID, A_BOTTOM_MID, A_LEFT_MID, A_RIGHT_MID,
                A_TOP_LEFT, A_TOP_RIGHT, A_BOTTOM_LEFT, A_BOTTOM_RIGHT };

enum FontFamily : uint8_t { FAMILY_MONTSERRAT = 0, FAMILY_JETBRAINS_MONO, FAMILY_LORA, FAMILY_INTER };

struct Threshold { float limit; uint32_t color; };

struct IconState { float at; uint8_t symbol; uint32_t color; bool has_symbol; bool has_color; };
// Nombre de symboles du set curaté (ICON_SYMBOL_NAMES dans dashboard.cpp == ICON_GLYPHS dans view.cpp).
static constexpr int ICON_SYMBOL_COUNT = 23;

struct RingTrack { char bind[ID_LEN]; int vmin, vmax; uint32_t color; int32_t value; };

struct Component {
    char     id[ID_LEN];
    CompType type;

    // --- config (style/donnees, sans position) ---
    char     label[TEXT_LEN];
    char     unit[8];
    char     text[TEXT_LEN];
    uint32_t color;
    uint32_t center_color;
    int32_t  vmin, vmax;
    int32_t  off_below;              // led : value < off_below -> eteint (defaut 1)
    bool     led_glow, led_bezel, led_specular, led_off_glass;   // led : effets de look (defaut true)
    bool     center_pct, countdown, center_color_set;
    bool     visible;                // commande universelle montre/cache (defaut true) ; pilotable via /update
    char     cap_prefix[CAPTION_LEN];  // ring : prefixe statique de la legende courbe (cap_prefix + caption)
    uint16_t cap_font;               // ring : taille de la legende courbe (defaut 14)
    uint8_t  cap_family;             // ring : famille de la legende (defaut FAMILY_MONTSERRAT)
    bool     cap_bold, cap_italic;   // ring : legende grasse / italique
    Threshold thresholds[MAX_THRESHOLDS];
    int      threshold_count;
    uint16_t font;
    uint8_t  font_family;            // famille de police (defaut FAMILY_MONTSERRAT)
    bool     bold;                   // gras (defaut false)
    bool     italic;                 // italique (defaut false)
    uint32_t label_color;            // bar : couleur du libelle (defaut 0x9AA0AA)
    uint16_t label_font;             // bar : taille de police du libelle (defaut 14)
    uint8_t  label_family;           // bar : famille du libelle (defaut FAMILY_MONTSERRAT)
    bool     label_bold;             // bar : libelle gras
    bool     label_italic;           // bar : libelle italique
    Anchor   label_align;            // bar : position du libelle autour de la barre (defaut A_TOP_MID)
    BarMode  bar_mode;               // bar : normal | symmetrical (lv_bar_set_mode)
    bool     bar_vertical;           // bar : orientation verticale (lv_bar_set_orientation)
    int      bar_anim_ms;            // bar : duree d'anim de la valeur (ms ; 0 = instantane)
    ArcMode  arc_mode;               // ring : normal | symmetrical | reverse (lv_arc_set_mode)
    bool     arc_rounded;            // ring : extremites d'indicateur arrondies (defaut true)
    RingTrack tracks[MAX_RING_TRACKS];   // rings : pistes concentriques (config)
    int       track_count;
    uint8_t  led_brightness_cfg;
    char     bind[ID_LEN];           // nom de variable du contexte (pull) ; vide = push par id
    int      chart_points;           // chart : longueur de la fenêtre d'historique (défaut 30, borné CHART_MAX_POINTS)
    char     image_src[ID_LEN];      // image : cle d'asset (/img/<src>.565a) ; vide = pas d'image
    int      image_w, image_h;       // image : dimensions de l'asset RGB565A8 (octets attendus = w*h*3)
    // image_anim : config (la cle/dims reutilisent image_src/image_w/image_h)
    int      aimg_frames;            // nombre de frames du pack ; 0 = pas d'asset
    uint16_t aimg_period;            // periode inter-frame par defaut (ms)
    int      aimg_rest;              // frame affichee au repos / apres un play fini
    int      aimg_loop;              // nb de passes par defaut d'un play (0 = infini)
    bool     aimg_autoplay;          // demarre la lecture au chargement de la page

    // formes de base (rect/circle/line)
    bool     fill_set;        // rect/circle : fill present (sinon pas de fond)
    uint32_t fill;            // rect/circle : couleur de fond
    uint32_t border_color;    // rect/circle : couleur du contour (defaut 0xFFFFFF)
    int      border_width;    // rect/circle : epaisseur du contour (0 = aucun)
    int      pad_x;           // label : marge interne horizontale autour du texte (pad_hor ; defaut 0)
    int      pad_y;           // label : marge interne verticale (pad_ver ; defaut 0)
    LineDash line_dash;       // line : motif (plein/tirets/pointille)
    bool     line_rounded;    // line : bouts arrondis. NB: l'orientation reutilise bar_vertical (parse generique)

    // icon : glyphe/couleur pilotes par la valeur via une table d'etats
    uint8_t   icon_symbol;                       // index du glyphe de base (-> ICON_GLYPHS dans view.cpp)
    IconState icon_states[MAX_ICON_STATES];
    int       icon_state_count;

    // button (effecteur set) : valeur ecrite dans bind au tap
    char     set_value[TEXT_LEN];   // valeur a ecrire (cas string) ; forme canonique aussi peuplee si num
    double   set_value_num;         // valeur numerique pre-parsee (cas num) : evite atof() recurrent + perte %g
    bool     set_is_num;            // true => valeur numerique (set_value_num), sinon string (set_value)
    // button momentary (impulsion) : true => pulse (capture-a-l'arm) au lieu de set
    bool     momentary;
    // slider/arc : pas de composant neuf ; min/max reutilisent vmin/vmax, orientation slider = bar_vertical
    int32_t  step;                  // slider/arc : pas de quantification si <= 0
    // roller : libelles joints par '\n' + rangees visibles
    char     roller_options[ROLLER_OPTS_LEN];
    uint8_t  roller_rows;

    // clock : cadran analogique (aiguilles) ou digital (label HH:MM[:SS]) ; heure = device (NTP), pas de push-by-id
    bool     clock_analog;    // true=cadran, false=digital (défaut true)
    bool     show_seconds;

    // --- etat (modifie par /update) ---
    int32_t  value;
    char     vstr[TEXT_LEN];
    uint32_t reset_in_s;
    char     caption[CAPTION_LEN];
    LedMode  led_mode; uint32_t led_color; uint8_t led_value, led_brightness; uint16_t led_period_ms;
    bool     snd_pending; uint16_t snd_tone; uint16_t snd_ms; char snd_name[12];
    int16_t  hist[CHART_MAX_POINTS]; int hist_count;   // chart : fenêtre glissante, hist[0..hist_count-1] = chronologique
    bool     aimg_playing;           // image_anim : lecture en cours (la frame courante = champ value)
    uint16_t aimg_period_ms;         // image_anim : periode active (surcharge aimg_period via /update)
    int32_t  aimg_loops_left;        // image_anim : passes restantes ; -1 = infini
    uint32_t aimg_last_ms;           // image_anim : millis() du dernier avancement

    bool     dirty;
};

struct Placement {
    int     comp_index;
    Anchor  anchor; int16_t dx, dy; int16_t width, height;
    int16_t radius, thickness, gap_deg, start_angle, size;
};

struct Page {
    char      name[ID_LEN];
    uint32_t  background;     // couleur de fond résolue (override de la page, sinon fond global du layout)
    char      background_image[ID_LEN];   // clé d'asset (hash) ; vide = pas d'image (la couleur s'applique)
    Placement places[MAX_PLACEMENTS_PER_PAGE];
    int       place_count;
};

struct SourceHeader { char name[HEADER_NAME_LEN]; char value[HEADER_VAL_LEN]; };  // value: littéral ou "$secret"
struct SourceVar    { char name[ID_LEN];          char ptr[PTR_LEN]; };           // variable -> JSON Pointer

struct Source {
    char         name[ID_LEN];
    char         url[URL_LEN];
    uint32_t     interval_s;
    SourceHeader headers[MAX_HEADERS_PER_SOURCE];
    int          header_count;
    SourceVar    vars[MAX_VARS_PER_SOURCE];
    int          var_count;
    // --- runtime (rempli par la tâche productrice en P2) ---
    uint32_t     last_fetch_ms;   // 0 = jamais -> fetch immédiat
    int          last_status;     // dernier code HTTP, ou <0 sur erreur transport/parse
    uint32_t     err_count;
    uint32_t     updated_at;      // millis() du dernier fetch réussi
};

enum SinkMethod : uint8_t { SINK_POST = 0, SINK_PUT, SINK_GET };

struct SinkHeader { char name[HEADER_NAME_LEN]; char value[HEADER_VAL_LEN]; };  // value: littéral ou "$secret"

struct Sink {
    char        name[ID_LEN];           // libellé (miroir de Source.name)
    char        watch[ID_LEN];          // var observée ; son écriture UI arme ce sink
    SinkMethod  method;                 // POST par défaut
    char        url[URL_LEN];
    SinkHeader  headers[MAX_HEADERS_PER_SINK];
    int         header_count;
    char        body[SINK_BODY_LEN];    // gabarit ("" => corps par défaut {"<watch>": <val>})
    uint32_t    debounce_ms;
    // --- runtime (rempli par push_task en Plan A, armé par l'UI en Plan B) ---
    uint32_t    pending_since;          // 0 = non armé ; sinon millis() de la dernière écriture UI
    int         last_status;            // dernier code HTTP, <=0 sur erreur transport
    uint32_t    err_count;
    uint32_t    fired_at;               // millis() du dernier tir réussi
    // capture à l'armement (momentary) : corps figé au tap, consommé au tir
    char        captured_body[SINK_BODY_LEN + TEXT_LEN];
    bool        has_capture;
};

struct Dashboard {
    char      title[TEXT_LEN];
    uint32_t  background;
    bool      nav_wrap;
    char      tz[TZ_LEN];   // fuseau POSIX pour clock (defaut "UTC0")
    Component components[MAX_COMPONENTS];
    int       comp_count;
    Page      pages[MAX_PAGES];
    int       page_count;
    int       active_page;
    bool      layout_dirty;
    bool      values_dirty;
    Context   ctx;                   // blackboard alimente par /context (push) et le pull (P2)
    Source    sources[MAX_SOURCES];
    int       source_count;
    Sink      sinks[MAX_SINKS];
    int       sink_count;
};

bool bg_key_valid(const char* key);   // clé d'asset image de fond : 1..16 hex minuscules (garde de chemin)
int  dash_find(const Dashboard* d, const char* id);
bool dash_set_layout(Dashboard* d, const char* json, char* err, size_t errn);
int  dash_apply_update(Dashboard* d, const char* json, char* unknown_csv, size_t n);
void dash_tick_countdown(Dashboard* d, uint32_t elapsed_s);
void dash_tick_clock(Dashboard* d);   // marque les composants clock dirty (à appeler chaque seconde)
void dash_tick_aimg(Dashboard* d, uint32_t now_ms);   // image_anim : avance la frame des composants en lecture
void dash_set_context(Dashboard* d, const char* json, uint32_t now);
// Écriture du contexte d'ORIGINE UI (effecteur) : écrit la var ET arme les sinks qui l'observent.
void dash_ctx_write_ui_num(Dashboard* d, const char* var, double v, uint32_t now);
void dash_ctx_write_ui_str(Dashboard* d, const char* var, const char* v, uint32_t now);
void dash_ctx_pulse_num(Dashboard* d, const char* var, double v, uint32_t now);   // momentary : capture + reset
void dash_ctx_pulse_str(Dashboard* d, const char* var, const char* v, uint32_t now);
void context_apply(Dashboard* d);
int32_t slider_quantize(int32_t val, int32_t vmin, int32_t vmax, int32_t step);   // arrondi au pas, borné a vmax ; step<=0 => val
