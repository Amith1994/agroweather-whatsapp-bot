# 🌦️ AgroWeather – WhatsApp Weather & Farmer Advisory Bot

> District PIN-authenticated weather forecasts and agro-advisories via WhatsApp, powered by Twilio, OpenWeatherMap, and Google Gemini AI.

**Live Demo (Frontend):** [GitHub Pages](https://Amith1994.github.io/agroweather-whatsapp-bot/)

---

## ✨ Features

- 🔐 **District PIN auth** — farmers send their district PIN via WhatsApp
- 🌡️ **Real-time weather** — OpenWeatherMap (temp, rain %, humidity, wind)
- 📅 **5-day forecast** with daily highs, lows, and rain probability
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

## 📍 Supported Districts (Karnataka + more)

`560001` Bengaluru · `580001` Dharwad · `570001` Mysuru · `591001` Belagavi · `577001` Davangere · `574101` Mangaluru · `585101` Kalaburagi · `500001` Hyderabad · `600001` Chennai

Also accepts names: `"Dharwad"`, `"Mysore"`, `"Bangalore"`, `"Hyderabad"` etc.

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
