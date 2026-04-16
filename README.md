# 🌦️ AgroWeather – WhatsApp Weather & Farmer Advisory Bot

> District PIN-authenticated weather forecasts and agro-advisories via WhatsApp, powered by Twilio, OpenWeatherMap, and Google Gemini AI.

**Live Demo (Frontend):** [GitHub Pages](https://Amith1994.github.io/agroweather-whatsapp-bot/)

---

## ✨ Features

- 🔐 **District PIN auth** — farmers send their district PIN via WhatsApp
- 🌡️ **Real-time weather** — IMD Mausamgram (primary) + OpenWeatherMap (fallback)
- 📅 **5-day forecast** with daily highs, lows, and rain probability
- 🗺️ **All 30 Karnataka districts** — 90+ pincodes mapped with lat/lon
- 🌿 **Gemini AI advisories** — informal, actionable farm tips per district
- 📱 **WhatsApp-native replies** — emoji-friendly messages via Twilio
- ⏱️ **Rate limiting** — 10 queries/hour per WhatsApp session
- 🌐 **Browser dashboard** — works standalone with just a Gemini API key

---

## 🚀 Quick Start

### Frontend Demo (no backend needed)
1. Visit the [GitHub Pages URL](https://Amith1994.github.io/agroweather-whatsapp-bot/)
2. Click ⚙️ → enter your [Gemini API key](https://aistudio.google.com/app/apikey)
3. Click 🔐 → enter a district PIN (e.g. `580001` for Dharwad, Karnataka)

### Full WhatsApp Bot

```bash
git clone https://github.com/Amith1994/agroweather-whatsapp-bot.git
cd agroweather-whatsapp-bot
npm install
cp .env.example .env      # fill in your keys
npm run dev
npx ngrok http 3000       # expose to Twilio
```

Set Twilio Sandbox webhook → `https://<ngrok-id>.ngrok.io/webhook`

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_ACCOUNT_SID` | ✅ | [Twilio Console](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | ✅ | Twilio Console |
| `GEMINI_API_KEY` | ✅ | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `OPENWEATHER_API_KEY` | ⚠️ Optional | [OpenWeatherMap](https://openweathermap.org/api) free tier |
| `PORT` | ➖ | Default: `3000` |

---

## 📍 Supported Districts — All 30 Karnataka + More

### Karnataka (30 Districts)

| District | Sample PINs |
|---|---|
| Bagalkot | 587101, 587102, 587103 |
| Ballari | 583101, 583102, 583103 |
| Belagavi | 590001, 590002, 590003 |
| Bengaluru Urban | 560001, 560002, 560003, 560004 |
| Bengaluru Rural | 562110, 562111, 562112 |
| Bidar | 585401, 585402, 585403 |
| Chamarajanagar | 571313, 571314, 571315 |
| Chikkaballapura | 562101, 562102, 562103 |
| Chikkamagaluru | 577101, 577102, 577103 |
| Chitradurga | 577501, 577502, 577503 |
| Dakshina Kannada | 575001, 575002, 575003 |
| Davangere | 577001, 577002, 577003 |
| Dharwad | 580001, 580002, 580003 |
| Gadag | 582101, 582102, 582103 |
| Hassan | 573201, 573202, 573203 |
| Haveri | 581110, 581111, 581112 |
| Kalaburagi | 585101, 585102, 585103 |
| Kodagu | 571201, 571202, 571203 |
| Kolar | 563101, 563102, 563103 |
| Koppal | 583231, 583232, 583233 |
| Mandya | 571401, 571402, 571403 |
| Mysuru | 570001, 570002, 570003 |
| Raichur | 584101, 584102, 584103 |
| Ramanagara | 562159, 562160, 562161 |
| Shivamogga | 577201, 577202, 577203 |
| Tumakuru | 572101, 572102, 572103 |
| Udupi | 576101, 576102, 576103 |
| Uttara Kannada | 581301, 581302, 581303 |
| Vijayapura | 586101, 586102, 586103 |
| Yadgir | 585201, 585202, 585203 |

Also accepts district names: `"Dharwad"`, `"Mysore"`, `"Bangalore"`, `"Coorg"`, `"Shimoga"`, `"Bijapur"` etc.

### Other States
`422001` Nashik · `411001` Pune · `520001` Vijayawada · `530001` Vizag · `500001` Hyderabad · `600001` Chennai · `625001` Madurai

---

## 🧪 Testing

```bash
npm start        # terminal 1
npm test         # terminal 2 — runs 8 webhook scenarios
```

---

## ☁️ Deployment

| Platform | Notes |
|----------|-------|
| **GitHub Pages** | Frontend `index.html` — free, automatic via Actions |
| **Railway** | Full backend — connect repo, add env vars |
| **Render** | Free tier backend — set start command to `node server.js` |
| **Docker** | `docker build -t agroweather-bot . && docker run -p 3000:3000 --env-file .env agroweather-bot` |

---

## 🔒 Security Notes

- Twilio signature validation active in `NODE_ENV=production`
- API keys stored in browser `localStorage` only (frontend)
- Sessions expire after 24 hours; rate-limited to 10 req/hour per user
- **Never commit `.env`** — it's in `.gitignore`

---

## 📄 License

MIT
