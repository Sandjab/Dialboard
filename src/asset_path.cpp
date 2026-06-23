#include "asset_path.h"
#include <stdio.h>

AssetSource asset_source_for_read(bool sd_active, bool exists_on_sd) {
    return (sd_active && exists_on_sd) ? ASSET_SD : ASSET_LITTLEFS;
}

void asset_resolve_path(char* out, size_t out_sz, const char* logical, bool sd_active) {
    if (!out || out_sz == 0 || !logical) return;
    if (sd_active) snprintf(out, out_sz, "/dialboard%s", logical);
    else           snprintf(out, out_sz, "%s", logical);
}
