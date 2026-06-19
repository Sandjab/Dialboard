#include "nav_logic.h"

int nav_next(int idx, int count, bool wrap) {
    if (count <= 1) return idx < 0 ? 0 : idx % (count > 0 ? count : 1);
    if (idx + 1 < count) return idx + 1;
    return wrap ? 0 : count - 1;
}

int nav_prev(int idx, int count, bool wrap) {
    if (count <= 1) return 0;
    if (idx - 1 >= 0) return idx - 1;
    return wrap ? count - 1 : 0;
}
