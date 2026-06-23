#pragma once
#include <stddef.h>

// Source de lecture d'un asset.
enum AssetSource { ASSET_SD, ASSET_LITTLEFS };

// SD primaire + fallback : on lit sur SD si elle est active ET que le fichier y est,
// sinon on retombe sur LittleFS.
AssetSource asset_source_for_read(bool sd_active, bool exists_on_sd);

// Chemin physique pour le FS cible. Sur SD on isole sous "/dialboard" pour ne jamais
// toucher les données de l'utilisateur ; sur LittleFS le chemin logique est utilisé tel quel.
// `logical` commence par '/', ex. "/img/ab12.565a". Nul-terminé, tronqué si out_sz est insuffisant.
void asset_resolve_path(char* out, size_t out_sz, const char* logical, bool sd_active);
