// ============================================================
// VoxNote — Transcriptor Inteligente
// Firebase + Web Speech API + Claude AI
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================================
// 🔧 FIREBASE CONFIG — Reemplaza con tu configuración
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyD4r7z-ysFQEKMiZaYWShiA_w8k81vJ5Dg",
  authDomain: "star-x-d2c5a.firebaseapp.com",
  projectId: "star-x-d2c5a",
  storageBucket: "star-x-d2c5a.firebasestorage.app",
  messagingSenderId: "933631576228",
  appId: "1:933631576228:web:a27ac7bdd89703af7afe31",
  measurementId: "G-C4TC5LJHVG"
};

// ============================================================
// 🤖 CLAUDE API KEY — Reemplaza con tu clave
// ============================================================
const CLAUDE_API_KEY = "TU_CLAUDE_API_KEY_AQUI";

// ============================================================
// FIREBASE INIT
// ============================================================
let db;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase no configurado — usando localStorage como fallback", e);
}

// ============================================================
// STATE
// ============================================================
const state = {
  currentView: "home",
  currentMode: "meeting",
  isRecording: false,
  isPaused: false,
  startTime: null,
  elapsedMs: 0,
  timerInterval: null,
  transcript: [],      // [{ts, speaker, text}]
  currentSession: null, // session being viewed
  recognition: null,
  audioCtx: null,
  analyser: null,
  animFrame: null,
  sessions: []
};

// ============================================================
// DOM REFERENCES
// ============================================================
const $ = id => document.getElementById(id);
const el = {
  splash: $("splash"),
  app: $("app"),
  navTitle: $("navTitle"),
  btnBack: $("btnBack"),
  btnHistory: $("btnHistory"),
  // Views
  viewHome: $("viewHome"),
  viewRecording: $("viewRecording"),
  viewSession: $("viewSession"),
  viewHistory: $("viewHistory"),
  // Home
  cardMeeting: $("cardMeeting"),
  cardClass: $("cardClass"),
  statSessions: $("statSessions"),
  statMinutes: $("statMinutes"),
  statWords: $("statWords"),
  // Recording
  recModeBadge: $("recModeBadge"),
  sessionTitleInput: $("sessionTitleInput"),
  audioCanvas: $("audioCanvas"),
  recTime: $("recTime"),
  recStatus: $("recStatus"),
  recDot: document.querySelector(".rec-dot"),
  liveTranscript: $("liveTranscript"),
  btnRecord: $("btnRecord"),
  btnPause: $("btnPause"),
  btnStop: $("btnStop"),
  recHint: $("recHint"),
  // Session
  sdTitle: $("sdTitle"),
  sdDate: $("sdDate"),
  sdDuration: $("sdDuration"),
  sdWords: $("sdWords"),
  tabs: document.querySelectorAll(".tab"),
  tabTranscript: $("tabTranscript"),
  tabSummary: $("tabSummary"),
  transcriptFull: $("transcriptFull"),
  summaryLoading: $("summaryLoading"),
  summaryResult: $("summaryResult"),
  btnCopy: $("btnCopy"),
  btnExportTxt: $("btnExportTxt"),
  btnExportPDF: $("btnExportPDF"),
  btnShare: $("btnShare"),
  btnDeleteSession: $("btnDeleteSession"),
  // History
  searchInput: $("searchInput"),
  sessionList: $("sessionList"),
  emptyHistory: $("emptyHistory"),
  histCount: $("histCount"),
  // Misc
  toast: $("toast"),
  modalOverlay: $("modalOverlay"),
  modalTitle: $("modalTitle"),
  modalMsg: $("modalMsg"),
  modalCancel: $("modalCancel"),
  modalConfirm: $("modalConfirm"),
};

// ============================================================
// UTILS
// ============================================================
function showToast(msg, duration = 2500) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), duration);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}
function pad(n) { return String(n).padStart(2, "0"); }

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function wordCount(lines) {
  return lines.reduce((acc, l) => acc + l.text.split(/\s+/).filter(Boolean).length, 0);
}

function showModal(title, msg) {
  return new Promise(resolve => {
    el.modalTitle.textContent = title;
    el.modalMsg.textContent = msg;
    el.modalOverlay.classList.remove("hidden");
    const cleanup = ok => {
      el.modalOverlay.classList.add("hidden");
      resolve(ok);
    };
    el.modalConfirm.onclick = () => cleanup(true);
    el.modalCancel.onclick = () => cleanup(false);
  });
}

// ============================================================
// NAVIGATION
// ============================================================
function navigateTo(viewId, title, showBack = false) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(viewId).classList.add("active");
  el.navTitle.textContent = title;
  el.btnBack.classList.toggle("hidden", !showBack);
  state.currentView = viewId;
}

el.btnBack.addEventListener("click", () => {
  if (state.currentView === "viewRecording") {
    if (state.isRecording) {
      showModal("¿Salir?", "La grabación se perderá si sales ahora.").then(ok => {
        if (ok) { stopRecording(false); navigateTo("viewHome", "VoxNote"); }
      });
    } else {
      navigateTo("viewHome", "VoxNote");
    }
  } else if (state.currentView === "viewSession") {
    navigateTo("viewHistory", "Historial", true);
  } else {
    navigateTo("viewHome", "VoxNote");
  }
});

el.btnHistory.addEventListener("click", () => {
  renderHistory();
  navigateTo("viewHistory", "Historial", true);
});

el.cardMeeting.addEventListener("click", () => {
  state.currentMode = "meeting";
  el.recModeBadge.textContent = "Reunión Virtual";
  el.sessionTitleInput.value = "";
  navigateTo("viewRecording", "Nueva grabación", true);
  resetRecordingUI();
});

el.cardClass.addEventListener("click", () => {
  state.currentMode = "class";
  el.recModeBadge.textContent = "Clase Presencial";
  el.sessionTitleInput.value = "";
  navigateTo("viewRecording", "Nueva grabación", true);
  resetRecordingUI();
});

// ============================================================
// TABS (Session Detail)
// ============================================================
el.tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    el.tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    el.tabTranscript.classList.toggle("hidden", target !== "transcript");
    el.tabSummary.classList.toggle("hidden", target !== "summary");
    if (target === "summary" && state.currentSession) {
      loadSummary(state.currentSession);
    }
  });
});

// ============================================================
// RECORDING — Web Speech API
// ============================================================
function resetRecordingUI() {
  state.transcript = [];
  state.elapsedMs = 0;
  state.isRecording = false;
  state.isPaused = false;
  el.recTime.textContent = "00:00";
  el.recStatus.innerHTML = '<span class="rec-dot"></span> Listo para grabar';
  el.liveTranscript.innerHTML = '<p class="lt-placeholder">El texto aparecerá aquí mientras hablas...</p>';
  el.btnRecord.classList.remove("recording");
  el.btnPause.disabled = true;
  el.btnStop.disabled = true;
  el.recHint.textContent = "Presiona el botón para comenzar a grabar";
}

el.btnRecord.addEventListener("click", () => {
  if (!state.isRecording) {
    startRecording();
  }
});

el.btnPause.addEventListener("click", () => {
  if (state.isPaused) resumeRecording();
  else pauseRecording();
});

el.btnStop.addEventListener("click", async () => {
  const ok = await showModal("¿Detener grabación?", "Se guardará la sesión y se generará el resumen.");
  if (ok) stopRecording(true);
});

function startRecording() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast("⚠️ Tu navegador no soporta reconocimiento de voz. Usa Chrome.");
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.recognition = new SpeechRecognition();
  state.recognition.lang = "es-ES";
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  state.recognition.maxAlternatives = 1;

  state.recognition.onstart = () => {
    state.isRecording = true;
    state.isPaused = false;
    state.startTime = Date.now() - state.elapsedMs;
    el.btnRecord.classList.add("recording");
    el.btnPause.disabled = false;
    el.btnStop.disabled = false;
    el.recHint.textContent = "Grabando... habla con claridad";
    setRecStatus("active", "🔴 Grabando");
    startTimer();
    startVisualizer();
  };

  state.recognition.onresult = (event) => {
    el.liveTranscript.querySelector(".lt-placeholder")?.remove();
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const text = result[0].transcript.trim();
        if (text) {
          const ts = formatTime(Date.now() - state.startTime);
          const line = { ts, speaker: detectSpeaker(text), text };
          state.transcript.push(line);
          appendLiveLine(line);
        }
      } else {
        interim = result[0].transcript;
      }
    }
    updateInterim(interim);
  };

  state.recognition.onerror = (e) => {
    console.error("Speech error:", e.error);
    if (e.error === "no-speech") return;
    if (e.error === "not-allowed") {
      showToast("❌ Permiso de micrófono denegado");
      stopRecording(false);
      return;
    }
    // Restart on other errors
    if (state.isRecording && !state.isPaused) {
      setTimeout(() => {
        try { state.recognition.start(); } catch(_) {}
      }, 500);
    }
  };

  state.recognition.onend = () => {
    if (state.isRecording && !state.isPaused) {
      setTimeout(() => {
        try { state.recognition.start(); } catch(_) {}
      }, 300);
    }
  };

  try {
    state.recognition.start();
    startAudioContext();
  } catch (e) {
    showToast("Error iniciando grabación");
  }
}

function pauseRecording() {
  state.isPaused = true;
  state.elapsedMs = Date.now() - state.startTime;
  clearInterval(state.timerInterval);
  try { state.recognition.stop(); } catch(_) {}
  el.btnPause.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  setRecStatus("paused", "⏸ Pausado");
  stopVisualizer();
}

function resumeRecording() {
  state.isPaused = false;
  state.startTime = Date.now() - state.elapsedMs;
  el.btnPause.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  setRecStatus("active", "🔴 Grabando");
  startTimer();
  startVisualizer();
  try { state.recognition.start(); } catch(_) {}
}

async function stopRecording(save) {
  state.isRecording = false;
  state.isPaused = false;
  clearInterval(state.timerInterval);
  try { state.recognition.stop(); } catch(_) {}
  stopVisualizer();
  setRecStatus("", "Grabación detenida");
  el.btnRecord.classList.remove("recording");
  el.btnPause.disabled = true;
  el.btnStop.disabled = true;

  if (save && state.transcript.length > 0) {
    const title = el.sessionTitleInput.value.trim() || `Sesión ${new Date().toLocaleDateString("es-ES")}`;
    await saveSession(title);
    renderHistory();
    navigateTo("viewHistory", "Historial", true);
    showToast("✅ Sesión guardada correctamente");
  } else if (save && state.transcript.length === 0) {
    showToast("⚠️ No hay transcripción para guardar");
  }
}

// ============================================================
// SPEAKER DETECTION (heuristic)
// ============================================================
const speakerPool = ["Hablante 1", "Hablante 2", "Hablante 3", "Hablante 4"];
let lastSpeaker = null;
let speakerChangeCount = 0;

function detectSpeaker(text) {
  // Simple heuristic: change speaker every few sentences or on certain cues
  const questionCue = text.endsWith("?");
  const longPause = speakerChangeCount > 3;
  
  if (!lastSpeaker) {
    if (state.currentMode === "class") lastSpeaker = "Profesor";
    else lastSpeaker = speakerPool[0];
  }
  
  speakerChangeCount++;
  
  if ((questionCue || longPause) && Math.random() > 0.6) {
    speakerChangeCount = 0;
    if (state.currentMode === "class") {
      lastSpeaker = lastSpeaker === "Profesor" ? "Estudiante" : "Profesor";
    } else {
      const idx = speakerPool.indexOf(lastSpeaker);
      lastSpeaker = speakerPool[(idx + 1) % 2];
    }
  }
  return lastSpeaker;
}

// ============================================================
// LIVE TRANSCRIPT UI
// ============================================================
function appendLiveLine(line) {
  const div = document.createElement("div");
  div.className = "lt-line";
  div.innerHTML = `<span class="lt-ts">[${line.ts}]</span><span class="lt-speaker">${line.speaker}:</span>${escapeHtml(line.text)}`;
  el.liveTranscript.appendChild(div);
  el.liveTranscript.scrollTop = el.liveTranscript.scrollHeight;
}

let interimEl = null;
function updateInterim(text) {
  if (!interimEl) {
    interimEl = document.createElement("div");
    interimEl.className = "lt-line lt-interim";
    el.liveTranscript.appendChild(interimEl);
  }
  interimEl.textContent = text;
  if (!text && interimEl.parentNode) {
    interimEl.remove();
    interimEl = null;
  }
  el.liveTranscript.scrollTop = el.liveTranscript.scrollHeight;
}

function setRecStatus(type, text) {
  const dot = el.recStatus.querySelector(".rec-dot") || document.createElement("span");
  dot.className = `rec-dot${type ? " " + type : ""}`;
  el.recStatus.innerHTML = "";
  el.recStatus.appendChild(dot);
  el.recStatus.append(" " + text);
}

// ============================================================
// TIMER
// ============================================================
function startTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    const elapsed = Date.now() - state.startTime;
    el.recTime.textContent = formatTime(elapsed);
  }, 500);
}

// ============================================================
// AUDIO VISUALIZER
// ============================================================
function startAudioContext() {
  if (state.audioCtx) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;
    const src = state.audioCtx.createMediaStreamSource(stream);
    src.connect(state.analyser);
    drawVisualizer();
  }).catch(() => {});
}

function drawVisualizer() {
  const canvas = el.audioCanvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  canvas.width = W; canvas.height = H;

  const bufLen = state.analyser ? state.analyser.frequencyBinCount : 128;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    state.animFrame = requestAnimationFrame(draw);
    if (!state.analyser) return;
    state.analyser.getByteFrequencyData(dataArr);

    ctx.clearRect(0, 0, W, H);
    const barW = (W / bufLen) * 2;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const barH = (dataArr[i] / 255) * H * 0.8;
      const alpha = 0.3 + (dataArr[i] / 255) * 0.7;
      ctx.fillStyle = `rgba(124,111,247,${alpha})`;
      ctx.fillRect(x, H - barH, barW - 1, barH);
      x += barW;
    }
  }
  draw();
}

function startVisualizer() {
  if (!state.analyser) startAudioContext();
  else drawVisualizer();
}

function stopVisualizer() {
  cancelAnimationFrame(state.animFrame);
  const ctx = el.audioCanvas.getContext("2d");
  ctx.clearRect(0, 0, el.audioCanvas.width, el.audioCanvas.height);
}

// ============================================================
// SAVE SESSION
// ============================================================
async function saveSession(title) {
  const duration = Date.now() - state.startTime;
  const session = {
    title,
    mode: state.currentMode,
    date: new Date().toISOString(),
    duration,
    transcript: state.transcript,
    words: wordCount(state.transcript),
    summary: null,
    createdAt: Date.now()
  };

  try {
    if (db && firebaseConfig.projectId !== "TU_PROJECT_ID") {
      const docRef = await addDoc(collection(db, "sessions"), session);
      session.id = docRef.id;
    } else {
      session.id = `local_${Date.now()}`;
    }
  } catch (e) {
    session.id = `local_${Date.now()}`;
  }

  // Always save to localStorage as fallback/cache
  const all = getLocalSessions();
  all.unshift(session);
  localStorage.setItem("voxnote_sessions", JSON.stringify(all));
  state.sessions = all;
  updateHomeStats();
}

function getLocalSessions() {
  try { return JSON.parse(localStorage.getItem("voxnote_sessions") || "[]"); } catch { return []; }
}

// ============================================================
// LOAD SESSIONS
// ============================================================
async function loadSessions() {
  let sessions = getLocalSessions();

  if (db && firebaseConfig.projectId !== "TU_PROJECT_ID") {
    try {
      const q = query(collection(db, "sessions"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      localStorage.setItem("voxnote_sessions", JSON.stringify(sessions));
    } catch (e) {
      console.warn("Firebase load failed, using localStorage");
    }
  }
  state.sessions = sessions;
  updateHomeStats();
  return sessions;
}

function updateHomeStats() {
  const s = state.sessions;
  el.statSessions.textContent = s.length;
  const totalMs = s.reduce((a, b) => a + (b.duration || 0), 0);
  el.statMinutes.textContent = Math.round(totalMs / 60000);
  el.statWords.textContent = s.reduce((a, b) => a + (b.words || 0), 0);
}

// ============================================================
// HISTORY VIEW
// ============================================================
async function renderHistory(filter = "") {
  const sessions = state.sessions.length ? state.sessions : await loadSessions();
  const filtered = filter
    ? sessions.filter(s => s.title.toLowerCase().includes(filter.toLowerCase()) ||
        s.transcript?.some(l => l.text.toLowerCase().includes(filter.toLowerCase())))
    : sessions;

  el.histCount.textContent = `${filtered.length} sesión${filtered.length !== 1 ? "es" : ""}`;

  // Clear list (keep emptyHistory)
  Array.from(el.sessionList.children).forEach(c => {
    if (c.id !== "emptyHistory") c.remove();
  });

  if (filtered.length === 0) {
    el.emptyHistory.style.display = "flex";
    return;
  }
  el.emptyHistory.style.display = "none";

  filtered.forEach(s => {
    const card = document.createElement("div");
    card.className = "session-card";
    const excerpt = s.transcript?.[0]?.text || "Sin transcripción";
    const typeClass = s.mode === "meeting" ? "type-meeting" : "type-class";
    const typeLabel = s.mode === "meeting" ? "Reunión" : "Clase";
    card.innerHTML = `
      <div class="session-card-header">
        <div class="session-card-title">${escapeHtml(s.title)}</div>
        <span class="session-card-type ${typeClass}">${typeLabel}</span>
      </div>
      <div class="session-card-excerpt">${escapeHtml(excerpt)}</div>
      <div class="session-card-footer">
        <span class="session-card-meta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(s.date)}
        </span>
        <span class="session-card-meta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formatTime(s.duration || 0)}
        </span>
        <span class="session-card-meta">${s.words || 0} palabras</span>
      </div>
    `;
    card.addEventListener("click", () => openSession(s));
    el.sessionList.appendChild(card);
  });
}

el.searchInput.addEventListener("input", e => renderHistory(e.target.value));

// ============================================================
// SESSION DETAIL
// ============================================================
function openSession(session) {
  state.currentSession = session;
  el.sdTitle.textContent = session.title;
  el.sdDate.textContent = formatDate(session.date);
  el.sdDuration.textContent = formatTime(session.duration || 0);
  el.sdWords.textContent = `${session.words || 0} palabras`;

  // Reset tabs
  el.tabs.forEach(t => t.classList.remove("active"));
  el.tabs[0].classList.add("active");
  el.tabTranscript.classList.remove("hidden");
  el.tabSummary.classList.add("hidden");
  el.summaryResult.classList.add("hidden");
  el.summaryLoading.style.display = "none";

  // Render transcript
  el.transcriptFull.innerHTML = "";
  if (!session.transcript || session.transcript.length === 0) {
    el.transcriptFull.innerHTML = "<p style='color:var(--text3);font-style:italic'>Sin transcripción disponible.</p>";
  } else {
    session.transcript.forEach(line => {
      const div = document.createElement("div");
      div.className = "tf-line";
      div.innerHTML = `<span class="tf-ts">[${line.ts}]</span><span class="tf-speaker">${escapeHtml(line.speaker)}:</span> ${escapeHtml(line.text)}`;
      el.transcriptFull.appendChild(div);
    });
  }

  navigateTo("viewSession", session.title.substring(0, 20), true);
}

// ============================================================
// AI SUMMARY — Claude API
// ============================================================
async function loadSummary(session) {
  if (session.summary) {
    renderSummary(session.summary);
    return;
  }
  if (!session.transcript || session.transcript.length === 0) {
    el.summaryLoading.style.display = "none";
    el.summaryResult.classList.remove("hidden");
    el.summaryResult.innerHTML = '<div class="sum-section"><p>No hay transcripción para resumir.</p></div>';
    return;
  }

  el.summaryLoading.style.display = "flex";
  el.summaryResult.classList.add("hidden");

  const transcriptText = session.transcript
    .map(l => `[${l.ts}] ${l.speaker}: ${l.text}`)
    .join("\n");

  const prompt = `Eres un asistente académico experto. Analiza la siguiente transcripción y genera un resumen estructurado EN ESPAÑOL.

TRANSCRIPCIÓN:
${transcriptText}

Responde SOLO con un objeto JSON con esta estructura exacta (sin markdown, sin backticks):
{
  "tema": "Tema principal en 1 oración",
  "resumen": "Resumen corto en 2-3 oraciones",
  "conceptos": ["concepto 1", "concepto 2", "concepto 3"],
  "puntos_clave": ["punto 1", "punto 2", "punto 3"],
  "preguntas": ["pregunta relevante 1", "pregunta relevante 2"],
  "tareas": ["tarea o conclusión 1", "tarea o conclusión 2"]
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const rawText = data.content?.find(b => b.type === "text")?.text || "{}";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const summary = JSON.parse(clean);

    // Cache in session
    session.summary = summary;
    const all = getLocalSessions();
    const idx = all.findIndex(s => s.id === session.id);
    if (idx !== -1) { all[idx].summary = summary; localStorage.setItem("voxnote_sessions", JSON.stringify(all)); }

    el.summaryLoading.style.display = "none";
    renderSummary(summary);

  } catch (e) {
    console.error("Summary error:", e);
    el.summaryLoading.style.display = "none";
    // Fallback local summary
    const fallback = generateLocalSummary(session.transcript);
    renderSummary(fallback);
  }
}

function generateLocalSummary(transcript) {
  const allText = transcript.map(l => l.text).join(" ");
  const words = allText.split(/\s+/).filter(Boolean);
  const speakers = [...new Set(transcript.map(l => l.speaker))];
  return {
    tema: "Sesión grabada — resumen automático",
    resumen: `Sesión con ${transcript.length} intervenciones de ${speakers.join(", ")}. Total: ${words.length} palabras.`,
    conceptos: speakers,
    puntos_clave: transcript.slice(0, 3).map(l => l.text.substring(0, 80)),
    preguntas: transcript.filter(l => l.text.includes("?")).slice(0, 2).map(l => l.text),
    tareas: ["Revisar la transcripción completa"]
  };
}

function renderSummary(s) {
  el.summaryResult.classList.remove("hidden");
  el.summaryResult.innerHTML = `
    <div class="sum-section">
      <h4>📌 Tema Principal</h4>
      <p>${escapeHtml(s.tema || "—")}</p>
    </div>
    <div class="sum-section">
      <h4>📋 Resumen</h4>
      <p>${escapeHtml(s.resumen || "—")}</p>
    </div>
    <div class="sum-section">
      <h4>💡 Conceptos Clave</h4>
      <div>${(s.conceptos || []).map(c => `<span class="sum-tag">${escapeHtml(c)}</span>`).join("")}</div>
    </div>
    <div class="sum-section">
      <h4>✅ Puntos Clave</h4>
      <ul>${(s.puntos_clave || []).map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
    </div>
    ${(s.preguntas || []).length ? `
    <div class="sum-section">
      <h4>❓ Preguntas Relevantes</h4>
      <ul>${s.preguntas.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
    </div>` : ""}
    ${(s.tareas || []).length ? `
    <div class="sum-section">
      <h4>📝 Tareas / Conclusiones</h4>
      <ul>${s.tareas.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
    </div>` : ""}
  `;
}

// ============================================================
// EXPORT / SHARE ACTIONS
// ============================================================
el.btnCopy.addEventListener("click", () => {
  const session = state.currentSession;
  if (!session) return;
  const text = buildTranscriptText(session);
  navigator.clipboard.writeText(text).then(() => showToast("✅ Copiado al portapapeles"));
});

el.btnExportTxt.addEventListener("click", () => {
  const session = state.currentSession;
  if (!session) return;
  const text = buildTranscriptText(session);
  downloadFile(`${session.title}.txt`, text, "text/plain");
  showToast("📄 TXT descargado");
});

el.btnExportPDF.addEventListener("click", () => {
  const session = state.currentSession;
  if (!session) return;
  exportPDF(session);
});

el.btnShare.addEventListener("click", () => {
  const session = state.currentSession;
  if (!session) return;
  const text = buildTranscriptText(session);
  if (navigator.share) {
    navigator.share({ title: session.title, text: text.substring(0, 2000) })
      .catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast("✅ Texto copiado para compartir"));
  }
});

el.btnDeleteSession.addEventListener("click", async () => {
  const session = state.currentSession;
  if (!session) return;
  const ok = await showModal("¿Eliminar sesión?", `Se eliminará "${session.title}" permanentemente.`);
  if (!ok) return;

  try {
    if (db && session.id && !session.id.startsWith("local_") && firebaseConfig.projectId !== "TU_PROJECT_ID") {
      await deleteDoc(doc(db, "sessions", session.id));
    }
  } catch (e) {}

  const all = getLocalSessions().filter(s => s.id !== session.id);
  localStorage.setItem("voxnote_sessions", JSON.stringify(all));
  state.sessions = all;
  updateHomeStats();
  showToast("🗑️ Sesión eliminada");
  renderHistory();
  navigateTo("viewHistory", "Historial", true);
});

function buildTranscriptText(session) {
  const header = `VoxNote — ${session.title}\nFecha: ${formatDate(session.date)}\nDuración: ${formatTime(session.duration || 0)}\nPalabras: ${session.words || 0}\n${"─".repeat(40)}\n\nTRANSCRIPCIÓN:\n\n`;
  const body = (session.transcript || []).map(l => `[${l.ts}] ${l.speaker}: ${l.text}`).join("\n");
  let summary = "";
  if (session.summary) {
    const s = session.summary;
    summary = `\n\n${"─".repeat(40)}\nRESUMEN IA:\n\nTema: ${s.tema}\n\n${s.resumen}\n\nConceptos clave: ${(s.conceptos||[]).join(", ")}\n\nPuntos clave:\n${(s.puntos_clave||[]).map(p=>"• "+p).join("\n")}\n\nTareas:\n${(s.tareas||[]).map(t=>"• "+t).join("\n")}`;
  }
  return header + body + summary;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPDF(session) {
  const content = buildTranscriptText(session);
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${escapeHtml(session.title)}</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.6; font-size: 13px; }
      h1 { font-size: 1.4rem; border-bottom: 2px solid #7c6ff7; padding-bottom: 8px; color: #333; }
      .meta { color: #666; font-size: 0.85rem; margin-bottom: 20px; }
      .line { margin-bottom: 8px; }
      .ts { color: #7c6ff7; font-size: 0.78rem; font-weight: bold; margin-right: 6px; }
      .speaker { color: #444; font-weight: bold; margin-right: 4px; }
      h2 { font-size: 1rem; color: #7c6ff7; margin-top: 28px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
      .tag { display: inline-block; background: #ede9fe; color: #7c6ff7; padding: 2px 8px; border-radius: 12px; margin: 2px; font-size: 0.78rem; }
      @media print { button { display: none; } }
    </style>
  </head><body>
    <button onclick="window.print()" style="background:#7c6ff7;color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;margin-bottom:16px;font-size:0.9rem">🖨️ Imprimir / Guardar PDF</button>
    <h1>${escapeHtml(session.title)}</h1>
    <div class="meta">📅 ${formatDate(session.date)} &nbsp;·&nbsp; ⏱ ${formatTime(session.duration || 0)} &nbsp;·&nbsp; 📝 ${session.words || 0} palabras</div>
    <h2>TRANSCRIPCIÓN</h2>
    ${(session.transcript || []).map(l => `<div class="line"><span class="ts">[${l.ts}]</span><span class="speaker">${escapeHtml(l.speaker)}:</span>${escapeHtml(l.text)}</div>`).join("")}
    ${session.summary ? `
    <h2>RESUMEN IA</h2>
    <p><strong>Tema:</strong> ${escapeHtml(session.summary.tema)}</p>
    <p>${escapeHtml(session.summary.resumen)}</p>
    <p><strong>Conceptos clave:</strong> ${(session.summary.conceptos||[]).map(c=>`<span class="tag">${escapeHtml(c)}</span>`).join("")}</p>
    <p><strong>Puntos clave:</strong></p><ul>${(session.summary.puntos_clave||[]).map(p=>`<li>${escapeHtml(p)}</li>`).join("")}</ul>
    <p><strong>Tareas:</strong></p><ul>${(session.summary.tareas||[]).map(t=>`<li>${escapeHtml(t)}</li>`).join("")}</ul>
    ` : ""}
  </body></html>`);
  win.document.close();
}

// ============================================================
// SECURITY
// ============================================================
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ============================================================
// INIT
// ============================================================
async function init() {
  await loadSessions();
  setTimeout(() => {
    el.splash.classList.add("fade-out");
    setTimeout(() => {
      el.splash.style.display = "none";
      el.app.classList.remove("hidden");
      navigateTo("viewHome", "VoxNote");
    }, 500);
  }, 1500);
}

init();
