# Remote Duel — Real-time multiplayer Tic-Tac-Toe

A responsive, live multiplayer browser game. Two people can play from separate devices using a room code or invite URL.

## Rules
- The room creator is **X** and moves first; the joiner is **O**.
- Players alternate turns. The server validates each move.
- First to get three marks in a horizontal, vertical, or diagonal line wins.
- If all nine squares fill without a line, the game is a draw.
- One player can request a rematch; the other player must accept within 10 seconds to start a new game.

## Run locally
Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. For two-device testing on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:3000` on the other device. For friends outside your network, deploy it publicly (below).

## Deploy to Render (public URL)
1. Push this project to a GitHub repository.
2. Sign in to Render and choose **New → Web Service**, then connect the repository.
3. Set **Build Command** to `npm install` and **Start Command** to `npm start`.
4. Select a Node environment and create the service. Render supplies `PORT` automatically.
5. Open the `https://...onrender.com` URL. Create a room and send the invite link/code to a friend.

The app uses Socket.IO WebSockets with polling fallback. Keep the server process running while playing. In-memory rooms reset when the server restarts, which is fine for casual matches.

## Project files
- `server.js` — authoritative room state and move validation
- `public/index.html` — game UI
- `public/style.css` — responsive styling
- `public/app.js` — multiplayer client
