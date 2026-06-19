#pragma once

#include <lvgl.h>
#include "esp_lcd_panel_ops.h"
#include "esp_timer.h"
#include "k718_pins.h"
#include "k718_display.h"

// État interne — file-scoped pour éviter les collisions entre unités de traduction.
static lv_display_t *_k718_disp = nullptr;

// ---- LVGL callbacks (API v9) ----

// "Transfert terminé" du panel IO esp_lcd : user_ctx = le lv_display_t*.
static bool _k718_notify_flush_ready(esp_lcd_panel_io_handle_t io,
                                     esp_lcd_panel_io_event_data_t *edata,
                                     void *user_ctx) {
    lv_display_flush_ready((lv_display_t *)user_ctx);
    return false;
}

// Flush v9 : px_map = pixels RGB565 bruts (2 octets/pixel).
static void _k718_flush_cb(lv_display_t *disp, const lv_area_t *area,
                           uint8_t *px_map) {
    esp_lcd_panel_handle_t panel =
        (esp_lcd_panel_handle_t)lv_display_get_user_data(disp);
    esp_lcd_panel_draw_bitmap(panel, area->x1, area->y1,
                              area->x2 + 1, area->y2 + 1, px_map);
}

// Rounder v9 : aligne l'aire invalidée sur des coordonnées paires (ancien rounder_cb).
static void _k718_invalidate_area_cb(lv_event_t *e) {
    lv_area_t *area = (lv_area_t *)lv_event_get_param(e);
    area->x1 = (area->x1 >> 1) << 1;
    area->y1 = (area->y1 >> 1) << 1;
    area->x2 = ((area->x2 >> 1) << 1) + 1;
    area->y2 = ((area->y2 >> 1) << 1) + 1;
}

// Initialise display + LVGL en un appel.
// Appelle k718_display_init() en interne avec le callback flush-ready.
//
// Usage:
//   esp_lcd_panel_handle_t panel = k718_lvgl_init();        // buf_height=36 par défaut
//   esp_lcd_panel_handle_t panel = k718_lvgl_init(72);
//
static inline esp_lcd_panel_handle_t k718_lvgl_init(int buf_height = 36) {
    lv_init();

    _k718_disp = lv_display_create(LCD_H_RES, LCD_V_RES);

    // Le panel IO notifie flush_ready avec le lv_display_t* comme user_ctx.
    esp_lcd_panel_handle_t panel = k718_display_init(
        _k718_notify_flush_ready, _k718_disp);
    lv_display_set_user_data(_k718_disp, panel);

    // Buffers : v9 prend une taille en OCTETS. RGB565 = 2 octets/pixel.
    // NE PAS utiliser sizeof(lv_color_t) (= 3 octets en v9, ce n'est pas le format de rendu).
    size_t buf_pixels = LCD_H_RES * buf_height;
    size_t buf_bytes  = buf_pixels * 2;
    uint8_t *buf1 = (uint8_t *)heap_caps_malloc(buf_bytes, MALLOC_CAP_DMA);
    uint8_t *buf2 = (uint8_t *)heap_caps_malloc(buf_bytes, MALLOC_CAP_DMA);
    assert(buf1 && buf2);
    lv_display_set_buffers(_k718_disp, buf1, buf2, buf_bytes,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);

    lv_display_set_flush_cb(_k718_disp, _k718_flush_cb);
    // Le panneau attend du RGB565 octet-swappé (ex-LV_COLOR_16_SWAP).
    lv_display_set_color_format(_k718_disp, LV_COLOR_FORMAT_RGB565_SWAPPED);
    lv_display_add_event_cb(_k718_disp, _k718_invalidate_area_cb,
                            LV_EVENT_INVALIDATE_AREA, NULL);

    const esp_timer_create_args_t tick_args = {
        .callback = [](void *) { lv_tick_inc(2); },
        .name = "lvgl_tick",
    };
    esp_timer_handle_t tick_timer;
    ESP_ERROR_CHECK(esp_timer_create(&tick_args, &tick_timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(tick_timer, 2000));

    return panel;
}
