#include "fonts.h"
#include "fonts/fonts_data.h"

// 4 familles × 4 styles → (données, longueur). Ordre styles : regular, bold, italic, bolditalic.
struct Ttf { const unsigned char *data; const unsigned int *len; };
static const Ttf TTF[4][4] = {
  { {font_montserrat_regular,&font_montserrat_regular_len},{font_montserrat_bold,&font_montserrat_bold_len},
    {font_montserrat_italic,&font_montserrat_italic_len},{font_montserrat_bolditalic,&font_montserrat_bolditalic_len} },
  { {font_jetbrains_mono_regular,&font_jetbrains_mono_regular_len},{font_jetbrains_mono_bold,&font_jetbrains_mono_bold_len},
    {font_jetbrains_mono_italic,&font_jetbrains_mono_italic_len},{font_jetbrains_mono_bolditalic,&font_jetbrains_mono_bolditalic_len} },
  { {font_lora_regular,&font_lora_regular_len},{font_lora_bold,&font_lora_bold_len},
    {font_lora_italic,&font_lora_italic_len},{font_lora_bolditalic,&font_lora_bolditalic_len} },
  { {font_inter_regular,&font_inter_regular_len},{font_inter_bold,&font_inter_bold_len},
    {font_inter_italic,&font_inter_italic_len},{font_inter_bolditalic,&font_inter_bolditalic_len} },
};

#define FONT_CACHE_MAX 32
struct Entry { uint8_t fam, style; uint16_t px; lv_font_t *font; };
static Entry s_cache[FONT_CACHE_MAX];
static int s_cache_n = 0;

static const lv_font_t* fallback(uint16_t px) {
  if (px >= 48) return &lv_font_montserrat_48;
  if (px >= 36) return &lv_font_montserrat_36;
  if (px >= 28) return &lv_font_montserrat_28;
  if (px >= 20) return &lv_font_montserrat_20;
  return &lv_font_montserrat_14;
}

const lv_font_t* get_font(uint8_t family, uint16_t px, bool bold, bool italic) {
  if (family > 3) family = 0;
  if (px < 8) px = 8;
  if (px > 120) px = 120;
  uint8_t style = (bold ? 1 : 0) | (italic ? 2 : 0);   // 0 reg, 1 bold, 2 italic, 3 bolditalic
  for (int i = 0; i < s_cache_n; i++)
    if (s_cache[i].fam == family && s_cache[i].style == style && s_cache[i].px == px)
      return s_cache[i].font;
  const Ttf &t = TTF[family][style];
  lv_font_t *f = lv_tiny_ttf_create_data((const void*)t.data, *t.len, px);
  if (!f) return fallback(px);
  if (s_cache_n < FONT_CACHE_MAX) s_cache[s_cache_n++] = { family, style, px, f };
  return f;
}
