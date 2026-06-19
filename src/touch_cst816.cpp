#include "touch_cst816.h"
#include <lvgl.h>
#include "driver/i2c.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_touch.h"
#include "esp_lcd_touch_cst816s.h"
#include "k718_pins.h"

// Bring-up CST816 (I2C addr 0x15) -> esp_lcd_touch -> LVGL pointer indev.
// Le composant esp_lcd_touch_cst816s est vendorise dans lib/ (absent du registre
// PlatformIO). Cette plateforme (arduino-esp32 / IDF 5.1.4) n'a que le driver i2c
// "legacy" : esp_lcd_new_panel_io_i2c prend le numero de port (caste en bus handle).

static esp_lcd_touch_handle_t tp = nullptr;

static void touch_read_cb(lv_indev_drv_t*, lv_indev_data_t* data) {
    uint16_t x[1], y[1]; uint8_t cnt = 0;
    esp_lcd_touch_read_data(tp);
    bool pressed = esp_lcd_touch_get_coordinates(tp, x, y, nullptr, &cnt, 1);
    if (pressed && cnt > 0) {
        data->point.x = x[0]; data->point.y = y[0];
        data->state = LV_INDEV_STATE_PRESSED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

void touch_begin() {
    i2c_config_t conf = {};
    conf.mode = I2C_MODE_MASTER;
    conf.sda_io_num = PIN_I2C_SDA; conf.scl_io_num = PIN_I2C_SCL;
    conf.sda_pullup_en = GPIO_PULLUP_ENABLE; conf.scl_pullup_en = GPIO_PULLUP_ENABLE;
    conf.master.clk_speed = 400000;
    i2c_param_config(I2C_NUM_0, &conf);
    i2c_driver_install(I2C_NUM_0, conf.mode, 0, 0, 0);

    esp_lcd_panel_io_handle_t io = nullptr;
    esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_CST816S_CONFIG();
    esp_lcd_new_panel_io_i2c((esp_lcd_i2c_bus_handle_t)I2C_NUM_0, &io_cfg, &io);

    esp_lcd_touch_config_t tcfg = {};
    tcfg.x_max = LCD_H_RES; tcfg.y_max = LCD_V_RES;
    tcfg.rst_gpio_num = (gpio_num_t)PIN_TOUCH_RST;
    tcfg.int_gpio_num = (gpio_num_t)PIN_TOUCH_INT;
    if (esp_lcd_touch_new_i2c_cst816s(io, &tcfg, &tp) != ESP_OK) {
        tp = nullptr;
        return;   // CST816 absent/échec : pas d'indev tactile (encodeur + REST restent dispos)
    }

    static lv_indev_drv_t drv;
    lv_indev_drv_init(&drv);
    drv.type = LV_INDEV_TYPE_POINTER;
    drv.read_cb = touch_read_cb;
    lv_indev_drv_register(&drv);
}
