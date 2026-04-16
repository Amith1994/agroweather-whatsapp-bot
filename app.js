/* =============================================================
   AGROWEATHER BOT — Frontend Application Logic
   District PIN-based authentication + Gemini AI weather advisory
   Stack: Pure browser JS → Gemini API (no backend required for demo)
   Rate-limit handling: 4s cooldown + exponential backoff retry
============================================================= */
'use strict';

/* ────────────────────────────────────────────────────────────
   SYSTEM PROMPT — Weather & Farmer Advisory (Gemini)
──────────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `
You are AgroWeatherBot, a specialized district-level weather advisory assistant for Indian farmers.
You are integrated into a WhatsApp messaging service where farmers send their district PIN codes
to receive weather forecasts and agro-advisories.

────────────────────────────────────────────
ROLE & SCOPE
────────────────────────────────────────────
• Provide current weather conditions, short-term forecasts (3–7 days), and agro-meteorological advisories.
• Tailor all advice to the district/location the user has authenticated with.
• Keep language informal, friendly, and practical — as if texted to a farmer on WhatsApp.
• Cover: temperature, rainfall probability, humidity, wind, UV index, frost/heat advisories.
• Agricultural focus: sowing windows, irrigation needs, drying/harvesting conditions,
  pest/disease risk from weather, spray timing, and cold/heat stress alerts.
• When asked about a specific crop or question, factor in the current weather conditions.

────────────────────────────────────────────
DISTRICT PIN HANDLING
────────────────────────────────────────────
• The district_pin field may be a numeric postal code, a district name, a state+district combo, or a city.
• Map it to a real, searchable location. If ambiguous, pick the most likely agricultural interpretation.
• Examples: "560001" → Bengaluru, Karnataka; "KA-DWD" or "DHARWAD" → Dharwad, Karnataka; "MH-01" → Nashik area

────────────────────────────────────────────
MANDATORY OUTPUT FORMAT (JSON ONLY)
────────────────────────────────────────────
Respond ONLY with this JSON object — no text before or after:

{
  "district_pin": "the pin/identifier used",
  "location": "Resolved location name, e.g. 'Dharwad, Karnataka, India'",
  "weather_icon": "single emoji representing current weather (☀️🌤️⛅🌥️☁️🌧️⛈️🌩️🌨️❄️🌫️🌬️)",
  "condition": "Short weather condition phrase, e.g. 'Partly Cloudy'",
  "temperature_c": 27,
  "feels_like_c": 29,
  "humidity_pct": 68,
  "wind_kmh": 14,
  "rainfall_prob_pct": 30,
  "uv_index": 7,
  "summary": "One casual sentence summarizing today's weather for the district, WhatsApp style.",
  "forecast": [
    { "day": "Today", "icon": "⛅", "high_c": 29, "low_c": 22, "rain_pct": 30, "condition": "Partly Cloudy" },
    { "day": "Tomorrow", "icon": "🌧️", "high_c": 25, "low_c": 20, "rain_pct": 75, "condition": "Rain" },
    { "day": "Wed", "icon": "🌤️", "high_c": 28, "low_c": 21, "rain_pct": 20, "condition": "Mostly Sunny" },
    { "day": "Thu", "icon": "☀️", "high_c": 31, "low_c": 23, "rain_pct": 10, "condition": "Sunny" },
    { "day": "Fri", "icon": "⛅", "high_c": 29, "low_c": 22, "rain_pct": 25, "condition": "Partly Cloudy" }
  ],
  "farm_advisory": [
    "Informal advisory point 1 — direct action for farmer",
    "Informal advisory point 2",
    "Informal advisory point 3",
    "Advisory point 4 (optional)",
    "Advisory point 5 (optional)"
  ],
  "alerts": "Any weather alert or critical warning, or empty string. E.g. 'Heavy rain alert: 80mm expected Thursday. Protect stored produce.'",
  "whatsapp_reply": "The exact short reply text to send back on WhatsApp — 2-4 sentences, casual, uses emojis. Includes temp, rain chance, and top 1-2 farm tips.",
  "confidence": "High | Moderate | Low",
  "data_note": "Note about data freshness or any assumption made, or empty string."
}

Rules:
1. All temperature values must be realistic for the district and current season (Northern hemisphere seasons apply).
2. forecast must have exactly 5 entries: Today + 4 more days.
3. farm_advisory must have 3–5 items. Each is a complete, actionable informal sentence.
4. whatsapp_reply must be 2–4 sentences, use emojis naturally, be WhatsApp-friendly.
5. If question is NOT weather-related, still provide current weather but note the off-topic query in data_note.
6. NEVER fabricate API data — base values on your training knowledge of typical seasonal weather for that district. Flag uncertainty in data_note.
7. No markdown, code fences, or text outside the JSON object.
`.trim();

/* ────────────────────────────────────────────────────────────
   CONSTANTS & STATE
──────────────────────────────────────────────────────────── */
const API_KEY_STORAGE  = 'agroweather_api_key';
const PIN_STORAGE      = 'agroweather_district_pin';
const GEMINI_BASE      = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS    = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
];
const MIN_REQUEST_GAP  = 4000;  // ms cooldown
const MAX_RETRIES      = 3;

const state = {
  apiKey:      localStorage.getItem(API_KEY_STORAGE) || '',
  districtPin: localStorage.getItem(PIN_STORAGE) || '',
  loading:     false,
  history:     [],
  lastCall:    0,
};

/* ────────────────────────────────────────────────────────────
   DOM REFERENCES
──────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const dom = {
  sidebar:          $('sidebar'),
  main:             $('main'),
  menuBtn:          $('menuBtn'),
  sidebarClose:     $('sidebarClose'),
  chatArea:         $('chatArea'),
  welcome:          $('welcome'),
  messages:         $('messages'),
  userInput:        $('userInput'),
  sendBtn:          $('sendBtn'),
  clearBtn:         $('clearBtn'),
  pinBtn:           $('pinBtn'),
  settingsBtn:      $('settingsBtn'),
  statusDot:        $('statusDot'),
  topbarTitle:      $('topbarTitle'),
  // PIN modal
  pinModal:         $('pinModal'),
  pinInput:         $('pinInput'),
  savePinBtn:       $('savePinBtn'),
  cancelPin:        $('cancelPin'),
  welcomeAuthBtn:   $('welcomeAuthBtn'),
  // Settings modal
  settingsModal:    $('settingsModal'),
  apiKeyInput:      $('apiKeyInput'),
  toggleVis:        $('toggleVis'),
  cancelSettings:   $('cancelSettings'),
  saveSettings:     $('saveSettings'),
  // District display
  districtPinDisplay:  $('districtPinDisplay'),
  districtNameDisplay: $('districtNameDisplay'),
  // Quick topics
  quickTopics:      document.querySelectorAll('.quick-topic'),
};

/* ────────────────────────────────────────────────────────────
   SIDEBAR TOGGLE
──────────────────────────────────────────────────────────── */
const isMobile = () => window.innerWidth <= 768;

dom.menuBtn.addEventListener('click', () => {
  if (isMobile()) {
    dom.sidebar.classList.toggle('open');
    dom.menuBtn.setAttribute('aria-expanded', dom.sidebar.classList.contains('open'));
  } else {
    dom.sidebar.classList.toggle('collapsed');
    dom.main.classList.toggle('full');
  }
});
dom.sidebarClose.addEventListener('click', () => {
  dom.sidebar.classList.remove('open');
  dom.menuBtn.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', e => {
  if (isMobile() && dom.sidebar.classList.contains('open') &&
      !dom.sidebar.contains(e.target) && !dom.menuBtn.contains(e.target)) {
    dom.sidebar.classList.remove('open');
  }
});

/* ────────────────────────────────────────────────────────────
   PIN MODAL
──────────────────────────────────────────────────────────── */
function openPinModal() {
  dom.pinInput.value = state.districtPin;
  dom.pinModal.classList.add('open');
  setTimeout(() => dom.pinInput.focus(), 50);
}
function closePinModal() { dom.pinModal.classList.remove('open'); }

dom.pinBtn.addEventListener('click', openPinModal);
dom.welcomeAuthBtn.addEventListener('click', openPinModal);
dom.cancelPin.addEventListener('click', closePinModal);
dom.pinModal.addEventListener('click', e => { if (e.target === dom.pinModal) closePinModal(); });

dom.savePinBtn.addEventListener('click', () => {
  const pin = dom.pinInput.value.trim();
  if (!pin) { showToast('Please enter a district PIN or name.', 'warn'); return; }
  if (!state.apiKey) {
    closePinModal();
    showToast('Set your Gemini API key first!', 'warn');
    openSettings();
    return;
  }
  state.districtPin = pin;
  localStorage.setItem(PIN_STORAGE, pin);
  closePinModal();
  updateDistrictUI(pin, null);
  sendWeatherQuery(`📍 District PIN: ${pin}\n\nPlease provide the current weather and farmer advisory for this location.`, true);
});

dom.pinInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') dom.savePinBtn.click();
});

/* ────────────────────────────────────────────────────────────
   SETTINGS MODAL
──────────────────────────────────────────────────────────── */
function openSettings() {
  dom.apiKeyInput.value = state.apiKey;
  dom.settingsModal.classList.add('open');
  setTimeout(() => dom.apiKeyInput.focus(), 50);
}
function closeSettings() { dom.settingsModal.classList.remove('open'); }

dom.settingsBtn.addEventListener('click', openSettings);
dom.cancelSettings.addEventListener('click', closeSettings);
dom.settingsModal.addEventListener('click', e => { if (e.target === dom.settingsModal) closeSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePinModal(); closeSettings(); } });

dom.toggleVis.addEventListener('click', () => {
  dom.apiKeyInput.type = dom.apiKeyInput.type === 'password' ? 'text' : 'password';
});
dom.saveSettings.addEventListener('click', () => {
  const key = dom.apiKeyInput.value.trim();
  if (!key) { showToast('Please enter a valid API key.', 'warn'); return; }
  state.apiKey = key;
  localStorage.setItem(API_KEY_STORAGE, key);
  closeSettings();
  removeBanner();
  showToast('API key saved ✓', 'success');
});

/* ────────────────────────────────────────────────────────────
   DISTRICT UI UPDATE
──────────────────────────────────────────────────────────── */
function updateDistrictUI(pin, locationName) {
  dom.districtPinDisplay.textContent = pin || '—';
  dom.districtNameDisplay.textContent = locationName || 'Fetching…';
  dom.statusDot.classList.remove('unauthenticated');
  dom.topbarTitle.textContent = `AgroWeather — ${pin || 'Advisory'}`;
}

/* ────────────────────────────────────────────────────────────
   NO-KEY BANNER
──────────────────────────────────────────────────────────── */
function showBanner() {
  if ($('noKeyBanner')) return;
  const b = document.createElement('div');
  b.className = 'no-key-banner'; b.id = 'noKeyBanner';
  b.innerHTML = `⚠️ <span>No Gemini API key configured. Set one to enable AI weather advisory.</span>
    <button id="bannerBtn">Set Up Key</button>`;
  dom.userInput.parentElement.parentElement.insertBefore(b, dom.userInput.parentElement);
  $('bannerBtn').addEventListener('click', openSettings);
}
function removeBanner() { const b = $('noKeyBanner'); if (b) b.remove(); }

/* ────────────────────────────────────────────────────────────
   QUICK TOPICS
──────────────────────────────────────────────────────────── */
dom.quickTopics.forEach(btn => {
  btn.addEventListener('click', () => {
    if (isMobile()) dom.sidebar.classList.remove('open');
    const q = btn.dataset.q;
    dom.userInput.value = q;
    autoResize();
    handleSend();
  });
});

/* ────────────────────────────────────────────────────────────
   CLEAR CHAT
──────────────────────────────────────────────────────────── */
dom.clearBtn.addEventListener('click', () => {
  state.history = [];
  dom.messages.innerHTML = '';
  dom.welcome.style.display = '';
  showToast('Conversation cleared.', 'info');
});

/* ────────────────────────────────────────────────────────────
   TEXTAREA AUTO-RESIZE
──────────────────────────────────────────────────────────── */
function autoResize() {
  const el = dom.userInput;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
dom.userInput.addEventListener('input', autoResize);
dom.userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
dom.sendBtn.addEventListener('click', handleSend);

/* ────────────────────────────────────────────────────────────
   SEND FLOW
──────────────────────────────────────────────────────────── */
async function handleSend() {
  const text = dom.userInput.value.trim();
  if (!text || state.loading) return;

  if (!state.apiKey) { showBanner(); openSettings(); return; }
  if (!state.districtPin) {
    showToast('Please enter your district PIN first.', 'warn');
    openPinModal();
    return;
  }

  dom.userInput.value = '';
  autoResize();
  await sendWeatherQuery(text, false);
}

async function sendWeatherQuery(text, isInitialPinQuery) {
  dom.welcome.style.display = 'none';
  setLoading(true);

  // Build contextual query with district pin
  const queryWithContext = isInitialPinQuery
    ? text
    : `District PIN / Location: ${state.districtPin}\n\nUser query: ${text}`;

  if (!isInitialPinQuery) {
    appendMessage('user', text);
  } else {
    appendMessage('user', `📍 District PIN: ${state.districtPin}`);
  }

  state.history.push({ role: 'user', parts: [{ text: queryWithContext }] });

  const thinkId = appendThinking();
  try {
    const raw    = await callGemini(state.history);
    removeThinking(thinkId);
    const parsed = parseResponse(raw);
    state.history.push({ role: 'model', parts: [{ text: raw }] });

    // Update district display with resolved location
    if (parsed.location) {
      updateDistrictUI(state.districtPin, parsed.location);
      dom.districtNameDisplay.textContent = parsed.location;
    }

    appendWeatherMsg(parsed);
  } catch (err) {
    removeThinking(thinkId);
    state.history.pop();
    appendErrorMessage(err.message);
  } finally {
    setLoading(false);
  }
}

/* ────────────────────────────────────────────────────────────
   GEMINI API — cascade + retry + backoff
──────────────────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGemini(history) {
  const gap = MIN_REQUEST_GAP - (Date.now() - state.lastCall);
  if (gap > 0) await sleep(gap);

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: history,
    generationConfig: { temperature: 0.4, topP: 0.85, maxOutputTokens: 2048 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  let modelIdx = 0;
  while (modelIdx < GEMINI_MODELS.length) {
    const model = GEMINI_MODELS[modelIdx];
    const url   = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    let lastErr;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        state.lastCall = Date.now();
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.status === 404) { modelIdx++; break; }

        if (res.status === 400 || res.status === 403) {
          const d = await res.json().catch(() => ({}));
          const m = d?.error?.message || `HTTP ${res.status}`;
          if (res.status === 400 && (m.includes('API_KEY') || m.includes('api key')))
            throw new Error('FATAL: Invalid API key. Update in ⚙️ Settings.');
          if (res.status === 403)
            throw new Error('FATAL: API key lacks permission. Check quota at Google AI Studio.');
          throw new Error(`FATAL: ${m}`);
        }

        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
          const backoff = retryAfter > 0
            ? retryAfter * 1000
            : Math.min(4000 * Math.pow(2, attempt - 1), 30000);
          if (attempt < MAX_RETRIES) { await sleep(backoff); continue; }
          throw new Error(`Rate limit hit after ${MAX_RETRIES} retries. Wait ${Math.ceil(backoff/1000)}s and retry.`);
        }

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(`FATAL: HTTP ${res.status} — ${d?.error?.message || 'Unknown error'}`);
        }

        const data      = await res.json();
        const candidate = data?.candidates?.[0];
        if (!candidate) throw new Error('FATAL: No response from Gemini. Please try again.');
        if (candidate.finishReason === 'SAFETY')
          throw new Error('FATAL: Blocked by safety filters. Rephrase your question.');

        return candidate.content.parts.map(p => p.text).join('');

      } catch (err) {
        if (err.message.startsWith('FATAL:'))
          throw new Error(err.message.replace('FATAL: ', ''));
        lastErr = err;
        if (attempt < MAX_RETRIES) await sleep(3000 * attempt);
      }
    }

    if (modelIdx === GEMINI_MODELS.indexOf(model) + 1) continue;
    if (lastErr) throw lastErr;
    break;
  }

  throw new Error('No available Gemini model found for your API key. Please verify at Google AI Studio.');
}

/* ────────────────────────────────────────────────────────────
   PARSE JSON RESPONSE
──────────────────────────────────────────────────────────── */
function parseResponse(raw) {
  let s = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  try { return JSON.parse(s); }
  catch { return { _raw: raw }; }
}

/* ────────────────────────────────────────────────────────────
   RENDER MESSAGES
──────────────────────────────────────────────────────────── */
function appendMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `<div class="avatar" aria-hidden="true">${role === 'user' ? '👤' : '🌦️'}</div>
    <div class="bubble">${escHtml(text)}</div>`;
  dom.messages.appendChild(wrap);
  scrollBottom();
}

function appendWeatherMsg(data) {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';

  if (data._raw) {
    // Fallback: raw text
    wrap.innerHTML = `<div class="avatar" aria-hidden="true">🌦️</div>
      <div class="bubble warning-bubble">⚠️ Unexpected response format. Raw reply:<br><br>${escHtml(data._raw)}</div>`;
    dom.messages.appendChild(wrap);
    scrollBottom();
    return;
  }

  // Build forecast strip
  const forecastHtml = (data.forecast || []).map(f => `
    <div class="forecast-day">
      <span class="forecast-day-name">${escHtml(f.day || '')}</span>
      <span class="forecast-day-icon">${f.icon || '🌤️'}</span>
      <span class="forecast-day-temp">${f.high_c ?? '?'}°</span>
      <span class="forecast-day-rain">${f.rain_pct ?? '?'}%</span>
    </div>
  `).join('');

  // Build advisory list
  const advisoryHtml = (data.farm_advisory || []).map(a =>
    `<li>${escHtml(a)}</li>`
  ).join('');

  // Alert row
  const alertHtml = data.alerts
    ? `<div class="alert-row" role="alert">⚠️ ${escHtml(data.alerts)}</div>`
    : '';

  // WhatsApp reply preview
  const waHtml = data.whatsapp_reply ? `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
      <p class="resp-section-title">📱 WhatsApp Reply Preview</p>
      <div class="wa-msg-in" style="max-width:100%;margin-top:6px;">${escHtml(data.whatsapp_reply)}</div>
    </div>
  ` : '';

  // Data note
  const dataNoteHtml = data.data_note ? `
    <p style="margin-top:10px;font-size:.75rem;color:var(--text-3);line-height:1.5;">
      📊 ${escHtml(data.data_note)}
    </p>
  ` : '';

  wrap.innerHTML = `
    <div class="avatar" aria-hidden="true">🌦️</div>
    <div class="bubble">
      <!-- ── Weather Header ── -->
      <div class="weather-header">
        <span class="weather-icon-big" aria-hidden="true">${data.weather_icon || '🌤️'}</span>
        <div class="weather-headline">
          <div class="weather-district">📍 ${escHtml(data.location || data.district_pin || 'Unknown District')}</div>
          <div class="weather-temp">${data.temperature_c ?? '?'}°C</div>
          <div class="weather-desc">${escHtml(data.condition || '')} · Feels like ${data.feels_like_c ?? '?'}°C</div>
        </div>
      </div>

      <p class="resp-summary">${escHtml(data.summary || '')}</p>

      <!-- ── Stats ── -->
      <div class="weather-stats">
        <div class="stat-card">
          <span class="stat-icon">💧</span>
          <span class="stat-label">Humidity</span>
          <span class="stat-val">${data.humidity_pct ?? '?'}%</span>
        </div>
        <div class="stat-card">
          <span class="stat-icon">🌧️</span>
          <span class="stat-label">Rain</span>
          <span class="stat-val">${data.rainfall_prob_pct ?? '?'}%</span>
        </div>
        <div class="stat-card">
          <span class="stat-icon">💨</span>
          <span class="stat-label">Wind</span>
          <span class="stat-val">${data.wind_kmh ?? '?'} km/h</span>
        </div>
      </div>

      <!-- ── 5-day Forecast ── -->
      <p class="resp-section-title">📅 5-Day Forecast</p>
      <div class="forecast-strip">${forecastHtml}</div>

      ${alertHtml}

      <!-- ── Farmer Advisory ── -->
      <div class="advisory-section">
        <div class="advisory-header">🌿 Farmer Advisory</div>
        <ul class="advisory-list">${advisoryHtml}</ul>
      </div>

      ${waHtml}
      ${dataNoteHtml}
    </div>
  `;

  dom.messages.appendChild(wrap);
  scrollBottom();
}

function appendErrorMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = `<div class="avatar" aria-hidden="true">🌦️</div>
    <div class="bubble error-bubble" role="alert">❌ <strong>Error:</strong> ${escHtml(msg)}</div>`;
  dom.messages.appendChild(wrap);
  scrollBottom();
}

/* ────────────────────────────────────────────────────────────
   THINKING INDICATOR
──────────────────────────────────────────────────────────── */
let thinkCounter = 0;
function appendThinking() {
  const id = `thinking-${++thinkCounter}`;
  const wrap = document.createElement('div');
  wrap.className = 'msg bot'; wrap.id = id;
  wrap.innerHTML = `<div class="avatar" aria-hidden="true">🌦️</div>
    <div class="bubble">
      <div class="thinking-dots"><span></span><span></span><span></span></div>
    </div>`;
  dom.messages.appendChild(wrap);
  scrollBottom();
  return id;
}
function removeThinking(id) {
  const el = $( id);
  if (el) el.remove();
}

/* ────────────────────────────────────────────────────────────
   UTILITIES
──────────────────────────────────────────────────────────── */
function setLoading(val) {
  state.loading = val;
  dom.sendBtn.disabled = val;
  dom.userInput.disabled = val;
}

function scrollBottom() {
  dom.chatArea.scrollTo({ top: dom.chatArea.scrollHeight, behavior: 'smooth' });
}

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg, type = 'info') {
  const existing = $('toast');
  if (existing) existing.remove();

  const colors = {
    success: { bg: 'rgba(56,189,248,0.12)',   border: 'rgba(56,189,248,0.4)',   color: '#38bdf8' },
    warn:    { bg: 'rgba(251,191,36,0.12)',    border: 'rgba(251,191,36,0.4)',   color: '#fbbf24' },
    info:    { bg: 'rgba(74,222,128,0.12)',    border: 'rgba(74,222,128,0.4)',   color: '#4ade80' },
    error:   { bg: 'rgba(248,113,113,0.12)',   border: 'rgba(248,113,113,0.4)', color: '#f87171' },
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.style.cssText = `
    position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
    background:${c.bg};border:1px solid ${c.border};color:${c.color};
    padding:10px 20px;border-radius:100px;font-size:0.82rem;font-weight:600;
    z-index:200;backdrop-filter:blur(10px);
    animation:fadeInUp 0.3s ease both;white-space:nowrap;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ────────────────────────────────────────────────────────────
   INIT
──────────────────────────────────────────────────────────── */
function init() {
  // Restore state indicators
  if (state.districtPin) {
    updateDistrictUI(state.districtPin, null);
    dom.districtNameDisplay.textContent = 'Stored';
  } else {
    dom.statusDot.classList.add('unauthenticated');
  }

  // First-run: prompt for API key
  if (!state.apiKey) {
    setTimeout(openSettings, 700);
  } else if (!state.districtPin) {
    setTimeout(openPinModal, 400);
  }

  dom.userInput.focus();
}

init();
