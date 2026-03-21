// ══════════════════════════════════════════════
// VoxScribe — db.js
// Firebase Firestore + localStorage fallback
// ══════════════════════════════════════════════

export class DB {
  constructor() {
    this._firebase = null;
    this._db       = null;
    this._useLocal = true;
    this._init();
  }

  _init() {
    const key     = localStorage.getItem('vs_fb_key');
    const project = localStorage.getItem('vs_fb_project');

    if (key && project) {
      this._initFirebase(key, project);
    }
    // Always keep localStorage as fallback / offline cache
  }

  async _initFirebase(apiKey, projectId) {
    try {
      // Dynamically import Firebase SDK (CDN)
      const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
      const { getFirestore, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, setDoc }
        = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

      const cfg = { apiKey, projectId, authDomain: `${projectId}.firebaseapp.com` };
      const app = getApps().length ? getApps()[0] : initializeApp(cfg);
      this._db  = getFirestore(app);
      this._useLocal = false;

      // Expose Firestore helpers
      this._fs = { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, setDoc };

    } catch(err) {
      console.warn('Firebase init failed, using localStorage:', err.message);
      this._useLocal = true;
    }
  }

  reinit() { this._init(); }

  // ── Sessions ──────────────────────────────
  async createSession(session) {
    const id = 'sess_' + Date.now();
    session   = { ...session, id };

    if (!this._useLocal && this._db) {
      try {
        await this._fs.setDoc(
          this._fs.doc(this._db, 'sessions', id),
          session
        );
      } catch(e) { console.warn('Firestore write error:', e); }
    }

    // Local cache
    const all = this._getLocal('vs_sessions', []);
    all.push(session);
    this._setLocal('vs_sessions', all);

    return id;
  }

  async getSessions() {
    if (!this._useLocal && this._db) {
      try {
        const snap = await this._fs.getDocs(
          this._fs.query(
            this._fs.collection(this._db, 'sessions'),
            this._fs.orderBy('createdAt', 'desc')
          )
        );
        return snap.docs.map(d => d.data());
      } catch(e) { console.warn('Firestore read error:', e); }
    }
    return this._getLocal('vs_sessions', []).reverse();
  }

  async deleteSession(id) {
    if (!this._useLocal && this._db) {
      try {
        await this._fs.deleteDoc(this._fs.doc(this._db, 'sessions', id));
        // Delete entries subcollection would need a batch; skip for simplicity
      } catch(e) { console.warn('Firestore delete error:', e); }
    }
    let all = this._getLocal('vs_sessions', []);
    all     = all.filter(s => s.id !== id);
    this._setLocal('vs_sessions', all);

    // Remove entries
    localStorage.removeItem('vs_entries_' + id);
  }

  // ── Entries ───────────────────────────────
  async addEntry(sessionId, entry) {
    const entryId = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    entry = { ...entry, id: entryId, sessionId };

    if (!this._useLocal && this._db) {
      try {
        await this._fs.addDoc(
          this._fs.collection(this._db, 'sessions', sessionId, 'entries'),
          entry
        );
      } catch(e) { console.warn('Firestore addEntry error:', e); }
    }

    // Local cache
    const key  = 'vs_entries_' + sessionId;
    const all  = this._getLocal(key, []);
    all.push(entry);
    this._setLocal(key, all);
  }

  async getEntries(sessionId) {
    if (!this._useLocal && this._db) {
      try {
        const snap = await this._fs.getDocs(
          this._fs.query(
            this._fs.collection(this._db, 'sessions', sessionId, 'entries'),
            this._fs.orderBy('wallTime')
          )
        );
        return snap.docs.map(d => d.data());
      } catch(e) { console.warn('Firestore getEntries error:', e); }
    }
    return this._getLocal('vs_entries_' + sessionId, []);
  }

  // ── localStorage helpers ──────────────────
  _getLocal(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch(_) { return def; }
  }
  _setLocal(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(_) {}
  }
}
