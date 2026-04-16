// =============================================================
// AgroWeather Bot — Local Webhook Test Script
// Simulates WhatsApp messages hitting the /webhook endpoint
// Usage: node test/test_webhook.js
// =============================================================
'use strict';

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const DELAY_MS = 1500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function postWebhook(from, body) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      From: `whatsapp:${from}`,
      Body: body,
      To:   'whatsapp:+14155238886',   // Twilio Sandbox number
    }).toString();

    const options = {
      hostname: 'localhost',
      port:     3000,
      path:     '/webhook',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function extractMessage(twiml) {
  const match = twiml.match(/<Message>([\s\S]*?)<\/Message>/);
  return match ? match[1].trim() : '[No message extracted]';
}

async function runTests() {
  console.log('\n🧪 AgroWeather Bot — Webhook Test Suite\n');
  console.log('─'.repeat(55));

  const tests = [
    {
      label: 'T1: Hello without PIN → should ask for PIN',
      from:  '+919876543210',
      body:  'Hello',
    },
    {
      label: 'T2: Send valid PIN (Dharwad) → should authenticate',
      from:  '+919876543210',
      body:  '580001',
    },
    {
      label: 'T3: Ask weather question → should get advisory',
      from:  '+919876543210',
      body:  'Will it rain tomorrow? Should I irrigate today?',
    },
    {
      label: 'T4: New user with district name → authenticate',
      from:  '+919000000001',
      body:  'Mysuru',
    },
    {
      label: 'T5: Reset command → clear session',
      from:  '+919876543210',
      body:  'reset',
    },
    {
      label: 'T6: After reset, unknown PIN → ask for valid PIN',
      from:  '+919876543210',
      body:  '99999',
    },
    {
      label: 'T7: Fresh user with alias (Bangalore) → authenticate',
      from:  '+919111111111',
      body:  'bangalore',
    },
    {
      label: 'T8: Ask sowing question in authenticated session',
      from:  '+919111111111',
      body:  'Is it a good time to sow groundnut seeds this week?',
    },
  ];

  for (const test of tests) {
    await sleep(DELAY_MS);
    console.log(`\n📩 ${test.label}`);
    console.log(`   From: ${test.from}`);
    console.log(`   Body: "${test.body}"`);

    try {
      const result = await postWebhook(test.from, test.body);
      const msg    = extractMessage(result.body);
      console.log(`   Status: ${result.status}`);
      console.log(`   Reply:  ${msg.substring(0, 200)}${msg.length > 200 ? '…' : ''}`);
      console.log(`   ✅ OK`);
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      console.log('   (Is the server running? → node server.js)');
    }
  }

  console.log('\n' + '─'.repeat(55));
  console.log('✅ Test suite complete.\n');
}

runTests();
