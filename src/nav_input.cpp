#include "nav_input.h"
#include "nav_logic.h"
#include "view.h"
#include "bidi_switch_knob.h"
#include "k718_pins.h"

static knob_handle_t knob = nullptr;

void nav_begin() {
    knob_config_t kc = { .gpio_encoder_a = PIN_ENC_A, .gpio_encoder_b = PIN_ENC_B };
    knob = iot_knob_create(&kc);
    iot_knob_clear_count_value(knob);
}

void nav_goto_dir(Dashboard* d, int delta, bool animate) {
    if (d->page_count <= 1) return;
    int idx = delta > 0 ? nav_next(d->active_page, d->page_count, d->nav_wrap)
                        : nav_prev(d->active_page, d->page_count, d->nav_wrap);
    if (animate) view_show_page_anim(d, idx, delta);   // swipe : transition glissée
    else         view_show_page(d, idx);               // encodeur / API : bascule instantanée
}

void nav_tick(Dashboard* d) {
    int delta = iot_knob_get_count_value(knob);
    if (delta == 0) return;
    iot_knob_clear_count_value(knob);
    nav_goto_dir(d, delta > 0 ? +1 : -1);
}
