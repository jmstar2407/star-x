// ══════════════════════════════════════════════
// VoxScribe — app.js  (main orchestrator)
// ══════════════════════════════════════════════

import { AudioEngine }    from './audio.js';
import { TranscriptUI }   from './transcript-ui.js';
import { SessionManager } from './sessions.js';
import { SpeakerManager } from './speakers.js';
import { DB }             from './db.js';
import { showToast, formatDuration, exportTxt, exportPdf, exportJson } from './utils.js';

// ── State ─────────────────────────────────────
const state = {
  recording: false,
  sessionId: null,
  sessionName: 'Nueva sesión',
  sessionType: 'meeting',
  startTime: null,
  durationTimer: null,
  autoScroll: true,
  language: localStorage.getItem('vs_lang') || 'es-DO',
  searchActive: false,
};

// ── DOM refs ──────────────────────────────────
const $ = id => document.getElementById(id);

const btnRecord        = $('btnRecord');
const btnNewSession    = $('btnNewSession');
const btnSearch        = $('btnSearch');
const btnExport        = $('btnExport');
const btnCopy          = $('btnCopy');
const btnTheme         = $('btnTheme');
const btnSettings      = $('btnSettings');
const btnAddSpeaker    = $('btnAddSpeaker');
const sidebarEl        = $('sidebar');
const overlayEl        = $('overlay');
const liveBar          = $('liveBar');
const liveText         = $('liveText');
const durationDisplay  = $('durationDisplay');
const sessionTitleEl   = $('sessionTitle');
const sessionMetaEl    = $('sessionMeta');
const searchBar        = $('searchBar');
const searchInput      = $('searchInput');
const searchClose      = $('searchClose');
const activeSpeakerDot = $('activeSpeakerDot');
const activeSpeakerName= $('activeSpeakerName');
const activeSpeakerWrap= $('activeSpeakerWrap');
const speakerDropdown  = $('speakerDropdown');

// ── Sub-modules ───────────────────────────────
const db         = new DB();
const speakers   = new SpeakerManager();
const transcriptUI = new TranscriptUI($('transcriptList'), $('emptyState'), () => state.autoScroll);
const sessions   = new SessionManager(db, transcriptUI, speakers, onSessionLoaded);
const audio      = new AudioEngine({
  onInterim: handleInterim,
  onFinal:   handleFinal,
  onError:   handleAudioError,
  waveformCanvas: $('waveform'),
  getLanguage: () => state.language,
});

// ── Boot ──────────────────────────────────────
init();

async function init() {
  loadSettings();
  updateSpeakerChip();
  await sessions.loadAll();
  bindEvents();
  registerSW();
}

function loadSettings() {
  const lang = localStorage.getItem('vs_lang');
  const as   = localStorage.getItem('vs_autoscroll');
  const theme= localStorage.getItem('vs_theme') || 'dark';
  if (lang) state.language = lang;
  if (as !== null) state.autoScroll = as === 'true';
  document.body.dataset.theme = theme;
  $('themeLabel').textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
}

// ── Record toggle ─────────────────────────────
async function toggleRecord() {
  if (state.recording) {
    stopRecording();
  } else {
    if (!state.sessionId) {
      openNewSessionModal();
      return;
    }
    await startRecording();
  }
}

async function startRecording() {
  try {
    await audio.start();
    state.recording = true;
    state.startTime = Date.now();
    btnRecord.classList.add('recording');
    liveBar.classList.add('visible');
    sessionMetaEl.textContent = 'Grabando…';
    startDurationTimer();
    showToast('🎙 Grabación iniciada');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Error al acceder al micrófono'));
  }
}

function stopRecording() {
  audio.stop();
  state.recording = false;
  btnRecord.classList.remove('recording');
  liveBar.classList.remove('visible');
  clearInterval(state.durationTimer);
  sessionMetaEl.textContent = 'Detenido — ' + new Date().toLocaleTimeString();
  showToast('⏹ Grabación guardada');
}

// ── Audio callbacks ───────────────────────────
function handleInterim(text) {
  liveText.textContent = text || 'Escuchando…';
  transcriptUI.updateInterim(text, speakers.active(), getElapsed());
}

async function handleFinal(text) {
  if (!text.trim()) return;
  const entry = {
    text: text.trim(),
    speaker: speakers.active().id,
    speakerName: speakers.active().name,
    speakerColor: speakers.active().color,
    timestamp: getElapsed(),
    wallTime: new Date().toISOString(),
  };
  transcriptUI.addEntry(entry);
  if (state.sessionId) {
    await db.addEntry(state.sessionId, entry);
  }
  liveText.textContent = 'Escuchando…';
}

function handleAudioError(err) {
  showToast('⚠ ' + err);
  stopRecording();
}

function getElapsed() {
  if (!state.startTime) return '00:00';
  return formatDuration(Math.floor((Date.now() - state.startTime) / 1000));
}

// ── Duration timer ────────────────────────────
function startDurationTimer() {
  state.durationTimer = setInterval(() => {
    durationDisplay.textContent = getElapsed();
  }, 1000);
}

// ── Speaker chip ──────────────────────────────
function updateSpeakerChip() {
  const sp = speakers.active();
  activeSpeakerDot.style.background = sp.color;
  activeSpeakerName.textContent = sp.name;
}

function openSpeakerDropdown() {
  const rect = activeSpeakerWrap.getBoundingClientRect();
  speakerDropdown.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  speakerDropdown.style.left   = rect.left + 'px';
  renderSpeakerDropdown();
  speakerDropdown.classList.remove('hidden');
}

function renderSpeakerDropdown() {
  speakerDropdown.innerHTML = '';
  speakers.all().forEach(sp => {
    const el = document.createElement('div');
    el.className = 'speaker-dropdown-item' + (sp.id === speakers.active().id ? ' active' : '');
    el.innerHTML = `<span class="sd-dot" style="background:${sp.color}"></span>${sp.name}`;
    el.addEventListener('click', () => {
      speakers.setActive(sp.id);
      updateSpeakerChip();
      speakerDropdown.classList.add('hidden');
    });
    speakerDropdown.appendChild(el);
  });
  // Manage
  const manage = document.createElement('div');
  manage.className = 'speaker-dropdown-item sd-manage';
  manage.textContent = '⚙ Gestionar hablantes';
  manage.addEventListener('click', () => {
    speakerDropdown.classList.add('hidden');
    openSpeakersModal();
  });
  speakerDropdown.appendChild(manage);
}

// ── New Session Modal ─────────────────────────
function openNewSessionModal() {
  $('modalNewSession').classList.remove('hidden');
  $('newSessionName').focus();
}

$('modalCancelNew').addEventListener('click', () => $('modalNewSession').classList.add('hidden'));

$('modalConfirmNew').addEventListener('click', async () => {
  const name = $('newSessionName').value.trim() || 'Sesión sin nombre';
  const type = document.querySelector('.type-btn.active')?.dataset.type || 'meeting';
  state.sessionName = name;
  state.sessionType = type;
  const id = await sessions.createSession(name, type);
  state.sessionId = id;
  sessionTitleEl.textContent = name;
  sessionMetaEl.textContent = 'Listo para grabar';
  $('modalNewSession').classList.add('hidden');
  $('newSessionName').value = '';
  await startRecording();
});

// Type buttons
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Speakers Modal ────────────────────────────
function openSpeakersModal() {
  renderSpeakersList();
  $('modalSpeakers').classList.remove('hidden');
}

function renderSpeakersList() {
  const list = $('speakersList');
  list.innerHTML = '';
  speakers.all().forEach(sp => {
    const li = document.createElement('li');
    li.className = 'speaker-row';
    li.dataset.id = sp.id;
    li.innerHTML = `
      <span class="speaker-color-dot" style="background:${sp.color}"></span>
      <input type="text" value="${sp.name}" placeholder="Nombre del hablante" />
      <button class="speaker-row-del btn-icon" title="Eliminar">✕</button>
    `;
    li.querySelector('.speaker-row-del').addEventListener('click', () => {
      if (speakers.all().length <= 1) { showToast('Debe haber al menos un hablante'); return; }
      speakers.remove(sp.id);
      li.remove();
    });
    list.appendChild(li);
  });
}

$('btnAddSpeaker').addEventListener('click', () => {
  speakers.add();
  renderSpeakersList();
});

$('modalCancelSpeakers').addEventListener('click', () => $('modalSpeakers').classList.add('hidden'));

$('modalSaveSpeakers').addEventListener('click', () => {
  document.querySelectorAll('#speakersList .speaker-row').forEach(row => {
    const id   = row.dataset.id;
    const name = row.querySelector('input').value.trim();
    if (name) speakers.rename(id, name);
  });
  updateSpeakerChip();
  $('modalSpeakers').classList.add('hidden');
  showToast('✓ Hablantes actualizados');
});

// ── Settings Modal ────────────────────────────
function openSettingsModal() {
  $('cfgFirebaseKey').value     = localStorage.getItem('vs_fb_key') || '';
  $('cfgFirebaseProject').value = localStorage.getItem('vs_fb_project') || '';
  $('cfgLanguage').value        = state.language;
  $('cfgAutoScroll').checked    = state.autoScroll;
  $('modalSettings').classList.remove('hidden');
}

$('modalCancelSettings').addEventListener('click', () => $('modalSettings').classList.add('hidden'));

$('modalSaveSettings').addEventListener('click', () => {
  const key     = $('cfgFirebaseKey').value.trim();
  const project = $('cfgFirebaseProject').value.trim();
  const lang    = $('cfgLanguage').value;
  const as      = $('cfgAutoScroll').checked;
  if (key)     localStorage.setItem('vs_fb_key', key);
  if (project) localStorage.setItem('vs_fb_project', project);
  localStorage.setItem('vs_lang', lang);
  localStorage.setItem('vs_autoscroll', as);
  state.language   = lang;
  state.autoScroll = as;
  db.reinit();
  $('modalSettings').classList.add('hidden');
  showToast('✓ Configuración guardada');
});

// ── Export Modal ──────────────────────────────
$('exportTxt').addEventListener('click', () => {
  exportTxt(transcriptUI.getAll(), state.sessionName);
  $('modalExport').classList.add('hidden');
});
$('exportPdf').addEventListener('click', () => {
  exportPdf(transcriptUI.getAll(), state.sessionName);
  $('modalExport').classList.add('hidden');
});
$('exportJson').addEventListener('click', () => {
  exportJson(transcriptUI.getAll(), state.sessionName);
  $('modalExport').classList.add('hidden');
});
$('modalCancelExport').addEventListener('click', () => $('modalExport').classList.add('hidden'));

// ── Search ────────────────────────────────────
$('btnSearch').addEventListener('click', () => {
  state.searchActive = !state.searchActive;
  searchBar.classList.toggle('hidden', !state.searchActive);
  if (state.searchActive) searchInput.focus();
  else { searchInput.value = ''; transcriptUI.clearHighlight(); }
});

searchClose.addEventListener('click', () => {
  state.searchActive = false;
  searchBar.classList.add('hidden');
  searchInput.value = '';
  transcriptUI.clearHighlight();
});

searchInput.addEventListener('input', () => {
  transcriptUI.search(searchInput.value);
});

// ── Copy all ──────────────────────────────────
$('btnCopy').addEventListener('click', () => {
  const text = transcriptUI.getAll().map(e =>
    `[${e.timestamp}] ${e.speakerName}: ${e.text}`
  ).join('\n');
  if (!text) { showToast('Nada que copiar'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('✓ Copiado al portapapeles'));
});

// ── Theme toggle ──────────────────────────────
$('btnTheme').addEventListener('click', () => {
  const curr  = document.body.dataset.theme;
  const next  = curr === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  localStorage.setItem('vs_theme', next);
  $('themeLabel').textContent = next === 'dark' ? 'Modo claro' : 'Modo oscuro';
});

// ── Sidebar ───────────────────────────────────
$('sidebarOpen').addEventListener('click', openSidebar);
$('sidebarClose').addEventListener('click', closeSidebar);
overlayEl.addEventListener('click', closeSidebar);

function openSidebar()  { sidebarEl.classList.add('open'); overlayEl.classList.add('visible'); }
function closeSidebar() { sidebarEl.classList.remove('open'); overlayEl.classList.remove('visible'); }

// ── Record button ─────────────────────────────
btnRecord.addEventListener('click', toggleRecord);

// ── Other buttons ─────────────────────────────
$('btnNewSession').addEventListener('click', openNewSessionModal);
$('btnSettings').addEventListener('click', openSettingsModal);
$('btnExport').addEventListener('click', () => $('modalExport').classList.remove('hidden'));

// ── Speaker dropdown ──────────────────────────
activeSpeakerWrap.addEventListener('click', e => {
  e.stopPropagation();
  if (speakerDropdown.classList.contains('hidden')) {
    openSpeakerDropdown();
  } else {
    speakerDropdown.classList.add('hidden');
  }
});
document.addEventListener('click', () => speakerDropdown.classList.add('hidden'));
speakerDropdown.addEventListener('click', e => e.stopPropagation());

// ── Session loaded callback ───────────────────
function onSessionLoaded(session) {
  state.sessionId   = session.id;
  state.sessionName = session.name;
  sessionTitleEl.textContent = session.name;
  sessionMetaEl.textContent  = new Date(session.createdAt).toLocaleDateString();
  closeSidebar();
}

// ── Keyboard shortcuts ────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space' && !e.shiftKey) { e.preventDefault(); toggleRecord(); }
  if (e.key === 'f' || e.key === 'F')    { $('btnSearch').click(); }
});

// ── PWA Service Worker ────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
