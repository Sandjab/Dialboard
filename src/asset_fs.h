#pragma once
#include <FS.h>
#include <Arduino.h>

// Initialise la couche d'assets : monte la SD (k718_sd_begin) et crée /dialboard/{bg,img,aimg}
// si la carte est active. À appeler une fois au boot, après persist_begin().
void    asset_fs_init();

// La SD est-elle montée et utilisable comme stockage primaire d'assets ?
bool    asset_fs_sd_active();

// Taille / utilisation de la carte en Mo (0 si pas de carte active). Encapsule SD_MMC.
uint32_t asset_fs_card_size_mb();
uint32_t asset_fs_card_used_mb();

// Chemin physique pour le FS cible : "/dialboard"+logical sur SD, logical nu sinon.
String  asset_resolve(const char* logical);

// Ouvre un asset en lecture : SD d'abord (chemin résolu) si présent, sinon LittleFS (nu).
File    asset_open_read(const char* logical);

// FS cible des écritures et du balayage GC : SD_MMC si active, sinon LittleFS.
fs::FS& asset_fs_target();
