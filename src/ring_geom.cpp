#include "ring_geom.h"
int ring_track_radius(int index, int outer_radius, int thickness, int gap) {
    return outer_radius - thickness / 2 - index * (thickness + gap);
}
