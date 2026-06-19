#pragma once

// Guition JC3636K718 — pin map (cf. docs/demo-code/Demo_idf/demo/main/device/pinconfig.h).
// Notes :
//  - Encoder, LCD, audio I2S, mic I2S, SDMMC sont sur GPIOs *totalement différents*
//    du Waveshare ESP32-S3-Knob-Touch-LCD-1.8. Même IC ST77916, autre pinout.
//  - PIN_RGB_DATA est sur GPIO0, qui sert AUSSI de BOOT strap. Le WS2812 idle = low,
//    donc tant qu'on n'envoie rien avant que le SoC ait booté, pas de conflit.
//  - Encoder : le silkscreen vendor étiquette GPIO 2 = A et GPIO 1 = B, mais on les
//    swap ci-dessous pour que la convention "A = phase qui s'incrémente en CW" du
//    driver bidi_switch_knob (partagé avec le Waveshare Knob) marche. Sans ce swap,
//    le sens du compteur est inversé (CW fait diminuer). Confirmé par test croisé
//    avec le Waveshare Knob — 2026-05-17.

// --- LCD (QSPI ST77916) ---
#define PIN_LCD_CS    12
#define PIN_LCD_CLK   11
#define PIN_LCD_D0    13
#define PIN_LCD_D1    14
#define PIN_LCD_D2    15
#define PIN_LCD_D3    16
#define PIN_LCD_RST   17
#define PIN_LCD_TE    18    // Tear-effect (non exposée côté Waveshare)
#define PIN_LCD_BL    21

#define LCD_H_RES     360
#define LCD_V_RES     360
#define LCD_BPP       16

// --- Rotary Encoder (bidi switch, non-quadrature) ---
// Cf. note d'en-tete : phases A/B swappées par rapport au silkscreen pour aligner
// le sens du compteur avec la convention du driver.
#define PIN_ENC_A     1
#define PIN_ENC_B     2

// --- I2C (Touch CST816 — pas de DRV2605 sur ce board) ---
#define PIN_I2C_SDA   9
#define PIN_I2C_SCL   10
#define PIN_TOUCH_INT 7
#define PIN_TOUCH_RST 8

// --- SD Card (SDMMC 4-wire) ---
#define SD_CMD_PIN    38
#define SD_CLK_PIN    39
#define SD_D0_PIN     40
#define SD_D1_PIN     41
#define SD_D2_PIN     48
#define SD_D3_PIN     47

// --- Audio I2S out (PCM5100A) ---
#define PIN_I2S_BCK   3
#define PIN_I2S_WS    45
#define PIN_I2S_DO    42
#define PIN_PA_MUTE   46    // low = mute

// --- Microphone I2S in ---
#define PIN_MIC_SCK   5
#define PIN_MIC_DATA  4

// --- Battery monitor (DAC) ---
#define PIN_BAT_DAC   6

// --- RGB ring (WS2812, 13 LEDs, GRB color order) ---
#define PIN_RGB_DATA       0
#define RGB_RING_LED_COUNT 13
