#pragma once
#include <SD_MMC.h>
#include "k718_pins.h"

// Monte la carte microSD en SDMMC 4-bit, sans formatage automatique.
// Renvoie true si une carte FAT a été montée. À appeler une fois au boot (montage
// au boot uniquement : pas de card-detect sur ce board, insertion à chaud non gérée).
// NB : FAT32 recommandé — l'exFAT (souvent les SDXC > 32 Go) n'est pas garanti par le
// build FATFS et peut échouer au montage (on retombe alors sur LittleFS).
static inline bool k718_sd_begin() {
    if (!SD_MMC.setPins(SD_CLK_PIN, SD_CMD_PIN, SD_D0_PIN, SD_D1_PIN, SD_D2_PIN, SD_D3_PIN))
        return false;
    if (!SD_MMC.begin("/sdcard", /*mode1bit=*/false, /*format_if_mount_failed=*/false))
        return false;
    return SD_MMC.cardType() != CARD_NONE;
}
