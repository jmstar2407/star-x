// ══════════════════════════════════════════════
// VoxScribe — sessions.js
// Session list management (sidebar)
// ══════════════════════════════════════════════

const SESSION_ICONS = {
  meeting:   '📹',
  class:     '🎓',
  interview: '🎙',
  other:     '📝',
};

export class SessionManager {
  constructor(db, transcriptUI, speakers, onSessionLoaded) {
    this.db             = db;
    this.transcriptUI   = transcriptUI;
    this.speakers       = speakers;
    this.onSessionLoaded= onSessionLoaded;
    this._sessions      = [];
    this._listEl        = document.getElementById('sessionList');
  }

  // ── Load all from DB ──────────────────────
  async loadAll() {
    this._sessions = await this.db.getSessions();
    this._render();
  }

  // ── Create ────────────────────────────────
  async createSession(name, type) {
    const session = {
      name,
      type,
      createdAt: new Date().toISOString(),
      entryCount: 0,
    };
    const id = await this.db.createSession(session);
    session.id = id;
    this._sessions.unshift(session);
    this.transcriptUI.clear();
    this._render();
    return id;
  }

  // ── Load session ──────────────────────────
  async loadSession(session) {
    const entries = await this.db.getEntries(session.id);
    this.transcriptUI.loadEntries(entries);
    this.onSessionLoaded(session);
    this._render(session.id);
  }

  // ── Delete ────────────────────────────────
  async deleteSession(id) {
    await this.db.deleteSession(id);
    this._sessions = this._sessions.filter(s => s.id !== id);
    this._render();
  }

  // ── Render sidebar list ───────────────────
  _render(activeId = null) {
    this._listEl.innerHTML = '';
    if (!this._sessions.length) {
      const li = document.createElement('li');
      li.className = 'session-empty';
      li.textContent = 'Sin sesiones aún';
      this._listEl.appendChild(li);
      return;
    }

    this._sessions.forEach(s => {
      const li   = document.createElement('li');
      li.className = 'session-item' + (s.id === activeId ? ' active' : '');
      li.dataset.id = s.id;

      const icon = SESSION_ICONS[s.type] || '📝';
      const date = new Date(s.createdAt).toLocaleDateString('es-DO', {
        day: '2-digit', month: 'short',
      });

      li.innerHTML = `
        <span class="session-item-icon">${icon}</span>
        <div class="session-item-info">
          <div class="session-item-name">${this._esc(s.name)}</div>
          <div class="session-item-date">${date}</div>
        </div>
        <button class="session-item-del btn-icon" title="Eliminar" data-del="${s.id}">✕</button>
      `;

      li.addEventListener('click', e => {
        if (e.target.dataset.del) return;
        this.loadSession(s);
      });

      li.querySelector('[data-del]').addEventListener('click', async e => {
        e.stopPropagation();
        if (confirm(`¿Eliminar "${s.name}"?`)) {
          await this.deleteSession(s.id);
        }
      });

      this._listEl.appendChild(li);
    });
  }

  _esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
