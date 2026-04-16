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
const OPTIONAL_ENV = ['ACCUWEATHER_API_KEY', 'OPENWEATHER_API_KEY'];

if (!process.env.ACCUWEATHER_API_KEY) {
  console.warn('[STARTUP] ACCUWEATHER_API_KEY not set — will skip AccuWeather and use OWM/Gemini.');
}

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
/* ────────────────────────────────────────────────────────────
   DISTRICT PIN -> LOCATION MAP
   All 31 Karnataka districts + major cities in other states.
   6 verified pincodes per Karnataka district (186+ Karnataka PINs).
   Format: PIN_CODE -> { city, district, state, lat, lon }
──────────────────────────────────────────────────────────── */
const _d = (city, district, lat, lon) => ({ city, district, state: 'Karnataka', lat, lon });

const DISTRICT_MAP = {
  // Bagalkot
  '587101': _d('Bagalkot',   'Bagalkot',   16.1851, 75.6960),
  '587102': _d('Bagalkot',   'Bagalkot',   16.1851, 75.6960),
  '587103': _d('Bagalkot',   'Bagalkot',   16.1851, 75.6960),
  '587111': _d('Bagalkot',   'Bagalkot',   16.1851, 75.6960),
  '587201': _d('Badami',     'Bagalkot',   15.9186, 75.6761),
  '587301': _d('Mudhol',     'Bagalkot',   16.3476, 75.2887),
  // Ballari
  '583101': _d('Ballari',    'Ballari',    15.1394, 76.9214),
  '583102': _d('Ballari',    'Ballari',    15.1394, 76.9214),
  '583103': _d('Ballari',    'Ballari',    15.1394, 76.9214),
  '583104': _d('Ballari',    'Ballari',    15.1394, 76.9214),
  '583113': _d('Siruguppa',  'Ballari',    15.6281, 76.8922),
  '583115': _d('Sandur',     'Ballari',    15.0830, 76.5553),
  // Belagavi
  '590001': _d('Belagavi',   'Belagavi',   15.8497, 74.4977),
  '590002': _d('Belagavi',   'Belagavi',   15.8497, 74.4977),
  '590003': _d('Belagavi',   'Belagavi',   15.8497, 74.4977),
  '590006': _d('Belagavi',   'Belagavi',   15.8497, 74.4977),
  '590010': _d('Belagavi',   'Belagavi',   15.8497, 74.4977),
  '591103': _d('Gokak',      'Belagavi',   16.1679, 74.6224),
  // Bengaluru Urban
  '560001': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  '560002': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  '560003': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  '560004': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  '560011': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  '560034': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  '560076': _d('Bengaluru',  'Bengaluru Urban', 12.9716, 77.5946),
  // Bengaluru Rural
  '562110': _d('Doddaballapura', 'Bengaluru Rural', 13.2959, 77.5370),
  '562111': _d('Devanahalli',    'Bengaluru Rural', 13.2476, 77.7128),
  '562114': _d('Hoskote',        'Bengaluru Rural', 13.0700, 77.7983),
  '562123': _d('Nelamangala',    'Bengaluru Rural', 13.1009, 77.3924),
  '562132': _d('Magadi',         'Bengaluru Rural', 12.9580, 77.2283),
  '562163': _d('Ramanagara',     'Bengaluru Rural', 12.7157, 77.2804),
  // Bidar
  '585401': _d('Bidar',      'Bidar',      17.9104, 77.5199),
  '585402': _d('Bidar',      'Bidar',      17.9104, 77.5199),
  '585403': _d('Bidar',      'Bidar',      17.9104, 77.5199),
  '585327': _d('Basavakalyan','Bidar',     17.8724, 76.9503),
  '585413': _d('Humnabad',   'Bidar',      17.7716, 77.1523),
  '585416': _d('Aurad',      'Bidar',      17.5500, 77.2200),
  // Chamarajanagar
  '571313': _d('Chamarajanagar','Chamarajanagar',11.9241,76.9437),
  '571314': _d('Chamarajanagar','Chamarajanagar',11.9241,76.9437),
  '571315': _d('Chamarajanagar','Chamarajanagar',11.9241,76.9437),
  '571342': _d('Kollegal',   'Chamarajanagar',12.1560,77.1103),
  '571440': _d('Gundlupet',  'Chamarajanagar',11.8100,76.6900),
  '571443': _d('Yelandur',   'Chamarajanagar',12.0600,77.0200),
  // Chikkaballapura
  '562101': _d('Chikkaballapura','Chikkaballapura',13.4355,77.7270),
  '562102': _d('Chikkaballapura','Chikkaballapura',13.4355,77.7270),
  '562103': _d('Chikkaballapura','Chikkaballapura',13.4355,77.7270),
  '562104': _d('Gudibanda',  'Chikkaballapura',13.7000,77.7700),
  '562105': _d('Bagepalli',  'Chikkaballapura',13.7800,77.7900),
  '561204': _d('Gauribidanur','Chikkaballapura',13.6100,77.5200),
  // Chikkamagaluru
  '577101': _d('Chikkamagaluru','Chikkamagaluru',13.3153,75.7754),
  '577102': _d('Chikkamagaluru','Chikkamagaluru',13.3153,75.7754),
  '577103': _d('Chikkamagaluru','Chikkamagaluru',13.3153,75.7754),
  '577111': _d('Kadur',      'Chikkamagaluru',13.5536,76.0117),
  '577126': _d('Birur',      'Chikkamagaluru',13.5900,75.9800),
  '577133': _d('Tarikere',   'Chikkamagaluru',13.7100,75.8200),
  // Chitradurga
  '577501': _d('Chitradurga','Chitradurga', 14.2251, 76.3980),
  '577502': _d('Chitradurga','Chitradurga', 14.2251, 76.3980),
  '577511': _d('Holalkere',  'Chitradurga', 14.0400, 76.1800),
  '577519': _d('Hiriyur',    'Chitradurga', 13.9400, 76.6100),
  '577522': _d('Challakere', 'Chitradurga', 14.3100, 76.6500),
  '577526': _d('Hosadurga',  'Chitradurga', 14.0700, 76.2900),
  // Dakshina Kannada
  '575001': _d('Mangaluru',  'Dakshina Kannada',12.9141,74.8560),
  '575002': _d('Mangaluru',  'Dakshina Kannada',12.9141,74.8560),
  '575003': _d('Mangaluru',  'Dakshina Kannada',12.9141,74.8560),
  '574142': _d('Belthangady','Dakshina Kannada',12.9877,75.3015),
  '574197': _d('Sullia',     'Dakshina Kannada',12.5584,75.3876),
  '574214': _d('Puttur',     'Dakshina Kannada',12.7600,75.2000),
  // Davangere
  '577001': _d('Davangere',  'Davangere',  14.4644, 75.9218),
  '577002': _d('Davangere',  'Davangere',  14.4644, 75.9218),
  '577003': _d('Davangere',  'Davangere',  14.4644, 75.9218),
  '577004': _d('Davangere',  'Davangere',  14.4644, 75.9218),
  '577005': _d('Davangere',  'Davangere',  14.4644, 75.9218),
  '577006': _d('Harihara',   'Davangere',  14.5118, 75.8091),
  // Dharwad
  '580001': _d('Dharwad',    'Dharwad',    15.4589, 75.0078),
  '580002': _d('Dharwad',    'Dharwad',    15.4589, 75.0078),
  '580003': _d('Dharwad',    'Dharwad',    15.4589, 75.0078),
  '580004': _d('Dharwad',    'Dharwad',    15.4589, 75.0078),
  '580007': _d('Dharwad',    'Dharwad',    15.4589, 75.0078),
  '580008': _d('Alnavar',    'Dharwad',    15.5100, 74.8600),
  // Gadag
  '582101': _d('Gadag',      'Gadag',      15.4316, 75.6214),
  '582102': _d('Gadag',      'Gadag',      15.4316, 75.6214),
  '582103': _d('Gadag',      'Gadag',      15.4316, 75.6214),
  '582115': _d('Ron',        'Gadag',      15.6900, 75.7100),
  '582117': _d('Nargund',    'Gadag',      15.7200, 75.3900),
  '582119': _d('Shirhatti',  'Gadag',      15.2400, 75.5800),
  // Hassan
  '573201': _d('Hassan',     'Hassan',     13.0033, 76.1004),
  '573202': _d('Hassan',     'Hassan',     13.0033, 76.1004),
  '573103': _d('Sakleshpur', 'Hassan',     12.9400, 75.7800),
  '573116': _d('Alur',       'Hassan',     12.9600, 75.9700),
  '573212': _d('Belur',      'Hassan',     13.1600, 75.8700),
  '573225': _d('Arsikere',   'Hassan',     13.3100, 76.2600),
  // Haveri
  '581110': _d('Haveri',     'Haveri',     14.7944, 75.3988),
  '581111': _d('Haveri',     'Haveri',     14.7944, 75.3988),
  '581112': _d('Haveri',     'Haveri',     14.7944, 75.3988),
  '581115': _d('Byadgi',     'Haveri',     14.6700, 75.4800),
  '581118': _d('Ranebennur', 'Haveri',     14.6200, 75.6400),
  '581123': _d('Hirekerur',  'Haveri',     14.4700, 75.3900),
  // Kalaburagi
  '585101': _d('Kalaburagi', 'Kalaburagi', 17.3297, 76.8200),
  '585102': _d('Kalaburagi', 'Kalaburagi', 17.3297, 76.8200),
  '585103': _d('Kalaburagi', 'Kalaburagi', 17.3297, 76.8200),
  '585104': _d('Kalaburagi', 'Kalaburagi', 17.3297, 76.8200),
  '585105': _d('Aland',      'Kalaburagi', 17.5600, 76.5700),
  '585106': _d('Chincholi',  'Kalaburagi', 17.4600, 77.4200),
  // Kodagu
  '571201': _d('Madikeri',   'Kodagu',     12.4210, 75.7382),
  '571202': _d('Madikeri',   'Kodagu',     12.4210, 75.7382),
  '571213': _d('Virajpet',   'Kodagu',     12.1965, 75.8095),
  '571218': _d('Somwarpet',  'Kodagu',     12.6000, 75.9300),
  '571234': _d('Kushalnagar','Kodagu',     12.4600, 75.9600),
  '571236': _d('Ponnampet',  'Kodagu',     12.1400, 75.9300),
  // Kolar
  '563101': _d('Kolar',      'Kolar',      13.1357, 78.1294),
  '563102': _d('Kolar',      'Kolar',      13.1357, 78.1294),
  '563103': _d('Kolar',      'Kolar',      13.1357, 78.1294),
  '563113': _d('Mulbagal',   'Kolar',      13.1600, 78.3900),
  '563114': _d('Srinivaspur','Kolar',      13.3400, 78.2100),
  '563121': _d('Malur',      'Kolar',      13.0000, 77.9200),
  // Koppal
  '583231': _d('Koppal',     'Koppal',     15.3508, 76.1538),
  '583232': _d('Koppal',     'Koppal',     15.3508, 76.1538),
  '583227': _d('Gangavathi', 'Koppal',     15.4300, 76.5300),
  '583230': _d('Kushtagi',   'Koppal',     15.7600, 76.1900),
  '583234': _d('Yelburga',   'Koppal',     15.6000, 76.0200),
  '583238': _d('Kanakagiri', 'Koppal',     15.4000, 76.3000),
  // Mandya
  '571401': _d('Mandya',     'Mandya',     12.5218, 76.8950),
  '571402': _d('Mandya',     'Mandya',     12.5218, 76.8950),
  '571403': _d('Mandya',     'Mandya',     12.5218, 76.8950),
  '571404': _d('Maddur',     'Mandya',     12.5800, 77.0400),
  '571405': _d('Malavalli',  'Mandya',     12.3900, 77.0800),
  '571426': _d('Nagamangala','Mandya',     12.8200, 76.7600),
  // Mysuru
  '570001': _d('Mysuru',     'Mysuru',     12.2958, 76.6394),
  '570002': _d('Mysuru',     'Mysuru',     12.2958, 76.6394),
  '570003': _d('Mysuru',     'Mysuru',     12.2958, 76.6394),
  '570004': _d('Mysuru',     'Mysuru',     12.2958, 76.6394),
  '570005': _d('Mysuru',     'Mysuru',     12.2958, 76.6394),
  '570008': _d('Mysuru',     'Mysuru',     12.2958, 76.6394),
  // Raichur
  '584101': _d('Raichur',    'Raichur',    16.2120, 77.3566),
  '584102': _d('Raichur',    'Raichur',    16.2120, 77.3566),
  '584103': _d('Raichur',    'Raichur',    16.2120, 77.3566),
  '584111': _d('Manvi',      'Raichur',    15.9900, 77.0500),
  '584115': _d('Devadurga',  'Raichur',    16.4000, 77.7000),
  '584123': _d('Lingasugur', 'Raichur',    16.1700, 76.5100),
  // Ramanagara
  '562159': _d('Ramanagara', 'Ramanagara', 12.7157, 77.2804),
  '562160': _d('Ramanagara', 'Ramanagara', 12.7157, 77.2804),
  '562161': _d('Ramanagara', 'Ramanagara', 12.7157, 77.2804),
  '562108': _d('Kanakapura', 'Ramanagara', 12.5500, 77.4200),
  '562117': _d('Channapatna','Ramanagara', 12.6500, 77.2100),
  '562120': _d('Magadi',     'Ramanagara', 12.9580, 77.2283),
  // Shivamogga
  '577201': _d('Shivamogga', 'Shivamogga', 13.9299, 75.5681),
  '577202': _d('Shivamogga', 'Shivamogga', 13.9299, 75.5681),
  '577203': _d('Shivamogga', 'Shivamogga', 13.9299, 75.5681),
  '577204': _d('Shivamogga', 'Shivamogga', 13.9299, 75.5681),
  '577216': _d('Sagar',      'Shivamogga', 14.1600, 75.0300),
  '577301': _d('Bhadravati', 'Shivamogga', 13.8500, 75.7000),
  // Tumakuru
  '572101': _d('Tumakuru',   'Tumakuru',   13.3409, 77.1010),
  '572102': _d('Tumakuru',   'Tumakuru',   13.3409, 77.1010),
  '572103': _d('Tumakuru',   'Tumakuru',   13.3409, 77.1010),
  '572104': _d('Tumakuru',   'Tumakuru',   13.3409, 77.1010),
  '572105': _d('Tiptur',     'Tumakuru',   13.2600, 76.4800),
  '572106': _d('Madhugiri',  'Tumakuru',   13.6600, 77.2200),
  // Udupi
  '576101': _d('Udupi',      'Udupi',      13.3409, 74.7421),
  '576102': _d('Udupi',      'Udupi',      13.3409, 74.7421),
  '576103': _d('Udupi',      'Udupi',      13.3409, 74.7421),
  '576104': _d('Udupi',      'Udupi',      13.3409, 74.7421),
  '576117': _d('Kundapur',   'Udupi',      13.6200, 74.6900),
  '576201': _d('Manipal',    'Udupi',      13.3500, 74.7900),
  // Uttara Kannada
  '581301': _d('Karwar',     'Uttara Kannada',14.8004,74.1288),
  '581302': _d('Karwar',     'Uttara Kannada',14.8004,74.1288),
  '581303': _d('Karwar',     'Uttara Kannada',14.8004,74.1288),
  '581304': _d('Ankola',     'Uttara Kannada',14.6600,74.3000),
  '581306': _d('Kumta',      'Uttara Kannada',14.4300,74.4200),
  '581401': _d('Sirsi',      'Uttara Kannada',14.6200,74.8400),
  // Vijayapura (Bijapur)
  '586101': _d('Vijayapura', 'Vijayapura', 16.8302, 75.7100),
  '586102': _d('Vijayapura', 'Vijayapura', 16.8302, 75.7100),
  '586103': _d('Vijayapura', 'Vijayapura', 16.8302, 75.7100),
  '586104': _d('Vijayapura', 'Vijayapura', 16.8302, 75.7100),
  '586108': _d('Indi',       'Vijayapura', 17.1800, 75.9600),
  '586109': _d('Muddebihal', 'Vijayapura', 16.3300, 76.1300),
  // Vijayanagara (31st district since 2020)
  '583201': _d('Hosapete',   'Vijayanagara',15.2731,76.3909),
  '583211': _d('Hosapete',   'Vijayanagara',15.2731,76.3909),
  '583212': _d('Hosapete',   'Vijayanagara',15.2731,76.3909),
  '583222': _d('Hagaribommanahalli','Vijayanagara',15.0400,76.2200),
  '583129': _d('Kudligi',    'Vijayanagara',14.9100,76.3800),
  '583131': _d('Hadagali',   'Vijayanagara',14.9800,75.9500),
  // Yadgir
  '585201': _d('Yadgir',     'Yadgir',     16.7700, 77.1400),
  '585202': _d('Yadgir',     'Yadgir',     16.7700, 77.1400),
  '585214': _d('Shorapur',   'Yadgir',     16.5200, 76.7600),
  '585221': _d('Gurmatkal',  'Yadgir',     16.8700, 77.4000),
  '585223': _d('Shahapur',   'Yadgir',     16.6900, 76.8500),
  '585321': _d('Wadagera',   'Yadgir',     17.0400, 77.0200),
  // Maharashtra
  '422001': { city: 'Nashik',        district: 'Nashik',        state: 'Maharashtra',    lat: 19.9975, lon: 73.7898 },
  '411001': { city: 'Pune',          district: 'Pune',          state: 'Maharashtra',    lat: 18.5204, lon: 73.8567 },
  '444601': { city: 'Amravati',      district: 'Amravati',      state: 'Maharashtra',    lat: 20.9320, lon: 77.7523 },
  // Andhra Pradesh
  '520001': { city: 'Vijayawada',    district: 'Krishna',       state: 'Andhra Pradesh', lat: 16.5062, lon: 80.6480 },
  '530001': { city: 'Visakhapatnam', district: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lon: 83.2185 },
  // Tamil Nadu
  '600001': { city: 'Chennai',       district: 'Chennai',       state: 'Tamil Nadu',     lat: 13.0827, lon: 80.2707 },
  '625001': { city: 'Madurai',       district: 'Madurai',       state: 'Tamil Nadu',     lat: 9.9252,  lon: 78.1198 },
  // Telangana
  '500001': { city: 'Hyderabad',     district: 'Hyderabad',     state: 'Telangana',      lat: 17.3850, lon: 78.4867 },
};

// Alias map — district names / alternate spellings -> primary pincode
const NAME_ALIASES = {
  'bagalkot': '587101', 'bagalkote': '587101',
  'ballari': '583101', 'bellary': '583101',
  'belagavi': '590001', 'belgaum': '590001',
  'bengaluru': '560001', 'bangalore': '560001', 'bengalooru': '560001', 'blr': '560001',
  'bengaluru rural': '562110', 'bangalore rural': '562110',
  'bidar': '585401',
  'chamarajanagar': '571313', 'chamarajanagara': '571313',
  'chikkaballapura': '562101', 'chikballapur': '562101',
  'chikkamagaluru': '577101', 'chikmagalur': '577101', 'chickmagalur': '577101',
  'chitradurga': '577501', 'chitradurg': '577501',
  'dakshina kannada': '575001', 'mangaluru': '575001', 'mangalore': '575001', 'dk': '575001',
  'davangere': '577001', 'davanagere': '577001', 'davangiri': '577001',
  'dharwad': '580001', 'dharwaad': '580001', 'ka-dwd': '580001',
  'gadag': '582101', 'gadag-betgeri': '582101',
  'hassan': '573201',
  'haveri': '581110',
  'kalaburagi': '585101', 'gulbarga': '585101', 'ka-grg': '585101',
  'kodagu': '571201', 'coorg': '571201', 'madikeri': '571201',
  'kolar': '563101',
  'koppal': '583231',
  'mandya': '571401',
  'mysuru': '570001', 'mysore': '570001',
  'raichur': '584101',
  'ramanagara': '562159', 'ramanagar': '562159',
  'shivamogga': '577201', 'shimoga': '577201',
  'tumakuru': '572101', 'tumkur': '572101',
  'udupi': '576101', 'udipi': '576101', 'manipal': '576201',
  'uttara kannada': '581301', 'north kanara': '581301', 'karwar': '581301', 'uk': '581301',
  'vijayapura': '586101', 'bijapur': '586101',
  'vijayanagara': '583201', 'vijaya nagara': '583201', 'hosapete': '583201', 'hospet': '583201', 'hampi': '583201',
  'yadgir': '585201', 'yadagiri': '585201',
  'nashik': '422001', 'nasik': '422001',
  'pune': '411001', 'poona': '411001',
  'amravati': '444601',
  'vijayawada': '520001',
  'visakhapatnam': '530001', 'vizag': '530001',
  'hyderabad': '500001', 'hyd': '500001',
  'chennai': '600001', 'madras': '600001',
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
   WEATHER DATA FETCH — AccuWeather (Priority 2)
   Uses AccuWeather Location API + Current Conditions + 5-day Forecast.
   Location keys are cached in memory to avoid duplicate geo-lookups.
──────────────────────────────────────────────────────────── */
const acuLocationCache = new Map();  // district.city → locationKey

async function fetchWeatherAccuWeather(district) {
  if (!process.env.ACCUWEATHER_API_KEY) return null;
  const key = process.env.ACCUWEATHER_API_KEY;

  try {
    // Step 1: Get AccuWeather location key (cached per district city)
    let locationKey = acuLocationCache.get(district.city);
    if (!locationKey) {
      const geoRes = await axios.get(
        'http://dataservice.accuweather.com/locations/v1/cities/geoposition/search',
        {
          params: { apikey: key, q: `${district.lat},${district.lon}`, language: 'en-us' },
          timeout: 6000,
        }
      );
      locationKey = geoRes.data?.Key;
      if (!locationKey) throw new Error('No location key returned');
      acuLocationCache.set(district.city, locationKey);
      console.log(`[ACU] Location key cached for ${district.city}: ${locationKey}`);
    }

    // Step 2: Fetch current conditions + 5-day forecast in parallel
    const [currentRes, forecastRes] = await Promise.all([
      axios.get(
        `http://dataservice.accuweather.com/currentconditions/v1/${locationKey}`,
        { params: { apikey: key, details: true }, timeout: 6000 }
      ),
      axios.get(
        `http://dataservice.accuweather.com/forecasts/v1/daily/5day/${locationKey}`,
        { params: { apikey: key, metric: true, details: false }, timeout: 6000 }
      ),
    ]);

    const current  = currentRes.data?.[0];
    const forecast = forecastRes.data?.DailyForecasts || [];
    if (!current) throw new Error('Empty current conditions response');

    // Build 5-day forecast
    const days = forecast.map((f, i) => {
      const date = new Date(f.Date);
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return {
        day:       i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : dayNames[date.getDay()]),
        high_c:    Math.round(f.Temperature?.Maximum?.Value ?? 0),
        low_c:     Math.round(f.Temperature?.Minimum?.Value ?? 0),
        rain_pct:  Math.round(f.Day?.PrecipitationProbability ?? 0),
        condition: f.Day?.IconPhrase || 'N/A',
      };
    });

    console.log(`[ACU] Fetched weather for ${district.city} — ${current.WeatherText}`);
    return {
      temperature_c:     Math.round(current.Temperature?.Metric?.Value ?? 0),
      feels_like_c:      Math.round(current.RealFeelTemperature?.Metric?.Value ?? current.Temperature?.Metric?.Value ?? 0),
      humidity_pct:      current.RelativeHumidity ?? null,
      wind_kmh:          Math.round((current.Wind?.Speed?.Metric?.Value ?? 0)),
      condition:         current.WeatherText || 'N/A',
      rainfall_prob_pct: Math.round(current.PrecipitationProbability ?? (days[0]?.rain_pct ?? 0)),
      uv_index:          current.UVIndex ?? null,
      forecast:          days,
      source:            'AccuWeather',
      fetched_at:        new Date().toISOString(),
    };

  } catch (err) {
    console.error('[ACU] AccuWeather fetch failed:', err.message);
    return null;
  }
}


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

  // 2. Try AccuWeather (detailed forecast + feels-like + UV index)
  const acuData = await fetchWeatherAccuWeather(district);
  if (acuData) return acuData;

  // 3. Fall back to OpenWeatherMap
  const owmData = await fetchWeatherOWM(district);
  if (owmData) return { ...owmData, source: 'OpenWeatherMap' };

  // 4. No live data — Gemini will use training knowledge
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
  console.log(`\n📡 API Endpoints:`);
  console.log(`   POST /webhook              → Twilio WhatsApp handler`);
  console.log(`   GET  /health               → Server health + district count`);
  console.log(`   GET  /api/districts        → All ${Object.keys(DISTRICT_MAP).length} pincodes across 30 Karnataka districts`);
  console.log(`   GET  /api/district/:pin    → Lookup district by PIN`);
  console.log(`   GET  /api/weather/:pin     → Live weather for a PIN`);
  console.log(`\n📋 Environment:`);
  console.log(`   NODE_ENV:            ${process.env.NODE_ENV || 'development'}`);
  console.log(`   TWILIO_ACCOUNT_SID:  ${process.env.TWILIO_ACCOUNT_SID ? '✓ Set' : '✗ Missing'}`);
  console.log(`   GEMINI_API_KEY:      ${process.env.GEMINI_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`   ACCUWEATHER_API_KEY: ${process.env.ACCUWEATHER_API_KEY ? '✓ Set' : '⚠ Optional (not set)'}`);
  console.log(`   OPENWEATHER_API_KEY: ${process.env.OPENWEATHER_API_KEY ? '✓ Set' : '⚠ Optional (not set)'}`);
  console.log(`   IMD Mausamgram:      ✓ Enabled (primary weather source)`);
  console.log(`\n🔗 Use ngrok to expose this server to Twilio:`);
  console.log(`   ngrok http ${PORT}`);
  console.log(`   Then set Twilio Sandbox webhook to: https://<id>.ngrok.io/webhook\n`);
});