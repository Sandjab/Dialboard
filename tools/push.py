#!/usr/bin/env python3
"""Pousse les fenetres d'usage Claude (synthetiques) vers Rich_Telemetry.
Usage: python3 tools/push.py http://<ip> [--interval 5]"""
import sys, time, argparse, urllib.request, json

ap = argparse.ArgumentParser()
ap.add_argument("base")                       # ex http://192.168.1.35
ap.add_argument("--interval", type=float, default=5.0)
a = ap.parse_args()

def post(path, obj):
    req = urllib.request.Request(a.base + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=4) as r:
        return r.read().decode().strip()

pct5, pct7 = 10, 5
r5, r7 = 5 * 3600, 7 * 86400
while True:
    payload = {
        "w5h": {"pct": pct5, "reset_in_s": r5},
        "w7d": {"pct": pct7, "reset_in_s": r7},
        "led": {"mode": "progress", "value": pct5, "color": "#38BDF8"},
    }
    try:
        print(post("/update", payload))
    except Exception as e:
        print("err:", e)
    pct5 = min(100, pct5 + 3); pct7 = min(100, pct7 + 1)
    r5 = max(0, r5 - int(a.interval)); r7 = max(0, r7 - int(a.interval))
    time.sleep(a.interval)
