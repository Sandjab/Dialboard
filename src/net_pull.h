#pragma once
#include "dashboard.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
// Tâche productrice : fetch périodique des sources -> contexte (sous mutex). À appeler
// une fois, après la connexion WiFi. Le mutex est partagé avec loop()/les handlers HTTP.
void net_pull_begin(Dashboard* d, SemaphoreHandle_t mutex);
