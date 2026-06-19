#include "sound_comp.h"
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include "driver/i2s_std.h"
#include "k718_pins.h"

static constexpr uint32_t SR = 44100;
static constexpr size_t   FRAMES = 256;
static i2s_chan_handle_t  tx = nullptr;
static int16_t            buf[FRAMES * 2];
static float              phase = 0, inc = 0;
static int32_t            remaining_frames = 0;

static void name_to_tone(const char* n, uint16_t& hz, uint16_t& ms) {
    if      (!strcmp(n,"ok"))    { hz = 880;  ms = 120; }
    else if (!strcmp(n,"alert")) { hz = 1175; ms = 250; }
    else if (!strcmp(n,"error")) { hz = 220;  ms = 400; }
    else                         { hz = 660;  ms = 150; }
}

void sound_begin() {
    pinMode(PIN_PA_MUTE, OUTPUT);
    digitalWrite(PIN_PA_MUTE, HIGH);
    i2s_chan_config_t cc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    i2s_new_channel(&cc, &tx, nullptr);
    i2s_std_config_t sc = {
        .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(SR),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = (gpio_num_t)PIN_I2S_BCK,
            .ws   = (gpio_num_t)PIN_I2S_WS,
            .dout = (gpio_num_t)PIN_I2S_DO,
            .din  = I2S_GPIO_UNUSED,
            .invert_flags = { .mclk_inv = false, .bclk_inv = false, .ws_inv = false },
        },
    };
    i2s_channel_init_std_mode(tx, &sc);
    i2s_channel_enable(tx);
}

void sound_tick(Dashboard* d) {
    for (int i = 0; i < d->comp_count; i++) {
        Component& c = d->components[i];
        if (c.type == COMP_SOUND && c.snd_pending) {
            c.snd_pending = false;
            uint16_t hz = c.snd_tone, ms = c.snd_ms;
            if (c.snd_name[0]) name_to_tone(c.snd_name, hz, ms);
            inc = 2.0f * (float)M_PI * hz / SR;
            phase = 0;
            remaining_frames = (int32_t)((uint32_t)ms * SR / 1000);
        }
    }
    for (size_t k = 0; k < FRAMES; k++) {
        int16_t s = 0;
        if (remaining_frames > 0) {
            s = (int16_t)(0.30f * 32767.0f * sinf(phase));
            phase += inc; if (phase >= 2*M_PI) phase -= 2*M_PI;
            remaining_frames--;
        }
        buf[k*2] = s; buf[k*2+1] = s;
    }
    size_t w; i2s_channel_write(tx, buf, sizeof(buf), &w, 0);
}
