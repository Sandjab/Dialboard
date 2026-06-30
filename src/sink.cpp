#include "sink.h"

bool sink_should_fire(uint32_t pending_since, uint32_t now, uint32_t debounce_ms) {
    if (pending_since == 0) return false;
    return (now - pending_since) >= debounce_ms;   // arithmétique uint32 (wrap), comme net_pull
}
