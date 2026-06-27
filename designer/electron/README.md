# Designer desktop (Electron) — PoC socle

Empaquette le designer web (`designer/`) dans une fenêtre desktop qui parle au device
sans souci de CORS. `designer/` et `schema/` ne sont pas modifiés : ils sont servis en
place via un protocole interne `app://`.

Design : `docs/superpowers/specs/2026-06-27-designer-desktop-electron-design.md`.

## Prérequis

    cd designer/electron && npm install   # installe Electron (local)

## Lancer

    cd designer/electron && npm start

Saisir l'URL du device dans la barre (champ « URL device »), puis Charger / Statut / Pousser.

## Dev sans matériel (mock device)

    cd designer/electron && PORT=8099 node mock-device.mjs   # terminal 1
    cd designer/electron && npm start                        # terminal 2
    # URL device → http://127.0.0.1:8099

## Tests

    cd designer && node --test    # inclut le test transport device.js ↔ mock

## Statut

PoC **socle** : fenêtre + transport device. Hors scope : découverte mDNS, ouverture/
sauvegarde de fichiers locaux, installeurs Win/macOS/Linux + signature, auto-update.
