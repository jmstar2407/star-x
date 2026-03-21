// ══════════════════════════════════════════════
// VoxScribe — speakers.js
// Speaker management with color palette
// ══════════════════════════════════════════════

const COLORS = [
  '#a78bfa', // violet
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f87171', // red
  '#67e8f9', // cyan
  '#fb923c', // orange
  '#e879f9', // fuchsia
  '#4ade80', // green
];

export class SpeakerManager {
  constructor() {
    this._speakers = this._load();
    this._activeId = this._speakers[0]?.id || null;
  }

  // ── Getters ───────────────────────────────
  all()    { return [...this._speakers]; }
  active() { return this._speakers.find(s => s.id === this._activeId) || this._speakers[0]; }

  // ── Mutators ──────────────────────────────
  setActive(id) {
    if (this._speakers.find(s => s.id === id)) {
      this._activeId = id;
    }
  }

  add() {
    const idx   = this._speakers.length;
    const color = COLORS[idx % COLORS.length];
    const sp    = {
      id:    'sp_' + Date.now(),
      name:  `Hablante ${idx + 1}`,
      color,
    };
    this._speakers.push(sp);
    this._save();
    return sp;
  }

  rename(id, name) {
    const sp = this._speakers.find(s => s.id === id);
    if (sp) { sp.name = name; this._save(); }
  }

  remove(id) {
    if (this._speakers.length <= 1) return;
    this._speakers = this._speakers.filter(s => s.id !== id);
    if (this._activeId === id) this._activeId = this._speakers[0].id;
    this._save();
  }

  // ── Persistence ───────────────────────────
  _save() {
    localStorage.setItem('vs_speakers', JSON.stringify(this._speakers));
  }

  _load() {
    try {
      const raw = localStorage.getItem('vs_speakers');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch(_) {}
    return [
      { id: 'sp_1', name: 'Hablante 1', color: COLORS[0] },
      { id: 'sp_2', name: 'Hablante 2', color: COLORS[1] },
    ];
  }
}
