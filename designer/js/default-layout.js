// Layout de départ de l'éditeur. Valide vis-à-vis de layout.schema.json. Indépendant du firmware.
export const DEFAULT_LAYOUT = {
  title: "Dashboard",
  background: "#0B0B0F",
  components: {
    titre: { type: "label", text: "Dashboard", font: 20, color: "#FFFFFF" },
    cpu:   { type: "readout", label: "CPU", unit: "%", font: 20, color: "#38BDF8" },
    ram:   { type: "bar", label: "RAM", min: 0, max: 100, color: "#38BDF8" },
    jauge: { type: "ring", color: "#A78BFA", pill: true, countdown: true,
             thresholds: [[20, "#F87171"], [50, "#FBBF24"]] },
    led:   { type: "led_ring" },
    buzz:  { type: "sound" }
  },
  pages: [
    { name: "Page_1", place: [
      { ref: "jauge", radius: 160, thickness: 16, gap_deg: 70 },
      { ref: "titre", anchor: "TOP_MID", dy: 40 },
      { ref: "cpu", anchor: "CENTER", dy: -20 },
      { ref: "ram", anchor: "BOTTOM_MID", dy: -60, width: 200, height: 16 }
    ] }
    // led_ring/sound : sorties device globales, éditées dans le panneau « Device » (pas de placement).
  ]
};
