// ══════════════════════════════════════════════
// VoxScribe — audio.js
// Web Speech API + AudioContext waveform
// ══════════════════════════════════════════════

export class AudioEngine {
  constructor({ onInterim, onFinal, onError, waveformCanvas, getLanguage }) {
    this.onInterim      = onInterim;
    this.onFinal        = onFinal;
    this.onError        = onError;
    this.waveformCanvas = waveformCanvas;
    this.getLanguage    = getLanguage;

    this.recognition    = null;
    this.audioCtx       = null;
    this.analyser       = null;
    this.stream         = null;
    this.animFrame      = null;
    this.running        = false;
    this.restartGuard   = false;

    this._ctx2d = waveformCanvas.getContext('2d');
  }

  // ── Start ─────────────────────────────────
  async start() {
    // Request mic
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // Waveform
    this._setupWaveform(this.stream);

    // Speech recognition
    this._startRecognition();
    this.running = true;
  }

  // ── Stop ──────────────────────────────────
  stop() {
    this.running = false;
    this.restartGuard = true;

    if (this.recognition) {
      try { this.recognition.stop(); } catch(_) {}
      this.recognition = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this._clearWaveform();

    setTimeout(() => { this.restartGuard = false; }, 500);
  }

  // ── Speech Recognition ────────────────────
  _startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      this.onError('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
      return;
    }

    const r = new SR();
    r.lang          = this.getLanguage();
    r.continuous    = true;
    r.interimResults= true;
    r.maxAlternatives = 1;

    r.onresult = e => {
      let interimTranscript = '';
      let finalTranscript   = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interimTranscript += t;
        }
      }

      if (interimTranscript) this.onInterim(interimTranscript);
      if (finalTranscript)   this.onFinal(finalTranscript);
    };

    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed') {
        this.onError('Permiso de micrófono denegado.');
        return;
      }
      this.onError('Error de reconocimiento: ' + e.error);
    };

    r.onend = () => {
      // Auto-restart if still supposed to be running
      if (this.running && !this.restartGuard) {
        setTimeout(() => {
          if (this.running && !this.restartGuard) {
            try { r.start(); } catch(_) {}
          }
        }, 200);
      }
    };

    this.recognition = r;
    r.start();
  }

  // ── Waveform ──────────────────────────────
  _setupWaveform(stream) {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      const src = this.audioCtx.createMediaStreamSource(stream);
      src.connect(this.analyser);
      this._drawWaveform();
    } catch(_) { /* waveform optional */ }
  }

  _drawWaveform() {
    if (!this.analyser) return;
    const canvas = this.waveformCanvas;
    const ctx    = this._ctx2d;
    const W = canvas.offsetWidth || 400;
    const H = 48;
    canvas.width  = W * (window.devicePixelRatio || 1);
    canvas.height = H * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray    = new Uint8Array(bufferLength);

    const draw = () => {
      this.animFrame = requestAnimationFrame(draw);
      this.analyser.getByteTimeDomainData(dataArray);

      // Detect theme for color
      const dark = document.body.dataset.theme === 'dark';
      const accent = dark ? '#a78bfa' : '#7c3aed';

      ctx.clearRect(0, 0, W, H);

      ctx.lineWidth   = 1.5;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();

      const sliceW = W / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * H) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    draw();
  }

  _clearWaveform() {
    const ctx = this._ctx2d;
    ctx.clearRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
  }
}
