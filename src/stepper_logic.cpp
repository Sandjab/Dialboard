#include "stepper_logic.h"
int stepper_step(int value, int dir, int step, int vmin, int vmax) {
    int s = step > 0 ? step : 1;
    int v = value + dir * s;
    if (v < vmin) v = vmin;
    if (v > vmax) v = vmax;
    return v;
}
