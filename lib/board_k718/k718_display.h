#pragma once

#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "driver/spi_master.h"
#include "esp_lcd_sh8601.h"
#include "k718_pins.h"
#include "k718_lcd_init.h"

// Initialize the ST77916 QSPI display and backlight on the K718 JC3636K718.
//
// Usage:
//   esp_lcd_panel_handle_t panel = k718_display_init();
//   esp_lcd_panel_handle_t panel = k718_display_init(flush_ready_cb, &ctx);
//
static inline esp_lcd_panel_handle_t k718_display_init(
        esp_lcd_panel_io_color_trans_done_cb_t on_flush_ready = NULL,
        void *user_ctx = NULL) {

    // 1. SPI bus (QSPI)
    const spi_bus_config_t buscfg = SH8601_PANEL_BUS_QSPI_CONFIG(
        PIN_LCD_CLK, PIN_LCD_D0, PIN_LCD_D1, PIN_LCD_D2, PIN_LCD_D3,
        LCD_H_RES * LCD_V_RES * LCD_BPP / 8
    );
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO));

    // 2. Panel IO
    esp_lcd_panel_io_handle_t io_handle = NULL;
    const esp_lcd_panel_io_spi_config_t io_config = SH8601_PANEL_IO_QSPI_CONFIG(
        PIN_LCD_CS, on_flush_ready, user_ctx
    );
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(
        (esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_config, &io_handle));

    // 3. Panel with vendor config (ST77916 init sequence)
    sh8601_vendor_config_t vendor_config = {
        .init_cmds = lcd_init_cmds,
        .init_cmds_size = sizeof(lcd_init_cmds) / sizeof(lcd_init_cmds[0]),
        .flags = { .use_qspi_interface = 1 },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = PIN_LCD_RST,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = LCD_BPP,
        .vendor_config = &vendor_config,
    };
    esp_lcd_panel_handle_t panel_handle = NULL;
    ESP_ERROR_CHECK(esp_lcd_new_panel_sh8601(io_handle, &panel_config, &panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel_handle));

    // 4. Backlight on (PWM)
    ledcAttach(PIN_LCD_BL, 50000, 8);
    ledcWrite(PIN_LCD_BL, 255);

    return panel_handle;
}
