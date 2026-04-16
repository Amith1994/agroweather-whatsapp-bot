// =============================================================
// AGROWEATHER WHATSAPP BOT — Express Backend
// Twilio Webhooks + OpenWeatherMap + Gemini AI Advisory
// =============================================================
// Architecture:
//   WhatsApp User → Twilio → POST /webhook → Express → (PIN Auth + OWM API + Gemini AI) → TwiML Response
//
// Quick Start:
//   1. npm install
//   2. Copy .env.example to .env and fill in your keys
//   3. node server.js
//   4. Use ngrok to expose: ngrok http 3000
//   5. Set Twilio Sandbox webhook URL to: https://<ngrok-id>.ngrok.io/webhook
// =============================================================

'use strict';

require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const axios      = require('axios');
const twilio     = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ────────────────────────────────────────────────────────────
   ENVIRONMENT VALIDATION
──────────────────────────────────────────────────────────── */
const REQUIRED_ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'GEMINI_API_KEY'];
const OPTIONAL_ENV = ['OPENWEATHER_API_KEY'];   // Optional: Gemini uses search grounding as fallback

const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[STARTUP] Missing required env vars: ${missingEnv.join(', ')}`);
  console.error('[STARTUP] Copy .env.example → .env and fill in your keys.');
  process.exit(1);
}

if (!process.env.OPENWEATHER_API_KEY) {
  console.warn('[STARTUP] OPENWEATHER_API_KEY not set — using Gemini AI for weather data (less precise).');
}

/* ────────────────────────────────────────────────────────────
   DISTRICT PIN → LOCATION MAP
   All 30 Karnataka districts + major cities in other states.
   Multiple pincodes per district are mapped to the same district.
   Format: PIN_CODE → { city, district, lat, lon, state }
──────────────────────────────────────────────────────────── */
const DISTRICT_MAP = {
  // ── Karnataka — Bagalkot ─────────────────────────────────
  '587101': { city: 'Bagalkot', district: 'Bagalkot', state: 'Karnataka', lat: 16.1851, lon: 75.6960 },
  '587102': { city: 'Bagalkot', district: 'Bagalkot', state: 'Karnataka', lat: 16.1851, lon: 75.6960 },
  '587103': { city: 'Bagalkot', district: 'Bagalkot', state: 'Karnataka', lat: 16.1851, lon: 75.6960 },
  // ── Karnataka — Ballari ──────────────────────────────────
  '583101': { city: 'Ballari',  district: 'Ballari',  state: 'Karnataka', lat: 15.1394, lon: 76.9214 },
  '583102': { city: 'Ballari',  district: 'Ballari',  state: 'Karnataka', lat: 15.1394, lon: 76.9214 },
  '583103': { city: 'Ballari',  district: 'Ballari',  state: 'Karnataka', lat: 15.1394, lon: 76.9214 },
  // ── Karnataka — Belagavi ─────────────────────────────────
  '590001': { city: 'Belagavi', district: 'Belagavi', state: 'Karnataka', lat: 15.8497, lon: 74.4977 },
  '590002': { city: 'Belagavi', district: 'Belagavi', state: 'Karnataka', lat: 15.8497, lon: 74.4977 },
  '590003': { city: 'Belagavi', district: 'Belagavi', state: 'Karnataka', lat: 15.8497, lon: 74.4977 },
  // ── Karnataka — Bengaluru Urban ──────────────────────────
  '560001': { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  '560002': { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  '560003': { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  '560004': { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  // ── Karnataka — Bengaluru Rural ──────────────────────────
  '562110': { city: 'Bengaluru Rural', district: 'Bengaluru Rural', state: 'Karnataka', lat: 13.1986, lon: 77.7066 },
  '562111': { city: 'Bengaluru Rural', district: 'Bengaluru Rural', state: 'Karnataka', lat: 13.1986, lon: 77.7066 },
  '562112': { city: 'Bengaluru Rural', district: 'Bengaluru Rural', state: 'Karnataka', lat: 13.1986, lon: 77.7066 },
  // ── Karnataka — Bidar ────────────────────────────────────
  '585401': { city: 'Bidar',    district: 'Bidar',    state: 'Karnataka', lat: 17.9104, lon: 77.5199 },
  '585402': { city: 'Bidar',    district: 'Bidar',    state: 'Karnataka', lat: 17.9104, lon: 77.5199 },
  '585403': { city: 'Bidar',    district: 'Bidar',    state: 'Karnataka', lat: 17.9104, lon: 77.5199 },
  // ── Karnataka — Chamarajanagar ───────────────────────────
  '571313': { city: 'Chamarajanagar', district: 'Chamarajanagar', state: 'Karnataka', lat: 11.9241, lon: 76.9437 },
  '571314': { city: 'Chamarajanagar', district: 'Chamarajanagar', state: 'Karnataka', lat: 11.9241, lon: 76.9437 },
  '571315': { city: 'Chamarajanagar', district: 'Chamarajanagar', state: 'Karnataka', lat: 11.9241, lon: 76.9437 },
  // ── Karnataka — Chikkaballapura ──────────────────────────
  '562101': { city: 'Chikkaballapura', district: 'Chikkaballapura', state: 'Karnataka', lat: 13.4355, lon: 77.7270 },
  '562102': { city: 'Chikkaballapura', district: 'Chikkaballapura', state: 'Karnataka', lat: 13.4355, lon: 77.7270 },
  '562103': { city: 'Chikkaballapura', district: 'Chikkaballapura', state: 'Karnataka', lat: 13.4355, lon: 77.7270 },
  // ── Karnataka — Chikkamagaluru ───────────────────────────
  '577101': { city: 'Chikkamagaluru', district: 'Chikkamagaluru', state: 'Karnataka', lat: 13.3153, lon: 75.7754 },
  '577102': { city: 'Chikkamagaluru', district: 'Chikkamagaluru', state: 'Karnataka', lat: 13.3153, lon: 75.7754 },
  '577103': { city: 'Chikkamagaluru', district: 'Chikkamagaluru', state: 'Karnataka', lat: 13.3153, lon: 75.7754 },
  // ── Karnataka — Chitradurga ──────────────────────────────
  '577501': { city: 'Chitradurga', district: 'Chitradurga', state: 'Karnataka', lat: 14.2251, lon: 76.3980 },
  '577502': { city: 'Chitradurga', district: 'Chitradurga', state: 'Karnataka', lat: 14.2251, lon: 76.3980 },
  '577503': { city: 'Chitradurga', district: 'Chitradurga', state: 'Karnataka', lat: 14.2251, lon: 76.3980 },
  // ── Karnataka — Dakshina Kannada ─────────────────────────
  '575001': { city: 'Mangaluru', district: 'Dakshina Kannada', state: 'Karnataka', lat: 12.9141, lon: 74.8560 },
  '575002': { city: 'Mangaluru', district: 'Dakshina Kannada', state: 'Karnataka', lat: 12.9141, lon: 74.8560 },
  '575003': { city: 'Mangaluru', district: 'Dakshina Kannada', state: 'Karnataka', lat: 12.9141, lon: 74.8560 },
  // ── Karnataka — Davangere ────────────────────────────────
  '577001': { city: 'Davangere', district: 'Davangere', state: 'Karnataka', lat: 14.4644, lon: 75.9218 },
  '577002': { city: 'Davangere', district: 'Davangere', state: 'Karnataka', lat: 14.4644, lon: 75.9218 },
  '577003': { city: 'Davangere', district: 'Davangere', state: 'Karnataka', lat: 14.4644, lon: 75.9218 },
  // ── Karnataka — Dharwad ──────────────────────────────────
  '580001': { city: 'Dharwad',  district: 'Dharwad',  state: 'Karnataka', lat: 15.4589, lon: 75.0078 },
  '580002': { city: 'Dharwad',  district: 'Dharwad',  state: 'Karnataka', lat: 15.4589, lon: 75.0078 },
  '580003': { city: 'Dharwad',  district: 'Dharwad',  state: 'Karnataka', lat: 15.4589, lon: 75.0078 },
  // ── Karnataka — Gadag ────────────────────────────────────
  '582101': { city: 'Gadag',    district: 'Gadag',    state: 'Karnataka', lat: 15.4316, lon: 75.6214 },
  '582102': { city: 'Gadag',    district: 'Gadag',    state: 'Karnataka', lat: 15.4316, lon: 75.6214 },
  '582103': { city: 'Gadag',    district: 'Gadag',    state: 'Karnataka', lat: 15.4316, lon: 75.6214 },
  // ── Karnataka — Hassan ───────────────────────────────────
  '573201': { city: 'Hassan',   district: 'Hassan',   state: 'Karnataka', lat: 13.0033, lon: 76.1004 },
  '573202': { city: 'Hassan',   district: 'Hassan',   state: 'Karnataka', lat: 13.0033, lon: 76.1004 },
  '573203': { city: 'Hassan',   district: 'Hassan',   state: 'Karnataka', lat: 13.0033, lon: 76.1004 },
  // ── Karnataka — Haveri ───────────────────────────────────
  '581110': { city: 'Haveri',   district: 'Haveri',   state: 'Karnataka', lat: 14.7944, lon: 75.3988 },
  '581111': { city: 'Haveri',   district: 'Haveri',   state: 'Karnataka', lat: 14.7944, lon: 75.3988 },
  '581112': { city: 'Haveri',   district: 'Haveri',   state: 'Karnataka', lat: 14.7944, lon: 75.3988 },
  // ── Karnataka — Kalaburagi (Gulbarga) ────────────────────
  '585101': { city: 'Kalaburagi', district: 'Kalaburagi', state: 'Karnataka', lat: 17.3297, lon: 76.8200 },
  '585102': { city: 'Kalaburagi', district: 'Kalaburagi', state: 'Karnataka', lat: 17.3297, lon: 76.8200 },
  '585103': { city: 'Kalaburagi', district: 'Kalaburagi', state: 'Karnataka', lat: 17.3297, lon: 76.8200 },
  // ── Karnataka — Kodagu ───────────────────────────────────
  '571201': { city: 'Madikeri', district: 'Kodagu',   state: 'Karnataka', lat: 12.4210, lon: 75.7382 },
  '571202': { city: 'Madikeri', district: 'Kodagu',   state: 'Karnataka', lat: 12.4210, lon: 75.7382 },
  '571203': { city: 'Madikeri', district: 'Kodagu',   state: 'Karnataka', lat: 12.4210, lon: 75.7382 },
  // ── Karnataka — Kolar ────────────────────────────────────
  '563101': { city: 'Kolar',    district: 'Kolar',    state: 'Karnataka', lat: 13.1357, lon: 78.1294 },
  '563102': { city: 'Kolar',    district: 'Kolar',    state: 'Karnataka', lat: 13.1357, lon: 78.1294 },
  '563103': { city: 'Kolar',    district: 'Kolar',    state: 'Karnataka', lat: 13.1357, lon: 78.1294 },
  // ── Karnataka — Koppal ───────────────────────────────────
  '583231': { city: 'Koppal',   district: 'Koppal',   state: 'Karnataka', lat: 15.3508, lon: 76.1538 },
  '583232': { city: 'Koppal',   district: 'Koppal',   state: 'Karnataka', lat: 15.3508, lon: 76.1538 },
  '583233': { city: 'Koppal',   district: 'Koppal',   state: 'Karnataka', lat: 15.3508, lon: 76.1538 },
  // ── Karnataka — Mandya ───────────────────────────────────
  '571401': { city: 'Mandya',   district: 'Mandya',   state: 'Karnataka', lat: 12.5218, lon: 76.8950 },
  '571402': { city: 'Mandya',   district: 'Mandya',   state: 'Karnataka', lat: 12.5218, lon: 76.8950 },
  '571403': { city: 'Mandya',   district: 'Mandya',   state: 'Karnataka', lat: 12.5218, lon: 76.8950 },
  // ── Karnataka — Mysuru ───────────────────────────────────
  '570001': { city: 'Mysuru',   district: 'Mysuru',   state: 'Karnataka', lat: 12.2958, lon: 76.6394 },
  '570002': { city: 'Mysuru',   district: 'Mysuru',   state: 'Karnataka', lat: 12.2958, lon: 76.6394 },
  '570003': { city: 'Mysuru',   district: 'Mysuru',   state: 'Karnataka', lat: 12.2958, lon: 76.6394 },
  // ── Karnataka — Raichur ──────────────────────────────────
  '584101': { city: 'Raichur',  district: 'Raichur',  state: 'Karnataka', lat: 16.2120, lon: 77.3566 },
  '584102': { city: 'Raichur',  district: 'Raichur',  state: 'Karnataka', lat: 16.2120, lon: 77.3566 },
  '584103': { city: 'Raichur',  district: 'Raichur',  state: 'Karnataka', lat: 16.2120, lon: 77.3566 },
  // ── Karnataka — Ramanagara ───────────────────────────────
  '562159': { city: 'Ramanagara', district: 'Ramanagara', state: 'Karnataka', lat: 12.7157, lon: 77.2804 },
  '562160': { city: 'Ramanagara', district: 'Ramanagara', state: 'Karnataka', lat: 12.7157, lon: 77.2804 },
  '562161': { city: 'Ramanagara', district: 'Ramanagara', state: 'Karnataka', lat: 12.7157, lon: 77.2804 },
  // ── Karnataka — Shivamogga ───────────────────────────────
  '577201': { city: 'Shivamogga', district: 'Shivamogga', state: 'Karnataka', lat: 13.9299, lon: 75.5681 },
  '577202': { city: 'Shivamogga', district: 'Shivamogga', state: 'Karnataka', lat: 13.9299, lon: 75.5681 },
  '577203': { city: 'Shivamogga', district: 'Shivamogga', state: 'Karnataka', lat: 13.9299, lon: 75.5681 },
  // ── Karnataka — Tumakuru ─────────────────────────────────
  '572101': { city: 'Tumakuru', district: 'Tumakuru', state: 'Karnataka', lat: 13.3409, lon: 77.1010 },
  '572102': { city: 'Tumakuru', district: 'Tumakuru', state: 'Karnataka', lat: 13.3409, lon: 77.1010 },
  '572103': { city: 'Tumakuru', district: 'Tumakuru', state: 'Karnataka', lat: 13.3409, lon: 77.1010 },
  // ── Karnataka — Udupi ────────────────────────────────────
  '576101': { city: 'Udupi',    district: 'Udupi',    state: 'Karnataka', lat: 13.3409, lon: 74.7421 },
  '576102': { city: 'Udupi',    district: 'Udupi',    state: 'Karnataka', lat: 13.3409, lon: 74.7421 },
  '576103': { city: 'Udupi',    district: 'Udupi',    state: 'Karnataka', lat: 13.3409, lon: 74.7421 },
  // ── Karnataka — Uttara Kannada ───────────────────────────
  '581301': { city: 'Karwar',   district: 'Uttara Kannada', state: 'Karnataka', lat: 14.8004, lon: 74.1288 },
  '581302': { city: 'Karwar',   district: 'Uttara Kannada', state: 'Karnataka', lat: 14.8004, lon: 74.1288 },
  '581303': { city: 'Karwar',   district: 'Uttara Kannada', state: 'Karnataka', lat: 14.8004, lon: 74.1288 },
  // ── Karnataka — Vijayapura (Bijapur) ─────────────────────
  '586101': { city: 'Vijayapura', district: 'Vijayapura', state: 'Karnataka', lat: 16.8302, lon: 75.7100 },
  '586102': { city: 'Vijayapura', district: 'Vijayapura', state: 'Karnataka', lat: 16.8302, lon: 75.7100 },
  '586103': { city: 'Vijayapura', district: 'Vijayapura', state: 'Karnataka', lat: 16.8302, lon: 75.7100 },
  // ── Karnataka — Yadgir ───────────────────────────────────
  '585201': { city: 'Yadgir',   district: 'Yadgir',   state: 'Karnataka', lat: 16.7700, lon: 77.1400 },
  '585202': { city: 'Yadgir',   district: 'Yadgir',   state: 'Karnataka', lat: 16.7700, lon: 77.1400 },
  '585203': { city: 'Yadgir',   district: 'Yadgir',   state: 'Karnataka', lat: 16.7700, lon: 77.1400 },
  // ── Maharashtra ──────────────────────────────────────────
  '422001': { city: 'Nashik',    district: 'Nashik',    state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },
  '411001': { city: 'Pune',      district: 'Pune',      state: 'Maharashtra', lat: 18.5204, lon: 73.8567 },
  '444601': { city: 'Amravati', district: 'Amravati', state: 'Maharashtra', lat: 20.9320, lon: 77.7523 },
  // ── Andhra Pradesh ───────────────────────────────────────
  '520001': { city: 'Vijayawada', district: 'Krishna',  state: 'Andhra Pradesh', lat: 16.5062, lon: 80.6480 },
  '530001': { city: 'Visakhapatnam', district: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lon: 83.2185 },
  // ── Tamil Nadu ───────────────────────────────────────────
  '600001': { city: 'Chennai',  district: 'Chennai',  state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
  '625001': { city: 'Madurai',  district: 'Madurai',  state: 'Tamil Nadu', lat: 9.9252,  lon: 78.1198 },
  // ── Telangana ────────────────────────────────────────────
  '500001': { city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', lat: 17.3850, lon: 78.4867 },
};

// Alias map for name-based PINs (maps to primary pincode of district)
const NAME_ALIASES = {
  // Bengaluru
  'bengaluru': '560001', 'bangalore': '560001', 'bengalooru': '560001',
  // Bengaluru Rural
  'bengaluru rural': '562110', 'bangalore rural': '562110',
  // Bagalkot
  'bagalkot': '587101', 'bagalkote': '587101',
  // Ballari
  'ballari': '583101', 'bellary': '583101',
  // Belagavi
  'belagavi': '590001', 'belgaum': '590001',
  // Bidar
  'bidar': '585401',
  // Chamarajanagar
  'chamarajanagar': '571313', 'chamarajanagara': '571313',
  // Chikkaballapura
  'chikkaballapura': '562101', 'chikballapur': '562101',
  // Chikkamagaluru
  'chikkamagaluru': '577101', 'chikmagalur': '577101', 'chickmagalur': '577101',
  // Chitradurga
  'chitradurga': '577501', 'chitradurg': '577501',
  // Dakshina Kannada
  'dakshina kannada': '575001', 'mangaluru': '575001', 'mangalore': '575001', 'dk': '575001',
  // Davangere
  'davangere': '577001', 'davanagere': '577001', 'davangiri': '577001',
  // Dharwad
  'dharwad': '580001', 'dharwaad': '580001', 'ka-dwd': '580001',
  // Gadag
  'gadag': '582101', 'gadag-betgeri': '582101',
  // Hassan
  'hassan': '573201',
  // Haveri
  'haveri': '581110',
  // Kalaburagi
  'kalaburagi': '585101', 'gulbarga': '585101', 'ka-grg': '585101',
  // Kodagu
  'kodagu': '571201', 'coorg': '571201', 'madikeri': '571201',
  // Kolar
  'kolar': '563101',
  // Koppal
  'koppal': '583231',
  // Mandya
  'mandya': '571401',
  // Mysuru
  'mysuru': '570001', 'mysore': '570001',
  // Raichur
  'raichur': '584101',
  // Ramanagara
  'ramanagara': '562159', 'ramanagar': '562159',
  // Shivamogga
  'shivamogga': '577201', 'shimoga': '577201',
  // Tumakuru
  'tumakuru': '572101', 'tumkur': '572101',
  // Udupi
  'udupi': '576101', 'udipi': '576101',
  // Uttara Kannada
  'uttara kannada': '581301', 'north kanara': '581301', 'karwar': '581301', 'uk': '581301',
  // Vijayapura
  'vijayapura': '586101', 'bijapur': '586101',
  // Yadgir
  'yadgir': '585201', 'yadagiri': '585201',
  // Other states
  'nashik': '422001', 'nasik': '422001',
  'pune': '411001',   'poona': '411001',
  'amravati': '444601',
  'vijayawada': '520001',
  'visakhapatnam': '530001', 'vizag': '530001',
  'hyderabad': '500001',   'hyd': '500001',
  'chennai': '600001',     'madras': '600001',
  'madurai': '625001',
};

/* ────────────────────────────────────────────────────────────
   IN-MEMORY SESSION STORE
   Maps WhatsApp number → { pin, district, lastActive, requestCount }
   IMPORTANT: Replace with Redis or a database for production
──────────────────────────────────────────────────────────── */
const sessions = new Map();

const SESSION_TTL_MS    = 24 * 60 * 60 * 1000;  // 24 hours
const RATE_LIMIT_COUNT  = 10;                    // max requests per session per window
const RATE_WINDOW_MS    = 60 * 60 * 1000;        // 1-hour window

/* ────────────────────────────────────────────────────────────
   MIDDLEWARE
──────────────────────────────────────────────────────────── */
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Global rate limiter (per IP — Twilio posts from their IPs)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

/* ────────────────────────────────────────────────────────────
   TWILIO SIGNATURE VALIDATION (optional but recommended)
──────────────────────────────────────────────────────────── */
function validateTwilioSignature(req, res, next) {
  // Disable validation in development
  if (process.env.NODE_ENV !== 'production') return next();

  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const signature  = req.headers['x-twilio-signature'];
  const url        = `${process.env.BASE_URL || `https://${req.hostname}`}${req.originalUrl}`;

  const valid = twilio.validateRequest(authToken, signature, url, req.body);
  if (!valid) {
    console.warn('[SECURITY] Invalid Twilio signature — rejecting request');
    return res.status(403).send('Forbidden');
  }
  next();
}

/* ────────────────────────────────────────────────────────────
   PIN VALIDATION & SESSION MANAGEMENT
──────────────────────────────────────────────────────────── */
function validateAndResolvePin(rawPin) {
  const normalized = rawPin.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  // Check direct numeric PIN
  if (DISTRICT_MAP[rawPin.trim()]) {
    return { valid: true, pin: rawPin.trim(), district: DISTRICT_MAP[rawPin.trim()] };
  }

  // Check alias
  const resolvedPin = NAME_ALIASES[normalized];
  if (resolvedPin && DISTRICT_MAP[resolvedPin]) {
    return { valid: true, pin: resolvedPin, district: DISTRICT_MAP[resolvedPin] };
  }

  // Partial name match
  for (const [alias, pin] of Object.entries(NAME_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      if (DISTRICT_MAP[pin]) {
        return { valid: true, pin, district: DISTRICT_MAP[pin] };
      }
    }
  }

  return { valid: false, pin: null, district: null };
}

function getSession(waNumber) {
  const now = Date.now();
  let sess = sessions.get(waNumber);

  if (sess && now - sess.lastActive > SESSION_TTL_MS) {
    sessions.delete(waNumber);
    sess = null;
  }

  if (!sess) {
    sess = { pin: null, district: null, lastActive: now, requestCount: 0, windowStart: now };
    sessions.set(waNumber, sess);
  }

  sess.lastActive = now;
  return sess;
}

function checkSessionRateLimit(sess) {
  const now = Date.now();
  if (now - sess.windowStart > RATE_WINDOW_MS) {
    sess.requestCount = 0;
    sess.windowStart  = now;
  }
  sess.requestCount++;
  return sess.requestCount <= RATE_LIMIT_COUNT;
}

/* ────────────────────────────────────────────────────────────
   WEATHER DATA FETCH — IMD Mausamgram (Primary)
   Endpoint: https://mausamgram.imd.gov.in/
   The site uses an internal endpoint that accepts lat/lon.
   We try both known endpoint patterns and fall back to OWM.
──────────────────────────────────────────────────────────── */
async function fetchWeatherIMD(district) {
  try {
    // IMD Mausamgram uses a WMS/point-forecast endpoint internally.
    // Known candidate URLs based on IMD's internal service discovery:
    const candidates = [
      `https://mausamgram.imd.gov.in/getPointForecast?lat=${district.lat}&lng=${district.lon}`,
      `https://mausamgram.imd.gov.in/forecast?lat=${district.lat}&lon=${district.lon}`,
      `https://mausamgram.imd.gov.in/api/v1/point?lat=${district.lat}&lon=${district.lon}`,
    ];

    for (const url of candidates) {
      try {
        const res = await axios.get(url, {
          timeout: 6000,
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://mausamgram.imd.gov.in/',
            'Origin': 'https://mausamgram.imd.gov.in',
          },
        });
        if (res.status === 200 && res.data) {
          const d = res.data;
          // Normalize IMD response to our internal format
          // (field names vary by IMD endpoint version)
          const temp    = d.temp ?? d.temperature ?? d.t2m ?? null;
          const rh      = d.rh ?? d.humidity ?? d.relative_humidity ?? null;
          const wind    = d.wind_speed ?? d.ws ?? d.windspeed ?? null;
          const rain    = d.rainfall ?? d.rf ?? d.rain ?? null;
          const cond    = d.weather_condition ?? d.condition ?? d.wx ?? 'N/A';
          if (temp !== null) {
            console.log(`[IMD] Fetched weather for ${district.city} from ${url}`);
            return {
              temperature_c:     Math.round(Number(temp)),
              feels_like_c:      Math.round(Number(temp) + (rh ? (Number(rh) - 40) * 0.1 : 0)),
              humidity_pct:      rh   !== null ? Math.round(Number(rh))   : null,
              wind_kmh:          wind !== null ? Math.round(Number(wind) * 3.6) : null,
              condition:         String(cond),
              rainfall_prob_pct: rain !== null ? Math.min(Math.round(Number(rain) * 10), 100) : null,
              forecast:          [],   // IMD endpoint doesn't return 5-day in this call
              source:            'IMD Mausamgram',
              fetched_at:        new Date().toISOString(),
            };
          }
        }
      } catch (_) { /* try next candidate */ }
    }
  } catch (err) {
    console.warn(`[IMD] All Mausamgram endpoints failed for ${district.city}:`, err.message);
  }
  return null;  // Signal: fall back to OWM
}

/* ────────────────────────────────────────────────────────────
   WEATHER DATA FETCH — OpenWeatherMap (Fallback)
──────────────────────────────────────────────────────────── */
async function fetchWeatherOWM(district) {
  if (!process.env.OPENWEATHER_API_KEY) return null;

  try {
    const [currentRes, forecastRes] = await Promise.all([
      axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: {
          lat:   district.lat,
          lon:   district.lon,
          appid: process.env.OPENWEATHER_API_KEY,
          units: 'metric',
        },
        timeout: 5000,
      }),
      axios.get('https://api.openweathermap.org/data/2.5/forecast', {
        params: {
          lat:   district.lat,
          lon:   district.lon,
          appid: process.env.OPENWEATHER_API_KEY,
          units: 'metric',
          cnt:   40,  // ~5 days
        },
        timeout: 5000,
      }),
    ]);

    const current  = currentRes.data;
    const forecast = forecastRes.data;

    // Aggregate daily forecast
    const dailyMap = {};
    for (const item of forecast.list) {
      const date = new Date(item.dt * 1000);
      const key  = date.toLocaleDateString('en-IN', { weekday: 'short' });
      if (!dailyMap[key]) {
        dailyMap[key] = { temps: [], rains: [], icons: [], conditions: [] };
      }
      dailyMap[key].temps.push(item.main.temp);
      dailyMap[key].rains.push((item.pop || 0) * 100);
      dailyMap[key].icons.push(item.weather[0]?.main || '');
      dailyMap[key].conditions.push(item.weather[0]?.description || '');
    }

    const days = Object.entries(dailyMap).slice(0, 5).map(([day, d]) => ({
      day,
      high_c:   Math.round(Math.max(...d.temps)),
      low_c:    Math.round(Math.min(...d.temps)),
      rain_pct: Math.round(Math.max(...d.rains)),
      condition: d.conditions[0] || 'N/A',
    }));

    return {
      temperature_c:     Math.round(current.main.temp),
      feels_like_c:      Math.round(current.main.feels_like),
      humidity_pct:      current.main.humidity,
      wind_kmh:          Math.round(current.wind.speed * 3.6),
      condition:         current.weather[0]?.description || 'N/A',
      rainfall_prob_pct: Math.round((forecast.list[0]?.pop || 0) * 100),
      forecast:          days,
      fetched_at:        new Date().toISOString(),
    };
  } catch (err) {
    console.error('[OWM] Weather fetch failed:', err.message);
    return null;
  }
}

/* ────────────────────────────────────────────────────────────
   WEATHER FETCH ORCHESTRATOR
   Priority: IMD Mausamgram → OpenWeatherMap → Gemini AI only
──────────────────────────────────────────────────────────── */
async function fetchWeather(district) {
  // 1. Try IMD Mausamgram first (official Indian Met data)
  const imdData = await fetchWeatherIMD(district);
  if (imdData) return imdData;

  // 2. Fall back to OpenWeatherMap
  const owmData = await fetchWeatherOWM(district);
  if (owmData) return { ...owmData, source: 'OpenWeatherMap' };

  // 3. No live data — Gemini will use training knowledge
  console.warn(`[WEATHER] No live data for ${district.city} — Gemini will use training knowledge.`);
  return null;
}

/* ────────────────────────────────────────────────────────────
   GEMINI AI — Advisory Generation
──────────────────────────────────────────────────────────── */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateAdvisory({ district, weatherData, userMessage }) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const weatherContext = weatherData
    ? `LIVE WEATHER DATA (Source: ${weatherData.source || 'OpenWeatherMap'}):
- Temperature: ${weatherData.temperature_c}°C (feels like ${weatherData.feels_like_c ?? weatherData.temperature_c}°C)
- Condition: ${weatherData.condition}
- Humidity: ${weatherData.humidity_pct ?? 'N/A'}%
- Wind: ${weatherData.wind_kmh ?? 'N/A'} km/h
- Rain probability: ${weatherData.rainfall_prob_pct ?? 'N/A'}%
- Fetched at: ${weatherData.fetched_at}`
    : 'WEATHER DATA: Not available — use training knowledge for typical seasonal conditions.';

  const prompt = `
You are AgroWeatherBot, a WhatsApp-based weather advisory service for Indian farmers.
Respond like a short WhatsApp message — informal, friendly, 3-5 sentences, with emojis.

District: ${district.city}, ${district.state}
Coordinates: ${district.lat}, ${district.lon}
${weatherContext}

User's message: "${userMessage}"

Instructions:
- If this is a first-time greeting with a PIN, provide today's weather summary + top 2 farm tips.
- If it's a specific question, answer it with the weather context.
- End with a quick 1-line farm action they should take TODAY.
- Keep it under 300 characters if possible. Be direct.
- Use ° for degrees, % for rain chance.
- DO NOT say "I am an AI" or any disclaimers.

Reply (WhatsApp message only, no JSON):
`.trim();

  const result   = await model.generateContent(prompt);
  const response = await result.response;
  return response.text().trim();
}

/* ────────────────────────────────────────────────────────────
   TWILIO TWIML HELPER
──────────────────────────────────────────────────────────── */
function twimlReply(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.type('text/xml');
  res.send(twiml.toString());
}

/* ────────────────────────────────────────────────────────────
   WHATSAPP WEBHOOK HANDLER
   POST /webhook
──────────────────────────────────────────────────────────── */
app.post('/webhook', validateTwilioSignature, async (req, res) => {
  const waNumber = req.body.From;   // e.g. "whatsapp:+919XXXXXXXXX"
  const body     = (req.body.Body || '').trim();

  console.log(`[WEBHOOK] From=${waNumber} Body="${body}"`);

  if (!waNumber || !body) {
    return twimlReply(res, '❓ Could not process your message. Please try again.');
  }

  // ── Session management ──────────────────────────────────
  const sess = getSession(waNumber);

  // ── Rate limit ──────────────────────────────────────────
  if (!checkSessionRateLimit(sess)) {
    return twimlReply(res,
      `⏳ You've sent too many requests. Please wait a few minutes before trying again. 🙏`
    );
  }

  // ── Parse intent ────────────────────────────────────────
  const lowerBody = body.toLowerCase();
  const isHello   = /^(hi|hello|start|hey|namaste|namaskar|jai|help|begin)/.test(lowerBody);
  const isReset   = /^(reset|logout|change pin|new pin|switch district)/.test(lowerBody);

  // Handle reset
  if (isReset) {
    sess.pin      = null;
    sess.district = null;
    return twimlReply(res,
      `🔄 Session cleared! Please send your district PIN code or name to start again.\n` +
      `Example: "580001" for Dharwad or just "Dharwad" 📍`
    );
  }

  // ── PIN authentication flow ──────────────────────────────
  if (!sess.pin) {
    // First message — try to interpret as a PIN
    const pinResult = validateAndResolvePin(body);

    if (!pinResult.valid) {
      // Not a recognized PIN and not a greeting
      if (isHello) {
        return twimlReply(res,
          `👋 Welcome to *AgroWeather Bot*! 🌦️\n\n` +
          `To get started, send your *district PIN code* or name.\n` +
          `Example: "580001" or "Dharwad"\n\n` +
          `I'll give you real-time weather + farming advice for your district! 🌱`
        );
      }

      return twimlReply(res,
        `🔐 *Authentication Required*\n\n` +
        `Please send your district PIN code or district name first.\n` +
        `Example: "580001" for Dharwad, or just type "Dharwad" 📍\n\n` +
        `Type "help" for more options.`
      );
    }

    // Valid PIN — authenticate session
    sess.pin      = pinResult.pin;
    sess.district = pinResult.district;

    console.log(`[AUTH] ${waNumber} authenticated → PIN=${sess.pin}, District=${sess.district.city}`);

    // Fetch weather and generate first advisory
    const weatherData = await fetchWeather(sess.district);
    const userMsg     = `Hello! I just authenticated with district PIN ${sess.pin} (${sess.district.city}). Give me today's weather and farming advice.`;

    try {
      const advisory = await generateAdvisory({
        district:    sess.district,
        weatherData,
        userMessage: userMsg,
      });

      return twimlReply(res,
        `✅ *Authenticated: ${sess.district.city}, ${sess.district.state}*\n\n` +
        `${advisory}\n\n` +
        `_Type any farming question! Reply "reset" to change district._`
      );
    } catch (err) {
      console.error('[GEMINI] Advisory generation failed:', err.message);
      return twimlReply(res,
        `✅ Authenticated as *${sess.district.city}, ${sess.district.state}*\n` +
        `⚠️ Couldn't fetch full advisory right now. Please try again in a moment.`
      );
    }
  }

  // ── Authenticated — handle advisory query ─────────────────
  console.log(`[QUERY] ${waNumber} (${sess.district.city}) → "${body}"`);

  try {
    const weatherData = await fetchWeather(sess.district);
    const advisory    = await generateAdvisory({
      district:    sess.district,
      weatherData,
      userMessage: body,
    });

    return twimlReply(res, advisory);
  } catch (err) {
    console.error('[HANDLER] Error generating response:', err.message);
    return twimlReply(res,
      `❌ Sorry, I couldn't process your request right now.\n` +
      `Please try again in a moment. If the problem persists, type "reset" to restart.`
    );
  }
});

/* ────────────────────────────────────────────────────────────
   REST API ENDPOINTS (for frontend dashboard)
──────────────────────────────────────────────────────────── */

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AgroWeather WhatsApp Bot',
    timestamp: new Date().toISOString(),
    sessions: sessions.size,
    districts_loaded: Object.keys(DISTRICT_MAP).length,
    imd_mausamgram: 'enabled (with OWM fallback)',
    owm_enabled: !!process.env.OPENWEATHER_API_KEY,
  });
});

// Districts list endpoint (for frontend)
app.get('/api/districts', (req, res) => {
  const unique = {};
  for (const [pin, d] of Object.entries(DISTRICT_MAP)) {
    const key = `${d.district}-${d.state}`;
    if (!unique[key]) {
      unique[key] = { primaryPin: pin, city: d.city, district: d.district, state: d.state, lat: d.lat, lon: d.lon };
    }
  }
  res.json({ total_pincodes: Object.keys(DISTRICT_MAP).length, districts: Object.values(unique) });
});

// PIN lookup (for frontend)
app.get('/api/district/:pin', (req, res) => {
  const result = validateAndResolvePin(req.params.pin);
  if (!result.valid) {
    return res.status(404).json({ error: 'District not found for this PIN.' });
  }
  res.json({ pin: result.pin, district: result.district });
});

// Weather endpoint (for frontend)
app.get('/api/weather/:pin', async (req, res) => {
  const result = validateAndResolvePin(req.params.pin);
  if (!result.valid) {
    return res.status(404).json({ error: 'Invalid PIN.' });
  }
  const data = await fetchWeatherOWM(result.district);
  if (!data) {
    return res.status(503).json({ error: 'Weather service unavailable. Check OPENWEATHER_API_KEY.' });
  }
  res.json({ district: result.district, weather: data });
});

/* ────────────────────────────────────────────────────────────
   SERVE FRONTEND (static)
──────────────────────────────────────────────────────────── */
const path = require('path');
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ────────────────────────────────────────────────────────────
   START SERVER
──────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n🌦️  AgroWeather Bot running on http://localhost:${PORT}`);
  console.log(`📱 WhatsApp webhook:    POST /webhook`);
  console.log(`💊 Health check:        GET  /health`);
  console.log(`📡 OWM enabled:         ${!!process.env.OPENWEATHER_API_KEY}`);
  console.log(`\n📋 Environment:`);
  console.log(`   NODE_ENV:            ${process.env.NODE_ENV || 'development'}`);
  console.log(`   TWILIO_ACCOUNT_SID:  ${process.env.TWILIO_ACCOUNT_SID ? '✓ Set' : '✗ Missing'}`);
  console.log(`   GEMINI_API_KEY:      ${process.env.GEMINI_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`   OPENWEATHER_API_KEY: ${process.env.OPENWEATHER_API_KEY ? '✓ Set' : '⚠ Optional (not set)'}`);
  console.log(`\n🔗 Use ngrok to expose this server to Twilio:`);
  console.log(`   ngrok http ${PORT}`);
  console.log(`   Then set Twilio Sandbox webhook to: https://<id>.ngrok.io/webhook\n`);
});
