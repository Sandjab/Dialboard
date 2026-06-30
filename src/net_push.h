#pragma once
#include "dashboard.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// Démarre la tâche de push réactif (cœur 0) : tire les sinks armés après leur débounce.
void net_push_begin(Dashboard* d, SemaphoreHandle_t mutex);
