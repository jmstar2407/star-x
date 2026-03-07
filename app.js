// ════════════════════════════════════════════
// INVAULT v2 — app.js
// Firebase Firestore + Instagram Embeds (fixed)
// ════════════════════════════════════════════
'use strict';

// ── EMBED STRATEGY ─────────────────────────
// Instagram's official embed works via blockquote + embed.js
// BUT embed.js turns blockquotes into iframes dynamically.
// The card thumbnails use a scaled-down iframe approach.
// The detail modal injects a fresh blockquote and calls
// instgrm.Embeds.process() each time.
// For posts that can't embed (stories, profiles), we show
// a styled link card instead.
//
// oEmbed thumbnail cache: once fetched, stored in state.thumbCache
// so we never fetch the same URL twice.
// ────────────────────────────────────────────

// ── CONSTANTS ──────────────────────────────
const PIN = '31007';
const COLLECTION = 'posts';

// ── STATE ──────────────────────────────────
const state = {
  pin: '',
  filter: 'all',
  search: '',
  posts: [],          // live from Firestore
  editId: null,
  editTags: [],
  db: null,
  fbReady: false,
  unsubscribe: null,
  sidebarOpen: false,
  thumbCache: {},     // url -> { html, thumbnail_url, title } | 'error'
};

// ── DOM ────────────────────────────────────
const $ = id => document.getElementById(id);

// Screens
const pinScreen  = $('pin-screen');
const appScreen  = $('app-screen');

// PIN
const pinWrap    = document.querySelector('.pin-wrap');
const pinError   = $('pin-error');
const pinCells   = [0,1,2,3,4].map(i => $(`pc${i}`));

// App
const postsGrid  = $('posts-grid');
const emptyState = $('empty-state');
const loadState  = $('loading-state');
const searchInp  = $('search-input');

// Modals
const addOverlay    = $('add-modal-overlay');
const detailOverlay = $('detail-modal-overlay');

// Add form
const addUrl    = $('add-url');
const addNote   = $('add-note');
const addTags   = $('add-tags');

// Detail
const detailNote     = $('detail-note');
const detailTagsChips= $('detail-tags-chips');
const detailTagInput = $('detail-tag-input');

// Toast
const toastEl = $('toast');
let toastTimer;

// Sidebar
const sidebar = $('sidebar');

// ── FIREBASE INIT ──────────────────────────
window.addEventListener('firebase-ready', () => {
  const { db, collection, query, orderBy, onSnapshot } = window.__firebase;
  state.db = db;
  state.fbReady = true;

  // Live listener
  const q = query(collection(db, COLLECTION), orderBy('savedAt', 'desc'));
  state.unsubscribe = onSnapshot(q,
    snapshot => {
      state.posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (appScreen.classList.contains('active')) {
        hideLoading();
        renderPosts();
        updateCounts();
      }
    },
    err => {
      console.error('Firestore error:', err);
      hideLoading();
      showToast('⚠️ Error conectando con Firebase');
    }
  );
});

// ── PIN ────────────────────────────────────
function setupPin() {
  document.querySelectorAll('.key[data-n]').forEach(k =>
    k.addEventListener('click', () => addDigit(k.dataset.n))
  );
  $('key-del').addEventListener('click', delDigit);

  document.addEventListener('keydown', e => {
    if (!pinScreen.classList.contains('active')) return;
    if (e.key >= '0' && e.key <= '9') addDigit(e.key);
    if (e.key === 'Backspace') delDigit();
  });
}

function addDigit(d) {
  if (state.pin.length >= 5) return;
  state.pin += d;
  renderPinCells();
  if (state.pin.length === 5) setTimeout(checkPin, 130);
}

function delDigit() {
  state.pin = state.pin.slice(0, -1);
  renderPinCells();
  pinError.classList.remove('show');
}

function renderPinCells() {
  pinCells.forEach((c, i) => c.classList.toggle('on', i < state.pin.length));
}

function checkPin() {
  if (state.pin === PIN) {
    enterApp();
  } else {
    pinError.classList.add('show');
    pinWrap.classList.add('shaking');
    pinCells.forEach(c => { c.style.background = '#ff4d6d'; c.style.borderColor = 'transparent'; });
    setTimeout(() => {
      state.pin = '';
      renderPinCells();
      pinError.classList.remove('show');
      pinWrap.classList.remove('shaking');
      pinCells.forEach(c => { c.style.background = ''; c.style.borderColor = ''; });
    }, 700);
  }
}

function enterApp() {
  pinScreen.classList.remove('active');
  appScreen.classList.add('active');
  state.pin = '';
  renderPinCells();
  renderPosts();
  updateCounts();
  // Check URL params for shared content (Capacitor / PWA share target)
  checkSharedContent();
}

function lockApp() {
  appScreen.classList.remove('active');
  pinScreen.classList.add('active');
  closeAllModals();
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
}

// ── FIRESTORE CRUD ─────────────────────────
async function addPost(url, type, note, tags) {
  if (!state.fbReady) { showToast('⚠️ Firebase no está listo'); return; }
  const { db, collection, addDoc } = window.__firebase;
  try {
    await addDoc(collection(db, COLLECTION), {
      url,
      type,
      note,
      tags,
      savedAt: new Date().toISOString(),
    });
    showToast('✅ Post guardado');
    return true;
  } catch (e) {
    console.error(e);
    showToast('❌ Error guardando en Firebase');
    return false;
  }
}

async function updatePost(id, data) {
  if (!state.fbReady) return;
  const { db, doc, updateDoc } = window.__firebase;
  try {
    await updateDoc(doc(db, COLLECTION, id), data);
    showToast('✅ Cambios guardados');
  } catch (e) {
    console.error(e);
    showToast('❌ Error actualizando');
  }
}

async function deletePost(id) {
  if (!state.fbReady) return;
  const { db, doc, deleteDoc } = window.__firebase;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    closeAllModals();
    showToast('🗑️ Post eliminado');
  } catch (e) {
    console.error(e);
    showToast('❌ Error eliminando');
  }
}

// ── RENDER ─────────────────────────────────
function hideLoading() {
  loadState.style.display = 'none';
}

function getFiltered() {
  return state.posts.filter(p => {
    if (state.filter !== 'all' && p.type !== state.filter) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const inUrl  = p.url?.toLowerCase().includes(q);
      const inNote = p.note?.toLowerCase().includes(q);
      const inTags = p.tags?.some(t => t.toLowerCase().includes(q));
      if (!inUrl && !inNote && !inTags) return false;
    }
    return true;
  });
}

function renderPosts() {
  hideLoading();
  const posts = getFiltered();

  if (state.posts.length === 0) {
    emptyState.classList.remove('hidden');
    postsGrid.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');

  if (posts.length === 0) {
    postsGrid.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-3)">
        <p style="font-size:14px">Sin resultados para "<em>${esc(state.search)}</em>"</p>
      </div>`;
    return;
  }

  postsGrid.innerHTML = posts.map((p, i) => {
    const typeLabel = { post:'Post', reel:'Reel', story:'Story', profile:'Perfil' }[p.type] || 'Post';
    const tagsHtml  = (p.tags || []).slice(0,3).map(t => `<span class="card-tag">${esc(t)}</span>`).join('');
    const date      = relTime(p.savedAt);
    const canEmbed  = isEmbeddableUrl(p.url);

    // Thumbnail: use cached data if available
    const cached = state.thumbCache[p.url];
    let previewHtml;

    if (cached && cached !== 'error' && cached.thumbnail_url) {
      // We have a thumbnail image from oEmbed
      previewHtml = `
        <div class="card-thumb-img" style="background-image:url('${cached.thumbnail_url}')">
          <div class="card-thumb-overlay">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white" opacity="0.9"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>`;
    } else if (cached === 'error' || !canEmbed) {
      // No embed possible — show styled placeholder
      previewHtml = cardPlaceholder(p.type);
    } else {
      // Not yet fetched — show skeleton and trigger fetch
      previewHtml = `<div class="card-thumb-skeleton" data-url="${esc(p.url)}"></div>`;
    }

    return `
    <div class="post-card" data-id="${p.id}" style="animation-delay:${Math.min(i * 0.05, 0.5)}s">
      <div class="card-ig-preview">${previewHtml}</div>
      <div class="card-body">
        <div class="card-top-row">
          <span class="card-type t-${p.type}">${typeLabel}</span>
          <span class="card-date">${date}</span>
        </div>
        <div class="card-url">${esc(shortUrl(p.url))}</div>
        ${p.note ? `<div class="card-note">${esc(p.note)}</div>` : ''}
        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  postsGrid.querySelectorAll('.post-card').forEach(c =>
    c.addEventListener('click', () => openDetail(c.dataset.id))
  );

  // Fetch thumbnails for uncached embeddable posts
  fetchPendingThumbnails(posts);
}

// Fetch oEmbed thumbnails for all posts that need it
function fetchPendingThumbnails(posts) {
  const pending = posts.filter(p =>
    isEmbeddableUrl(p.url) && !state.thumbCache[p.url]
  );
  if (!pending.length) return;

  pending.forEach(p => {
    // Mark as in-progress to avoid duplicate fetches
    state.thumbCache[p.url] = 'loading';
    fetchOembed(p.url)
      .then(data => {
        state.thumbCache[p.url] = data; // { thumbnail_url, title, html, ... }
        // Update just the skeleton for this card
        updateCardThumb(p.id, p.url, data);
      })
      .catch(() => {
        state.thumbCache[p.url] = 'error';
        updateCardThumb(p.id, p.url, null);
      });
  });
}

// ── OEMBED / THUMBNAIL ─────────────────────
// IMPORTANTE: Despliega cloudflare-worker.js en Cloudflare Workers
// y pega aquí la URL que te da. Instrucciones en el README.
// Ejemplo: 'https://invault-proxy.TU_USUARIO.workers.dev'
const WORKER_URL = 'https://star-x.jmstar2407.workers.dev';

async function fetchOembed(url) {
  const clean = cleanIgUrl(url);

  // Check if worker is configured
  if (!WORKER_URL || WORKER_URL === 'https://star-x.jmstar2407.workers.dev') {
    throw new Error('Worker not configured');
  }

  const proxyUrl = `${WORKER_URL}?url=${encodeURIComponent(clean)}`;
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });

  if (!res.ok) throw new Error('Worker HTTP ' + res.status);
  const data = await res.json();

  if (data.error) throw new Error(data.error);
  if (!data.thumbnail_url && !data.html) throw new Error('No usable data');
  return data;
}

// Update a single card's thumbnail after oEmbed fetch
function updateCardThumb(postId, url, data) {
  const card = postsGrid.querySelector(`.post-card[data-id="${postId}"]`);
  if (!card) return;

  const preview = card.querySelector('.card-ig-preview');
  if (!preview) return;

  if (data && data.thumbnail_url) {
    preview.innerHTML = `
      <div class="card-thumb-img" style="background-image:url('${data.thumbnail_url}')">
        <div class="card-thumb-overlay">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" opacity="0.9"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
      </div>`;
  } else {
    // Get type from the card badge
    const typeBadge = card.querySelector('.card-type');
    const type = typeBadge?.className.replace(/.*t-(\w+).*/, '$1') || 'post';
    preview.innerHTML = cardPlaceholder(type);
  }
}

function cardPlaceholder(type) {
  const icons = {
    post:    `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><circle cx="18.5" cy="5.5" r="1"/></svg>`,
    reel:    `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    story:   `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>`,
    profile: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  };
  const labels = { post:'Post', reel:'Reel', story:'Story', profile:'Perfil' };
  return `
    <div class="card-ig-icon">
      ${icons[type] || icons.post}
      <span>${labels[type] || 'Post'}</span>
    </div>`;
}

function updateCounts() {
  const counts = { all: 0, post: 0, reel: 0, story: 0 };
  state.posts.forEach(p => {
    counts.all++;
    if (counts[p.type] !== undefined) counts[p.type]++;
  });
  Object.keys(counts).forEach(k => {
    const el = $(`count-${k}`);
    if (el) el.textContent = counts[k];
  });
}

// ── HELPERS ────────────────────────────────
function isEmbeddableUrl(url) {
  return /instagram\.com\/(p|reel|reels|tv)\/[^/?#]+/i.test(url);
}

function cleanIgUrl(url) {
  try {
    const u = new URL(url);
    // Keep only the path up to the post ID
    const match = u.pathname.match(/^\/(p|reel|reels|tv)\/([^/]+)/i);
    if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  } catch {}
  return url.split('?')[0].replace(/\/$/, '') + '/';
}

// ── EMBED BUILDER (detail modal) ───────────
function buildEmbed(url) {
  const container = $('embed-container');
  if (!container) return;

  const canEmbed = isEmbeddableUrl(url);

  if (!canEmbed) {
    container.innerHTML = `
      <div class="embed-fallback">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" style="color:var(--text-3)">
          <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="18.5" cy="5.5" r="1"/>
        </svg>
        <p>Vista previa no disponible<br><small style="color:var(--text-3)">Stories y perfiles no soportan embed</small></p>
        <a href="${url}" target="_blank" rel="noopener" class="embed-open-link">Abrir en Instagram →</a>
      </div>`;
    return;
  }

  const clean = cleanIgUrl(url);

  // Check if we have cached thumbnail to show first while iframe loads
  const cached = state.thumbCache[url];
  const thumbBg = (cached && cached !== 'error' && cached !== 'loading' && cached.thumbnail_url)
    ? `style="background:url('${cached.thumbnail_url}') center/cover no-repeat"`
    : '';

  // Use the official Instagram embed iframe URL
  // This is the same URL that embed.js injects, but we do it directly
  // to avoid race conditions with the embed script re-processing
  const embedUrl = `https://www.instagram.com/${isReelUrl(clean) ? 'reel' : 'p'}/${extractPostId(clean)}/embed/captioned/?cr=1&v=14&wp=540`;

  container.innerHTML = `
    <div class="embed-iframe-wrap" ${thumbBg}>
      <iframe
        src="${embedUrl}"
        class="ig-embed-iframe"
        frameborder="0"
        scrolling="no"
        allowtransparency="true"
        allow="encrypted-media"
        loading="lazy"
        onload="this.parentElement.classList.add('loaded')"
        onerror="this.parentElement.innerHTML = '<div class=\\'embed-fallback\\'><p>No se pudo cargar</p><a href=\\'${url}\\' target=\\'_blank\\' class=\\'embed-open-link\\'>Abrir en Instagram →</a></div>'"
      ></iframe>
      <div class="iframe-loading-overlay">
        <div class="spinner sm"></div>
        <span>Cargando vista previa…</span>
      </div>
    </div>`;
}

function isReelUrl(url) {
  return /\/(reel|reels|tv)\//i.test(url);
}

function extractPostId(url) {
  const m = url.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[2] : '';
}

// ── DETAIL MODAL ───────────────────────────
function openDetail(id) {
  const post = state.posts.find(p => p.id === id);
  if (!post) return;

  state.editId = id;
  state.editTags = [...(post.tags || [])];

  // Header badge
  const labels = { post:'Post', reel:'Reel', story:'Story', profile:'Perfil' };
  $('detail-badge').textContent = labels[post.type] || 'Post';

  // Meta
  const urlEl = $('detail-url');
  urlEl.textContent = shortUrl(post.url, 60);
  urlEl.href = post.url;

  $('detail-date').textContent = new Date(post.savedAt).toLocaleString('es-ES');

  // Note
  detailNote.value = post.note || '';

  // Tags
  renderDetailTags();

  // Show modal first, then build embed
  detailOverlay.classList.remove('hidden');

  // Reset embed container with loading state
  const ec = $('embed-container');
  ec.innerHTML = `
    <div class="embed-fallback">
      <div class="spinner sm"></div>
      <span style="font-size:13px;color:var(--text-3);margin-top:4px">Cargando vista previa…</span>
    </div>`;

  // Build embed after modal animation completes
  setTimeout(() => buildEmbed(post.url), 250);
}

function renderDetailTags() {
  detailTagsChips.innerHTML = state.editTags.map(t => `
    <div class="tag-chip">
      <span>${esc(t)}</span>
      <button data-tag="${esc(t)}" onclick="removeDetailTag(this.dataset.tag)">×</button>
    </div>`).join('');
}

window.removeDetailTag = tag => {
  state.editTags = state.editTags.filter(t => t !== tag);
  renderDetailTags();
};

// ── ADD MODAL ──────────────────────────────
function openAddModal(prefillUrl = '') {
  addUrl.value  = prefillUrl;
  addNote.value = '';
  addTags.value = '';
  document.querySelector('input[name="post-type"][value="post"]').checked = true;

  if (prefillUrl) {
    const det = detectType(prefillUrl);
    const radio = document.querySelector(`input[name="post-type"][value="${det}"]`);
    if (radio) radio.checked = true;
    showUrlPreview(prefillUrl);
  } else {
    $('url-preview').classList.add('hidden');
  }

  addOverlay.classList.remove('hidden');
  setTimeout(() => addUrl.focus(), 300);
}

function showUrlPreview(url) {
  const pre = $('url-preview');
  if (url && url.includes('instagram.com')) {
    pre.textContent = url;
    pre.classList.remove('hidden');
  } else {
    pre.classList.add('hidden');
  }
}

function closeAllModals() {
  addOverlay.classList.add('hidden');
  detailOverlay.classList.add('hidden');
  state.editId = null;
}

// ── EVENT SETUP ────────────────────────────
function setupEvents() {
  // PIN lock
  $('sidebar-lock').addEventListener('click', lockApp);

  // Sidebar nav filters
  document.querySelectorAll('.nav-item[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll('.nav-item[data-filter]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pill[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`.pill[data-filter="${state.filter}"]`)?.classList.add('active');
      renderPosts();
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Filter pills (mobile)
  document.querySelectorAll('.pill[data-filter]').forEach(pill => {
    pill.addEventListener('click', () => {
      state.filter = pill.dataset.filter;
      document.querySelectorAll('.pill[data-filter]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.nav-item[data-filter]').forEach(b => b.classList.remove('active'));
      pill.classList.add('active');
      document.querySelector(`.nav-item[data-filter="${state.filter}"]`)?.classList.add('active');
      renderPosts();
    });
  });

  // Search
  searchInp.addEventListener('input', () => {
    state.search = searchInp.value.trim();
    renderPosts();
  });

  // Topbar add
  $('topbar-add-btn').addEventListener('click', () => openAddModal());
  $('empty-add-btn').addEventListener('click', () => openAddModal());
  $('fab').addEventListener('click', () => openAddModal());

  // Menu btn (mobile sidebar)
  $('menu-btn').addEventListener('click', toggleSidebar);

  // Close sidebar when clicking outside
  document.addEventListener('click', e => {
    if (state.sidebarOpen && !sidebar.contains(e.target) && e.target !== $('menu-btn')) {
      closeSidebar();
    }
  });

  // ── ADD MODAL ──
  $('add-modal-close').addEventListener('click', closeAllModals);
  $('add-cancel').addEventListener('click', closeAllModals);

  addOverlay.addEventListener('click', e => {
    if (e.target === addOverlay) closeAllModals();
  });

  // Paste btn
  $('paste-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      addUrl.value = text;
      showUrlPreview(text);
      const det = detectType(text);
      const radio = document.querySelector(`input[name="post-type"][value="${det}"]`);
      if (radio) radio.checked = true;
    } catch {
      showToast('⚠️ No se pudo pegar del portapapeles');
    }
  });

  // Auto-detect type on URL input
  addUrl.addEventListener('input', () => {
    const url = addUrl.value.trim();
    showUrlPreview(url);
    if (url.includes('instagram.com')) {
      const det = detectType(url);
      const radio = document.querySelector(`input[name="post-type"][value="${det}"]`);
      if (radio) radio.checked = true;
    }
  });

  // Save new post
  $('add-save').addEventListener('click', async () => {
    const url = addUrl.value.trim();
    if (!url) { showToast('⚠️ Introduce un enlace'); return; }
    if (!url.startsWith('http')) { showToast('⚠️ URL inválida'); return; }

    const type = document.querySelector('input[name="post-type"]:checked')?.value || 'post';
    const note = addNote.value.trim();
    const tags = addTags.value.split(',').map(t => t.trim()).filter(Boolean);

    const btn = $('add-save');
    btn.textContent = 'Guardando…';
    btn.disabled = true;

    const ok = await addPost(url, type, note, tags);

    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Guardar`;
    btn.disabled = false;

    if (ok) closeAllModals();
  });

  // ── DETAIL MODAL ──
  $('detail-close').addEventListener('click', closeAllModals);
  $('detail-cancel').addEventListener('click', closeAllModals);

  detailOverlay.addEventListener('click', e => {
    if (e.target === detailOverlay) closeAllModals();
  });

  $('detail-copy-btn').addEventListener('click', () => {
    const post = state.posts.find(p => p.id === state.editId);
    if (!post) return;
    copyText(post.url);
    showToast('📋 Enlace copiado');
  });

  $('detail-open-btn').addEventListener('click', () => {
    const post = state.posts.find(p => p.id === state.editId);
    if (!post) return;
    window.open(post.url, '_blank', 'noopener');
  });

  $('detail-delete-btn').addEventListener('click', () => {
    if (!state.editId) return;
    if (confirm('¿Eliminar este post de tu colección?')) {
      deletePost(state.editId);
    }
  });

  $('detail-save').addEventListener('click', async () => {
    if (!state.editId) return;
    await updatePost(state.editId, {
      note: detailNote.value.trim(),
      tags: state.editTags,
    });
    closeAllModals();
  });

  // Tag add in detail
  $('detail-tag-add').addEventListener('click', addDetailTag);
  detailTagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addDetailTag();
  });
}

function addDetailTag() {
  const val = detailTagInput.value.trim();
  if (val && !state.editTags.includes(val)) {
    state.editTags.push(val);
    renderDetailTags();
  }
  detailTagInput.value = '';
}

// ── SIDEBAR ────────────────────────────────
function toggleSidebar() {
  state.sidebarOpen ? closeSidebar() : openSidebar();
}

function openSidebar() {
  sidebar.classList.add('open');
  state.sidebarOpen = true;
}

function closeSidebar() {
  sidebar.classList.remove('open');
  state.sidebarOpen = false;
}

// ── SHARED CONTENT ─────────────────────────
function checkSharedContent() {
  // URL params from Web Share Target / Capacitor
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('url') || params.get('text') || params.get('shared');

  if (shared && shared.includes('instagram.com')) {
    // Clean URL from history
    history.replaceState({}, '', window.location.pathname);
    openAddModal(shared.trim());
    return;
  }

  // Session storage (set by ShareActivity on Android)
  const pending = sessionStorage.getItem('pending_share');
  if (pending) {
    sessionStorage.removeItem('pending_share');
    try {
      const { url } = JSON.parse(pending);
      if (url) openAddModal(url);
    } catch {}
  }
}

// Capacitor deep link handler
window.handleIncomingUrl = url => {
  try {
    const parsed = new URL(url);
    const igUrl = parsed.searchParams.get('url') || parsed.searchParams.get('text');
    if (igUrl) {
      if (appScreen.classList.contains('active')) {
        openAddModal(igUrl);
      } else {
        sessionStorage.setItem('pending_share', JSON.stringify({ url: igUrl }));
      }
    }
  } catch {}
};

// ── UTILS ──────────────────────────────────
function detectType(url) {
  if (!url) return 'post';
  const u = url.toLowerCase();
  if (u.includes('/reel/') || u.includes('/reels/')) return 'reel';
  if (u.includes('/stories/')) return 'story';
  if (u.includes('/tv/')) return 'reel';
  if (u.includes('/p/')) return 'post';
  if (/instagram\.com\/[^\/\?#]+\/?$/.test(u)) return 'profile';
  return 'post';
}

function shortUrl(url, max = 45) {
  try {
    const u = new URL(url);
    const p = u.hostname + u.pathname;
    return p.length > max ? p.slice(0, max) + '…' : p;
  } catch {
    return url.slice(0, max);
  }
}

function relTime(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const dy = Math.floor(diff / 86400000);
  if (m < 1) return 'Ahora';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return d.toLocaleDateString('es-ES', { day:'2-digit', month:'short' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

// ── BOOT ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupPin();
  setupEvents();

  // Warn if worker not configured
  if (!WORKER_URL || WORKER_URL === 'PEGA_AQUI_TU_WORKER_URL') {
    console.warn('[InVault] Cloudflare Worker no configurado. Las miniaturas no se cargarán. Ver cloudflare-worker.js para instrucciones.');
  }
});
