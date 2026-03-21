// ══════════════════════════════════════════════
// VoxScribe — transcript-ui.js
// Manages the visual transcript list
// ══════════════════════════════════════════════

export class TranscriptUI {
  constructor(listEl, emptyEl, getAutoScroll) {
    this.list        = listEl;
    this.emptyEl     = emptyEl;
    this.getAutoScroll = getAutoScroll;
    this._entries    = [];       // final entries
    this._interimEl  = null;     // interim DOM node
    this._searchTerm = '';
  }

  // ── Add final entry ───────────────────────
  addEntry(entry) {
    // Remove interim
    this._removeInterim();

    this._entries.push(entry);
    this.emptyEl.style.display = 'none';

    const li = this._buildItem(entry, false);
    this.list.appendChild(li);

    if (this.getAutoScroll()) {
      li.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    // Re-apply search highlight if active
    if (this._searchTerm) {
      this._highlightEl(li, this._searchTerm);
    }
  }

  // ── Update / show interim ─────────────────
  updateInterim(text, speaker, timestamp) {
    if (!text) { this._removeInterim(); return; }

    const entry = {
      text, speaker: speaker.id,
      speakerName: speaker.name,
      speakerColor: speaker.color,
      timestamp, wallTime: '',
    };

    if (!this._interimEl) {
      this.emptyEl.style.display = 'none';
      this._interimEl = this._buildItem(entry, true);
      this.list.appendChild(this._interimEl);
    } else {
      const textNode = this._interimEl.querySelector('.ti-text');
      if (textNode) textNode.textContent = text;
    }

    if (this.getAutoScroll()) {
      this._interimEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  _removeInterim() {
    if (this._interimEl) {
      this._interimEl.remove();
      this._interimEl = null;
    }
  }

  // ── Build DOM node ────────────────────────
  _buildItem(entry, isInterim) {
    const li = document.createElement('li');
    li.className = 'transcript-item' + (isInterim ? ' interim' : '');
    li.dataset.speakerId = entry.speaker;

    li.innerHTML = `
      <div class="ti-left">
        <span class="ti-dot" style="background:${entry.speakerColor}"></span>
        <span class="ti-line"></span>
      </div>
      <div class="ti-body">
        <div class="ti-meta">
          <span class="ti-speaker" style="color:${entry.speakerColor}">${this._esc(entry.speakerName)}</span>
          <span class="ti-time">[${entry.timestamp}]</span>
        </div>
        <p class="ti-text">${this._esc(entry.text)}</p>
      </div>
    `;
    return li;
  }

  // ── Load entries from DB ──────────────────
  loadEntries(entries) {
    this._entries = [];
    this.list.innerHTML = '';
    this._interimEl = null;
    if (!entries || entries.length === 0) {
      this.emptyEl.style.display = '';
      return;
    }
    entries.forEach(e => this.addEntry(e));
  }

  // ── Clear ─────────────────────────────────
  clear() {
    this._entries = [];
    this.list.innerHTML = '';
    this._interimEl = null;
    this.emptyEl.style.display = '';
    this._searchTerm = '';
  }

  // ── Get all entries ───────────────────────
  getAll() {
    return [...this._entries];
  }

  // ── Search ────────────────────────────────
  search(term) {
    this._searchTerm = term.trim().toLowerCase();
    this._removeInterim();

    // Re-render all with highlights
    this.list.innerHTML = '';
    this._entries.forEach(entry => {
      const li = this._buildItem(entry, false);
      if (this._searchTerm) this._highlightEl(li, this._searchTerm);
      this.list.appendChild(li);
    });

    // Scroll to first match
    if (this._searchTerm) {
      const first = this.list.querySelector('.highlight');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  _highlightEl(li, term) {
    const textEl = li.querySelector('.ti-text');
    if (!textEl) return;
    const raw = textEl.textContent;
    const idx = raw.toLowerCase().indexOf(term);
    if (idx === -1) return;
    li.classList.add('highlight');
    const before = raw.slice(0, idx);
    const match  = raw.slice(idx, idx + term.length);
    const after  = raw.slice(idx + term.length);
    textEl.innerHTML = `${this._esc(before)}<mark>${this._esc(match)}</mark>${this._esc(after)}`;
  }

  clearHighlight() {
    this._searchTerm = '';
    this.list.querySelectorAll('.highlight').forEach(el => {
      el.classList.remove('highlight');
      const textEl = el.querySelector('.ti-text');
      const entry  = this._entries[Array.from(this.list.children).indexOf(el)];
      if (textEl && entry) textEl.textContent = entry.text;
    });
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
