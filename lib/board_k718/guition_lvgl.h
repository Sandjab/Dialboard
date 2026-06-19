#pragma once

#include <lvgl.h>
#include "esp_lcd_panel_ops.h"
#include "esp_timer.h"
#include "guition_pins.h"
#include "guition_display.h"

// Internal state — file-scoped to avoid collisions across translation units.
static lv_disp_draw_buf_t _guition_disp_buf;
static lv_disp_drv_t      _guition_disp_drv;

// ---- LVGL callbacks ----

static bool _guition_notify_flush_ready(esp_lcd_panel_io_handle_t io,
                                        esp_lcd_panel_io_event_data_t *edata,
                                        void *user_ctx) {
    lv_disp_flush_ready((lv_disp_drv_t *)user_ctx);
    return false;
}

static void _guition_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area,
                              lv_color_t *color_map) {
    esp_lcd_panel_handle_t panel = (esp_lcd_panel_handle_t)drv->user_data;
    esp_lcd_panel_draw_bitmap(panel, area->x1, area->y1,
                              area->x2 + 1, area->y2 + 1, color_map);
}

static void _guition_rounder_cb(lv_disp_drv_t *disp_drv, lv_area_t *area) {
    area->x1 = (area->x1 >> 1) << 1;
    area->y1 = (area->y1 >> 1) << 1;
    area->x2 = ((area->x2 >> 1) << 1) + 1;
    area->y2 = ((area->y2 >> 1) << 1) + 1;
}

// Initialize display + LVGL in one call.
// Calls guition_display_init() internally with the flush-ready callback.
//
// Usage:
//   esp_lcd_panel_handle_t panel = guition_lvgl_init();        // default buf_height=36
//   esp_lcd_panel_handle_t panel = guition_lvgl_init(72);
//
static inline esp_lcd_panel_handle_t guition_lvgl_init(int buf_height = 36) {
    esp_lcd_panel_handle_t panel = guition_display_init(
        _guition_notify_flush_ready, &_guition_disp_drv);

    lv_init();

    size_t buf_pixels = LCD_H_RES * buf_height;
    lv_color_t *buf1 = (lv_color_t *)heap_caps_malloc(
        buf_pixels * sizeof(lv_color_t), MALLOC_CAP_DMA);
    lv_color_t *buf2 = (lv_color_t *)heap_caps_malloc(
        buf_pixels * sizeof(lv_color_t), MALLOC_CAP_DMA);
    assert(buf1 && buf2);
    lv_disp_draw_buf_init(&_guition_disp_buf, buf1, buf2, buf_pixels);

    lv_disp_drv_init(&_guition_disp_drv);
    _guition_disp_drv.hor_res    = LCD_H_RES;
    _guition_disp_drv.ver_res    = LCD_V_RES;
    _guition_disp_drv.flush_cb   = _guition_flush_cb;
    _guition_disp_drv.rounder_cb = _guition_rounder_cb;
    _guition_disp_drv.draw_buf   = &_guition_disp_buf;
    _guition_disp_drv.user_data  = panel;
    lv_disp_drv_register(&_guition_disp_drv);

    const esp_timer_create_args_t tick_args = {
        .callback = [](void *) { lv_tick_inc(2); },
        .name = "lvgl_tick",
    };
    esp_timer_handle_t tick_timer;
    ESP_ERROR_CHECK(esp_timer_create(&tick_args, &tick_timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(tick_timer, 2000));

    return panel;
}
