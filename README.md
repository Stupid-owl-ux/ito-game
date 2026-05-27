# ito — Multiplayer Game Server

The number · word · game. Real-time multiplayer with WebRTC voice chat.

## How to deploy (Railway — free, 5 minutes)

### Step 1 — Get the code on GitHub
1. Go to https://github.com and create a free account if you don't have one
2. Click **New repository** → name it `ito-game` → Create
3. Upload all these files (drag and drop the folder contents into the repo page)

### Step 2 — Deploy on Railway
1. Go to https://railway.app and sign up with your GitHub account
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `ito-game` repo
4. Railway auto-detects Node.js and deploys it. Done!
5. Click on your project → **Settings** → **Domains** → **Generate Domain**
6. You get a URL like `https://ito-game-production.up.railway.app`

**That's it.** Share that URL with your friends. Free tier gives you 500 hours/month.

---

## How to play

1. One person opens the URL and clicks **Create Room**
2. They share the **5-letter room code** with all other players
3. Everyone else opens the URL, clicks **Join Room**, enters the code
4. Host clicks **Start Game**
5. Each player privately peeks at their number (hold the card)
6. Everyone clicks **Join Voice** to talk — give your verbal clue based on the theme
7. Players drag the face-down cards into the order they think is correct
8. Host clicks **Reveal Results** — cards flip one by one

---

## Running locally (for testing)

```bash
npm install
node server.js
```

Open http://localhost:3000 in multiple browser tabs.

---

## Tech stack
- **Node.js + Express** — HTTP server
- **Socket.io** — Real-time game state sync, private card delivery
- **WebRTC (mesh)** — Peer-to-peer voice chat
- **Vanilla JS + custom CSS** — No framework, fast everywhere
