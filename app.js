/* ============================================
   ScanCal — Main JavaScript
   Safe expression parser, UI logic, particles
   ============================================ */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const State = {
  expression: '',
  result: '0',
  history: [],
  memory: 0,
  memHasValue: false,
  mode: 'basic',
  base: 10,
  undoStack: [],
  redoStack: [],
  settings: {
    theme: 'dark',
    accent: '#6EE7B7',
    fontSize: 16,
    defaultMode: 'basic',
    precision: 8,
    thousandsSep: true,
    angleUnit: 'deg',
    saveHistory: true,
    historyLimit: 100,
    keyboardShortcuts: true,
    reduceMotion: false,
    highContrast: false,
    analytics: false,
    verboseLogs: false,
    demoMode: false,
    largeTouchTargets: false,
    soundEffects: false,
  },
};

// ─── Safe Expression Parser ───────────────────────────────────────────────────
// Custom implementation — never uses eval()

class ExprParser {
  constructor(input, settings) {
    this.input = input.trim();
    this.pos = 0;
    this.settings = settings;
  }

  parse() {
    const result = this.parseExpr();
    if (this.pos < this.input.length) throw new Error('Unexpected character: ' + this.input[this.pos]);
    return result;
  }

  parseExpr() { return this.parseAddSub(); }

  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '+') { this.pos++; left += this.parseMulDiv(); }
      else if (ch === '-') { this.pos++; left -= this.parseMulDiv(); }
      else break;
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parsePower();
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '*') { this.pos++; left *= this.parsePower(); }
      else if (ch === '/') {
        this.pos++;
        const right = this.parsePower();
        if (right === 0) throw new Error('Divide by zero — try a different input');
        left /= right;
      }
      else if (ch === '%' && this.pos < this.input.length - 1) { this.pos++; left = left * this.parsePower() / 100; }
      else break;
    }
    return left;
  }

  parsePower() {
    let base = this.parseUnary();
    if (this.pos < this.input.length && this.input[this.pos] === '^') {
      this.pos++;
      const exp = this.parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  parseUnary() {
    if (this.input[this.pos] === '-') { this.pos++; return -this.parseAtom(); }
    if (this.input[this.pos] === '+') { this.pos++; }
    return this.parseAtom();
  }

  parseAtom() {
    // Parentheses
    if (this.input[this.pos] === '(') {
      this.pos++;
      const val = this.parseExpr();
      if (this.input[this.pos] !== ')') throw new Error('Missing closing parenthesis');
      this.pos++;
      return val;
    }

    // Functions
    const funcs = ['asin','acos','atan','sin','cos','tan','log','ln','sqrt','abs','ceil','floor','round'];
    for (const fn of funcs) {
      if (this.input.substring(this.pos, this.pos + fn.length).toLowerCase() === fn) {
        this.pos += fn.length;
        if (this.input[this.pos] !== '(') throw new Error(`Expected ( after ${fn}`);
        this.pos++;
        let arg = this.parseExpr();
        if (this.input[this.pos] !== ')') throw new Error(`Missing closing paren for ${fn}`);
        this.pos++;
        return this.applyFunc(fn, arg);
      }
    }

    // Constants
    if (this.input.substring(this.pos, this.pos + 2) === 'pi') { this.pos += 2; return Math.PI; }
    if (this.input[this.pos] === 'π') { this.pos++; return Math.PI; }
    if (this.input[this.pos] === 'e' && !/[0-9]/.test(this.input[this.pos + 1] || '')) { this.pos++; return Math.E; }

    // Numbers
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) this.pos++;
    if (this.pos === start) throw new Error('Expected number at position ' + this.pos);
    const numStr = this.input.substring(start, this.pos);
    const num = parseFloat(numStr);
    if (isNaN(num)) throw new Error('Invalid number: ' + numStr);
    return num;
  }

  applyFunc(fn, arg) {
    const toRad = (v) => this.settings.angleUnit === 'deg' ? v * Math.PI / 180 : v;
    const fromRad = (v) => this.settings.angleUnit === 'deg' ? v * 180 / Math.PI : v;

    switch (fn.toLowerCase()) {
      case 'sin':   return Math.sin(toRad(arg));
      case 'cos':   return Math.cos(toRad(arg));
      case 'tan': {
        const r = toRad(arg);
        if (Math.abs(Math.cos(r)) < 1e-10) throw new Error('tan undefined at 90°');
        return Math.tan(r);
      }
      case 'asin':  return fromRad(Math.asin(arg));
      case 'acos':  return fromRad(Math.acos(arg));
      case 'atan':  return fromRad(Math.atan(arg));
      case 'log':   if (arg <= 0) throw new Error('log undefined for ≤ 0'); return Math.log10(arg);
      case 'ln':    if (arg <= 0) throw new Error('ln undefined for ≤ 0'); return Math.log(arg);
      case 'sqrt':  if (arg < 0) throw new Error('sqrt undefined for negative numbers'); return Math.sqrt(arg);
      case 'abs':   return Math.abs(arg);
      case 'ceil':  return Math.ceil(arg);
      case 'floor': return Math.floor(arg);
      case 'round': return Math.round(arg);
      default:      throw new Error('Unknown function: ' + fn);
    }
  }
}

function safeEval(expr) {
  if (!expr || !expr.trim()) return 0;

  // Normalize display characters to computation chars
  let normalized = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/√\(/g, 'sqrt(')
    .replace(/π/g, 'pi')
    .replace(/\^2/g, '^2');

  const parser = new ExprParser(normalized, State.settings);
  return parser.parse();
}

// ─── Format Numbers ───────────────────────────────────────────────────────────

function formatResult(num) {
  if (typeof num !== 'number' || isNaN(num)) return 'Error';
  if (!isFinite(num)) return num > 0 ? '∞' : '-∞';

  const precision = State.settings.precision;
  let str;

  if (Math.abs(num) >= 1e15 || (Math.abs(num) < 1e-10 && num !== 0)) {
    str = num.toExponential(6);
  } else {
    str = parseFloat(num.toPrecision(precision + 1)).toString();
  }

  if (State.settings.thousandsSep) {
    const parts = str.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    str = parts.join('.');
  }

  return str;
}

// ─── Calculator Logic ─────────────────────────────────────────────────────────

function calculate() {
  if (!State.expression) return;

  try {
    const result = safeEval(State.expression);
    const formatted = formatResult(result);

    pushUndoState();
    addToHistory(State.expression, formatted);

    State.result = formatted;
    State.expression = '';
    updateDisplay(formatted, true);
    updateExprDisplay('');
  } catch (err) {
    showError(err.message);
  }
}

function handleInput(val) {
  pushUndoState();

  switch (val) {
    case 'AC':
    case 'C':
      State.expression = '';
      State.result = '0';
      updateDisplay('0', false);
      updateExprDisplay('');
      clearProgrammerDisplay();
      return;

    case '⌫':
      State.expression = State.expression.slice(0, -1);
      break;

    case '=':
      calculate();
      return;

    case '±':
      if (State.expression) {
        if (State.expression.startsWith('-')) State.expression = State.expression.slice(1);
        else State.expression = '-' + State.expression;
      }
      break;

    case '%':
      if (State.expression) {
        try {
          const v = safeEval(State.expression);
          State.expression = (v / 100).toString();
        } catch {}
      }
      break;

    default:
      State.expression += val;
  }

  updateExprDisplay(State.expression);
  // Live preview
  if (State.expression) {
    try {
      const preview = safeEval(State.expression);
      const fmt = formatResult(preview);
      updateDisplay(fmt, false);
      if (State.mode === 'programmer') updateProgrammerDisplay(preview);
    } catch {}
  }
}

// ─── Memory Functions ─────────────────────────────────────────────────────────

function handleMemory(cmd) {
  const current = (() => {
    try { return safeEval(State.expression) || parseFloat(State.result.replace(/,/g, '')) || 0; }
    catch { return 0; }
  })();

  switch (cmd) {
    case 'MC': State.memory = 0; State.memHasValue = false; break;
    case 'MR':
      if (State.memHasValue) {
        State.expression = State.memory.toString();
        updateExprDisplay(State.expression);
      }
      break;
    case 'M+': State.memory += current; State.memHasValue = true; break;
    case 'M-': State.memory -= current; State.memHasValue = true; break;
    case 'MS': State.memory = current; State.memHasValue = true; break;
  }
  updateMemDisplay();
}

function updateMemDisplay() {
  const el = document.getElementById('memDisplay');
  if (!el) return;
  if (State.memHasValue) {
    el.textContent = 'M = ' + formatResult(State.memory);
    el.style.opacity = '1';
  } else {
    el.textContent = '';
    el.style.opacity = '0';
  }
}

// ─── Display Updates ──────────────────────────────────────────────────────────

function updateDisplay(val, animate = false) {
  const el = document.getElementById('displayResult');
  if (!el) return;
  el.textContent = val;
  el.classList.remove('error', 'updated');
  if (animate) {
    void el.offsetWidth;
    el.classList.add('updated');
  }
}

function updateExprDisplay(expr) {
  const el = document.getElementById('displayExpr');
  if (el) el.textContent = expr;
}

function showError(msg) {
  const el = document.getElementById('displayResult');
  if (el) {
    el.textContent = msg || 'Error';
    el.classList.add('error');
  }
  showToast(msg || 'Expression invalid — check parentheses', 'error');
}

// ─── Programmer Mode ──────────────────────────────────────────────────────────

function updateProgrammerDisplay(num) {
  const n = Math.trunc(Number(num));
  if (isNaN(n)) return;
  const hex = document.getElementById('hexVal');
  const dec = document.getElementById('decVal');
  const oct = document.getElementById('octVal');
  const bin = document.getElementById('binVal');
  if (hex) hex.textContent = n.toString(16).toUpperCase() || '0';
  if (dec) dec.textContent = n.toString(10) || '0';
  if (oct) oct.textContent = n.toString(8) || '0';
  if (bin) bin.textContent = n.toString(2) || '0';
}

function clearProgrammerDisplay() {
  ['hexVal','decVal','octVal','binVal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
}

// ─── Graphing Mode ────────────────────────────────────────────────────────────

function plotGraph() {
  const canvas = document.getElementById('graphCanvas');
  if (!canvas) return;
  const exprInput = document.getElementById('graphExpr');
  const expr = exprInput ? exprInput.value : 'sin(x)';
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-3').trim();
  const accent = State.settings.accent;
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim();

  ctx.fillStyle = bg || '#1A1D24';
  ctx.fillRect(0, 0, W, H);

  const xMin = -10, xMax = 10;
  const yMin = -6, yMax = 6;
  const xScale = W / (xMax - xMin);
  const yScale = H / (yMax - yMin);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = Math.ceil(xMin); x <= xMax; x++) {
    const px = (x - xMin) * xScale;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
  for (let y = Math.ceil(yMin); y <= yMax; y++) {
    const py = H - (y - yMin) * yScale;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  const ox = (-xMin) * xScale;
  const oy = H - (-yMin) * yScale;
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();

  // Axis labels
  ctx.fillStyle = textColor || '#475569';
  ctx.font = '10px DM Mono, monospace';
  ctx.textAlign = 'center';
  for (let x = Math.ceil(xMin); x <= xMax; x++) {
    if (x === 0) continue;
    const px = (x - xMin) * xScale;
    ctx.fillText(x, px, oy + 14);
  }
  ctx.textAlign = 'right';
  for (let y = Math.ceil(yMin); y <= yMax; y++) {
    if (y === 0) continue;
    const py = H - (y - yMin) * yScale;
    ctx.fillText(y, ox - 6, py + 4);
  }

  // Plot
  ctx.strokeStyle = accent || '#6EE7B7';
  ctx.lineWidth = 2;
  ctx.shadowColor = accent || '#6EE7B7';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  let first = true;
  const steps = W * 2;

  for (let i = 0; i <= steps; i++) {
    const x = xMin + (xMax - xMin) * i / steps;
    const normalized = expr.replace(/x/g, `(${x})`);
    try {
      const y = safeEval(normalized);
      if (typeof y !== 'number' || isNaN(y) || !isFinite(y)) { first = true; continue; }
      const px = (x - xMin) * xScale;
      const py = H - (y - yMin) * yScale;
      if (first) { ctx.moveTo(px, py); first = false; }
      else ctx.lineTo(px, py);
    } catch { first = true; }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ─── History ──────────────────────────────────────────────────────────────────

function addToHistory(expr, result) {
  if (!State.settings.saveHistory) return;
  const entry = { id: Date.now(), expr, result, pinned: false, ts: new Date().toISOString() };
  State.history.unshift(entry);
  const limit = State.settings.historyLimit === 'unlimited' ? Infinity : parseInt(State.settings.historyLimit);
  if (State.history.length > limit) State.history.pop();
  saveHistory();
  renderHistory();
}

function renderHistory(filter = '') {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  if (!list) return;

  const items = filter
    ? State.history.filter(h => h.expr.includes(filter) || h.result.includes(filter))
    : State.history;

  if (items.length === 0) {
    if (empty) empty.style.display = 'block';
    const existing = list.querySelectorAll('.history-item');
    existing.forEach(e => e.remove());
    return;
  }

  if (empty) empty.style.display = 'none';
  list.innerHTML = '';

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item' + (item.pinned ? ' pinned' : '');
    el.setAttribute('role', 'listitem');
    el.setAttribute('aria-label', `${item.expr} equals ${item.result}`);
    el.innerHTML = `
      <div class="history-item-expr">${escapeHTML(item.expr)}</div>
      <div class="history-item-result">${escapeHTML(item.result)}</div>
      <div class="history-item-actions">
        <button class="icon-btn" data-action="use" data-expr="${escapeHTML(item.expr)}" aria-label="Use expression">↩ Use</button>
        <button class="icon-btn" data-action="copy" data-result="${escapeHTML(item.result)}" aria-label="Copy result">⎘</button>
        <button class="icon-btn" data-action="pin" data-id="${item.id}" aria-label="${item.pinned ? 'Unpin' : 'Pin'}">
          ${item.pinned ? '📌' : '⊙'}
        </button>
        <button class="icon-btn" data-action="delete" data-id="${item.id}" aria-label="Delete entry">✕</button>
      </div>
    `;
    list.appendChild(el);
  });

  // Delegate events
  list.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'use') { State.expression = btn.dataset.expr; updateExprDisplay(State.expression); }
    if (action === 'copy') { copyText(btn.dataset.result); }
    if (action === 'pin') {
      const entry = State.history.find(h => h.id == btn.dataset.id);
      if (entry) { entry.pinned = !entry.pinned; saveHistory(); renderHistory(filter); }
    }
    if (action === 'delete') {
      State.history = State.history.filter(h => h.id != btn.dataset.id);
      saveHistory(); renderHistory(filter);
    }
  };
}

function exportHistoryCSV() {
  const rows = [['Expression', 'Result', 'Timestamp']];
  State.history.forEach(h => rows.push([h.expr, h.result, h.ts]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  downloadFile('scancal-history.csv', csv, 'text/csv');
  showToast('History exported ✔', 'success');
}

// ─── Undo / Redo ──────────────────────────────────────────────────────────────

function pushUndoState() {
  State.undoStack.push(State.expression);
  if (State.undoStack.length > 50) State.undoStack.shift();
  State.redoStack = [];
}

function undo() {
  if (!State.undoStack.length) return;
  State.redoStack.push(State.expression);
  State.expression = State.undoStack.pop();
  updateExprDisplay(State.expression);
  showToast('Undone', 'success');
}

function redo() {
  if (!State.redoStack.length) return;
  State.undoStack.push(State.expression);
  State.expression = State.redoStack.pop();
  updateExprDisplay(State.expression);
  showToast('Redone', 'success');
}

// ─── Mode Switching ───────────────────────────────────────────────────────────

function switchMode(mode) {
  State.mode = mode;

  // Update tabs
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active.toString());
  });

  // Show/hide keypads
  const panels = {
    basic: 'keypad-basic',
    scientific: 'keypad-sci',
    programmer: 'keypad-prog',
    graphing: 'keypad-graph',
  };

  Object.entries(panels).forEach(([m, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = m === mode ? (m === 'graphing' ? 'flex' : 'block') : 'none';
  });

  if (mode === 'graphing') setTimeout(plotGraph, 50);

  // Enable/disable hex keys
  if (mode === 'programmer') {
    enableHexKeys(State.base === 16);
  }
}

function enableHexKeys(enable) {
  ['hexA','hexB','hexC','hexD','hexE','hexF'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = !enable; el.style.opacity = enable ? '1' : '0.3'; }
  });
}

// ─── Theme & Settings ─────────────────────────────────────────────────────────

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', theme);
  }
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.textContent = html.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
}

function applyAccent(color) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.35)`);
}

function applyAccessibility() {
  const html = document.documentElement;
  html.setAttribute('data-reduce-motion', State.settings.reduceMotion.toString());
  html.setAttribute('data-high-contrast', State.settings.highContrast.toString());
}

function saveSettings() {
  localStorage.setItem('scancal_settings', JSON.stringify(State.settings));
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('scancal_settings');
    if (saved) Object.assign(State.settings, JSON.parse(saved));
  } catch {}
  applyTheme(State.settings.theme);
  applyAccent(State.settings.accent);
  applyAccessibility();
}

function saveHistory() {
  if (!State.settings.saveHistory) return;
  try { localStorage.setItem('scancal_history', JSON.stringify(State.history)); } catch {}
}

function loadHistory() {
  try {
    const h = localStorage.getItem('scancal_history');
    if (h) State.history = JSON.parse(h);
  } catch {}
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '⚠'}</span> ${escapeHTML(msg)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ─── Copy / Share ─────────────────────────────────────────────────────────────

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Result copied ✔', 'success');
  }).catch(() => showToast('Copy failed', 'error'));
}

function shareResult() {
  const expr = State.expression || '';
  const result = document.getElementById('displayResult')?.textContent || '';
  const url = `${location.origin}${location.pathname}?expr=${encodeURIComponent(expr)}&r=${encodeURIComponent(result)}`;
  copyText(url);
  showToast('Link copied — paste to share!', 'success');
}

// ─── Ripple Effect ────────────────────────────────────────────────────────────

function addRipple(e, btn) {
  if (State.settings.reduceMotion) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  const x = e.clientX - rect.left - size / 2;
  const y = e.clientY - rect.top - size / 2;
  Object.assign(ripple.style, { width: size + 'px', height: size + 'px', left: x + 'px', top: y + 'px' });
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

// ─── Particle Background ──────────────────────────────────────────────────────

function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.size = Math.random() * 1.5 + 0.3;
      this.speedX = (Math.random() - 0.5) * 0.3;
      this.speedY = (Math.random() - 0.5) * 0.3;
      this.opacity = Math.random() * 0.4 + 0.1;
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110,231,183,${this.opacity})`;
      ctx.fill();
    }
  }

  const count = Math.min(60, Math.floor(W * H / 18000));
  for (let i = 0; i < count; i++) particles.push(new Particle());

  let lastTime = 0;
  function animate(ts) {
    if (State.settings.reduceMotion) return;
    const dt = ts - lastTime;
    if (dt > 33) { // ~30fps max for particles
      lastTime = ts;
      ctx.clearRect(0, 0, W, H);
      particles.forEach(p => { p.update(); p.draw(); });

      // Draw connections
      ctx.lineWidth = 0.3;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.strokeStyle = `rgba(110,231,183,${0.05 * (1 - dist / 120)})`;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ─── Mini Calculator (Homepage) ───────────────────────────────────────────────

function initMiniCalc() {
  const keys = document.querySelectorAll('.mini-key');
  if (!keys.length) return;

  let expr = '', result = '0';
  const exprEl = document.getElementById('miniExpr');
  const resultEl = document.getElementById('miniResult');

  keys.forEach(btn => {
    btn.addEventListener('click', (e) => {
      addRipple(e, btn);
      const val = btn.dataset.val;

      if (val === 'C') { expr = ''; result = '0'; }
      else if (val === '=') {
        try {
          const computed = safeEval(
            expr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-')
          );
          result = formatResult(computed);
          if (exprEl) exprEl.textContent = expr;
          expr = '';
        } catch (err) {
          result = 'Error';
          expr = '';
        }
      }
      else if (val === '±') {
        if (expr.startsWith('-')) expr = expr.slice(1);
        else expr = '-' + expr;
      }
      else if (val === '%') {
        try { expr = (safeEval(expr) / 100).toString(); } catch {}
      }
      else expr += val;

      if (resultEl) {
        resultEl.textContent = val === '=' ? result : (expr || result);
        resultEl.classList.remove('updating');
        void resultEl.offsetWidth;
        resultEl.classList.add('updating');
      }
      if (exprEl && val !== '=') exprEl.textContent = val === 'C' ? '' : expr;
    });
  });
}

// ─── Keyboard Input ───────────────────────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!State.settings.keyboardShortcuts) return;

    // Don't capture when typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const isApp = document.getElementById('displayResult') !== null;

    // Show help overlay
    if (e.key === '?' && isApp) {
      e.preventDefault();
      toggleHelp();
      return;
    }

    // Undo/Redo
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); return; }
    if (e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); return; }

    // Copy
    if (e.key === 'c' && (e.ctrlKey || e.metaKey) && isApp) {
      const result = document.getElementById('displayResult')?.textContent;
      if (result) copyText(result);
      return;
    }

    // Mode switching
    if (e.altKey) {
      if (e.key === '1') { e.preventDefault(); switchMode('basic'); return; }
      if (e.key === '2') { e.preventDefault(); switchMode('scientific'); return; }
      if (e.key === '3') { e.preventDefault(); switchMode('programmer'); return; }
      if (e.key === '4') { e.preventDefault(); switchMode('graphing'); return; }
    }

    // History toggle
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); toggleSidebar(); return; }

    if (!isApp) return;

    // Calculator keys
    const keyMap = {
      'Enter': '=',
      'Escape': 'AC',
      'Backspace': '⌫',
      '+': '+',
      '-': '−',
      '*': '×',
      '/': '÷',
      '(': '(',
      ')': ')',
      '.': '.',
    };

    if (keyMap[e.key]) { e.preventDefault(); handleInput(keyMap[e.key]); return; }
    if (/^[0-9]$/.test(e.key)) { handleInput(e.key); return; }
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const burger = document.getElementById('hamburger');
  if (!sidebar) return;
  const open = sidebar.classList.toggle('open');
  if (overlay) {
    overlay.classList.toggle('open', open);
    overlay.setAttribute('aria-hidden', (!open).toString());
  }
  if (burger) burger.setAttribute('aria-expanded', open.toString());
}

function toggleHelp() {
  const overlay = document.getElementById('helpOverlay');
  if (!overlay) return;
  overlay.classList.toggle('open');
}

// ─── Settings Page Logic ──────────────────────────────────────────────────────

function initSettingsPage() {
  const page = document.querySelector('.settings-layout');
  if (!page) return;

  // Populate fields from settings
  const themeSelect = document.getElementById('themeSelect');
  const defaultMode = document.getElementById('defaultMode');
  const precisionSlider = document.getElementById('precisionSlider');
  const precisionVal = document.getElementById('precisionVal');
  const fontSizeSlider = document.getElementById('fontSizeSlider');
  const thousandsSep = document.getElementById('thousandsSep');
  const angleUnit = document.getElementById('angleUnit');
  const saveHistory = document.getElementById('saveHistory');
  const historyLimit = document.getElementById('historyLimit');
  const keyboardShortcuts = document.getElementById('keyboardShortcuts');
  const reduceMotion = document.getElementById('reduceMotion');
  const highContrast = document.getElementById('highContrast');
  const analytics = document.getElementById('analytics');

  if (themeSelect) themeSelect.value = State.settings.theme;
  if (defaultMode) defaultMode.value = State.settings.defaultMode;
  if (precisionSlider) precisionSlider.value = State.settings.precision;
  if (precisionVal) precisionVal.textContent = State.settings.precision;
  if (fontSizeSlider) fontSizeSlider.value = State.settings.fontSize;
  if (thousandsSep) thousandsSep.checked = State.settings.thousandsSep;
  if (angleUnit) angleUnit.value = State.settings.angleUnit;
  if (saveHistory) saveHistory.checked = State.settings.saveHistory;
  if (historyLimit) historyLimit.value = State.settings.historyLimit;
  if (keyboardShortcuts) keyboardShortcuts.checked = State.settings.keyboardShortcuts;
  if (reduceMotion) reduceMotion.checked = State.settings.reduceMotion;
  if (highContrast) highContrast.checked = State.settings.highContrast;
  if (analytics) analytics.checked = State.settings.analytics;

  // Precision slider live update
  if (precisionSlider && precisionVal) {
    precisionSlider.addEventListener('input', () => {
      precisionVal.textContent = precisionSlider.value;
      precisionVal.setAttribute('aria-valuenow', precisionSlider.value);
    });
  }

  // Color swatches
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    if (swatch.dataset.color === State.settings.accent) {
      swatch.classList.add('active');
      swatch.setAttribute('aria-pressed', 'true');
    }
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.remove('active');
        s.setAttribute('aria-pressed', 'false');
      });
      swatch.classList.add('active');
      swatch.setAttribute('aria-pressed', 'true');
      applyAccent(swatch.dataset.color);
    });
  });

  const customColor = document.getElementById('customColor');
  if (customColor) {
    customColor.addEventListener('input', () => applyAccent(customColor.value));
  }

  // Theme select live
  if (themeSelect) {
    themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  }

  // Save
  const saveBtn = document.getElementById('saveSettings');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      State.settings.theme = themeSelect?.value || 'dark';
      State.settings.defaultMode = defaultMode?.value || 'basic';
      State.settings.precision = parseInt(precisionSlider?.value || 8);
      State.settings.fontSize = parseInt(fontSizeSlider?.value || 16);
      State.settings.thousandsSep = thousandsSep?.checked ?? true;
      State.settings.angleUnit = angleUnit?.value || 'deg';
      State.settings.saveHistory = saveHistory?.checked ?? true;
      State.settings.historyLimit = historyLimit?.value || '100';
      State.settings.keyboardShortcuts = keyboardShortcuts?.checked ?? true;
      State.settings.reduceMotion = reduceMotion?.checked ?? false;
      State.settings.highContrast = highContrast?.checked ?? false;
      State.settings.analytics = analytics?.checked ?? false;

      const accentActive = document.querySelector('.color-swatch.active');
      if (accentActive) State.settings.accent = accentActive.dataset.color;
      if (customColor) State.settings.accent = customColor.value;

      saveSettings();
      applyTheme(State.settings.theme);
      applyAccent(State.settings.accent);
      applyAccessibility();
      showToast('Settings saved ✔', 'success');
    });
  }

  // Reset
  const resetBtn = document.getElementById('resetSettings');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      localStorage.removeItem('scancal_settings');
      location.reload();
    });
  }

  // Clear history
  const clearBtn = document.getElementById('clearHistorySettings');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear all history? This cannot be undone.')) {
        State.history = [];
        localStorage.removeItem('scancal_history');
        showToast('History cleared', 'success');
      }
    });
  }

  // Export data
  const exportBtn = document.getElementById('exportData');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const data = { settings: State.settings, history: State.history, exported: new Date().toISOString() };
      downloadFile('scancal-data.json', JSON.stringify(data, null, 2), 'application/json');
      showToast('Data exported ✔', 'success');
    });
  }

  // Delete all data
  const deleteBtn = document.getElementById('deleteAllData');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (confirm('Delete all ScanCal data? This cannot be undone.')) {
        localStorage.removeItem('scancal_settings');
        localStorage.removeItem('scancal_history');
        showToast('All data deleted', 'success');
        setTimeout(() => location.reload(), 1000);
      }
    });
  }
}

// ─── Help Page Logic ──────────────────────────────────────────────────────────

function initHelpPage() {
  // Tabs
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-item').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById('tab-' + tab.dataset.tab);
      if (panel) panel.classList.add('active');
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); }
    });
  });

  // FAQ accordion
  document.querySelectorAll('.faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      item.classList.toggle('open');
      const expanded = item.classList.contains('open');
      q.setAttribute('aria-expanded', expanded.toString());
      item.setAttribute('aria-expanded', expanded.toString());
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q.click(); }
    });
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  loadSettings();
  loadHistory();

  // Theme toggle (present on all pages)
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    State.settings.theme = next;
    saveSettings();
    const toggle = document.getElementById('themeToggle');
    if (toggle) toggle.textContent = next === 'dark' ? '🌙' : '☀️';
  });

  // Update icon on load
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';

  // Particles on homepage
  if (document.getElementById('particle-canvas')) initParticles();

  // Mini calc on homepage
  initMiniCalc();

  // App page
  if (document.getElementById('keypadArea')) initApp();

  // Settings page
  initSettingsPage();

  // Help page
  initHelpPage();

  // Keyboard
  initKeyboard();

  // Check deep link
  const params = new URLSearchParams(location.search);
  if (params.get('expr') && document.getElementById('displayExpr')) {
    State.expression = params.get('expr');
    updateExprDisplay(State.expression);
    showToast('Expression loaded from link', 'success');
  }
}

function initApp() {
  // Start in default mode
  switchMode(State.settings.defaultMode || 'basic');
  renderHistory();
  updateMemDisplay();

  // Key click handlers
  document.querySelectorAll('.key[data-val]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      addRipple(e, btn);
      handleInput(btn.dataset.val);
    });
  });

  // Memory
  document.querySelectorAll('.mem-key[data-mem]').forEach(btn => {
    btn.addEventListener('click', () => handleMemory(btn.dataset.mem));
  });

  // Mode switching
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  // Base switching (programmer)
  document.querySelectorAll('.base-btn[data-base]').forEach(btn => {
    btn.addEventListener('click', () => {
      State.base = parseInt(btn.dataset.base);
      document.querySelectorAll('.base-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', (b === btn).toString());
      });
      enableHexKeys(State.base === 16);
      // Update prog base displays active state
      const labels = { 16: 'hexVal', 10: 'decVal', 8: 'octVal', 2: 'binVal' };
      Object.entries(labels).forEach(([base, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', parseInt(base) === State.base);
      });
    });
  });

  // Undo/redo buttons
  document.getElementById('undoBtn')?.addEventListener('click', undo);
  document.getElementById('redoBtn')?.addEventListener('click', redo);

  // Copy / Share
  document.getElementById('copyBtn')?.addEventListener('click', () => {
    const result = document.getElementById('displayResult')?.textContent;
    if (result) copyText(result);
  });
  document.getElementById('shareBtn')?.addEventListener('click', shareResult);

  // Export history
  document.getElementById('exportBtn')?.addEventListener('click', exportHistoryCSV);

  // Clear history
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    if (confirm('Clear all history?')) {
      State.history = [];
      localStorage.removeItem('scancal_history');
      renderHistory();
      showToast('History cleared', 'success');
    }
  });

  // History search
  document.getElementById('historySearch')?.addEventListener('input', (e) => {
    renderHistory(e.target.value.trim());
  });

  // Hamburger / sidebar toggle
  document.getElementById('hamburger')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);

  // Help overlay
  document.getElementById('closeHelp')?.addEventListener('click', toggleHelp);
  document.getElementById('helpOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) toggleHelp();
  });

  // Graph
  document.getElementById('graphBtn')?.addEventListener('click', plotGraph);
  document.getElementById('graphExpr')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') plotGraph();
  });

  // Homepage mode tabs
  document.querySelectorAll('.mode-tab[data-mode]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    });
  });

  // Demo mode
  if (State.settings.demoMode) loadDemoData();
}

function loadDemoData() {
  State.history = [
    { id: 1, expr: '355 ÷ 113', result: '3.14159292', pinned: true, ts: new Date().toISOString() },
    { id: 2, expr: 'sin(30)', result: '0.5', pinned: false, ts: new Date().toISOString() },
    { id: 3, expr: '2^10', result: '1,024', pinned: false, ts: new Date().toISOString() },
    { id: 4, expr: '√(144)', result: '12', pinned: false, ts: new Date().toISOString() },
  ];
  renderHistory();
}

// Boot
document.addEventListener('DOMContentLoaded', init);
