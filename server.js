const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true, game: "Remote Duel" }));

const rooms = new Map();
const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
const REMATCH_TIMEOUT_MS = 10_000;
const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function rematchSecondsLeft(room) {
  if (!room.rematch || !room.rematch.expiresAt) return 0;
  return Math.max(0, Math.ceil((room.rematch.expiresAt - Date.now()) / 1000));
}
function publicState(room) {
  const winnerLine = WIN_LINES.find(line => line.every(i => room.board[i] && room.board[i] === room.board[line[0]]));
  const winner = winnerLine ? room.board[winnerLine[0]] : null;
  const draw = !winner && room.board.every(Boolean);
  const rematch = room.rematch ? {
    requestedBy: room.rematch.requestedBy,
    requestedByMark: room.players.find(p => p.id === room.rematch.requestedBy)?.mark || null,
    pending: room.rematch.pending,
    expiresAt: room.rematch.expiresAt,
    secondsLeft: rematchSecondsLeft(room)
  } : {
    requestedBy: null,
    requestedByMark: null,
    pending: false,
    expiresAt: null,
    secondsLeft: 0
  };
  return {
    code: room.code,
    board: room.board,
    players: room.players.map(p => ({ name: p.name, mark: p.mark, connected: p.connected })),
    turn: room.turn,
    winner,
    winnerLine: winnerLine || [],
    draw,
    status: room.status,
    rematchVotes: room.rematchVotes.size,
    rematch
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }
function startRematchTimeout(room) {
  if (room.rematchTimer) clearTimeout(room.rematchTimer);
  room.rematch = room.rematch || { requestedBy: null, pending: false, expiresAt: null };
  room.rematch.pending = true;
  room.rematch.expiresAt = Date.now() + REMATCH_TIMEOUT_MS;
  room.rematchTimer = setTimeout(() => {
    const activeRoom = rooms.get(room.code);
    if (!activeRoom || !activeRoom.rematch || !activeRoom.rematch.pending) return;
    io.to(activeRoom.code).emit("rematchExpired", { code: activeRoom.code, seconds: 0 });
    for (const player of [...activeRoom.players]) {
      const socket = io.sockets.sockets.get(player.id);
      if (socket) {
        socket.leave(activeRoom.code);
        socket.data.roomCode = null;
      }
    }
    rooms.delete(activeRoom.code);
  }, REMATCH_TIMEOUT_MS);
}
function clearRematch(room) {
  room.rematch = null;
  if (room.rematchTimer) {
    clearTimeout(room.rematchTimer);
    room.rematchTimer = null;
  }
}
function leaveCurrent(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  if (room.players.length === 0) rooms.delete(code);
  else {
    room.players.forEach(p => p.connected = io.sockets.sockets.has(p.id));
    room.status = "waiting";
    room.board = Array(9).fill(null);
    room.turn = "X";
    room.rematchVotes.clear();
    broadcast(room);
  }
}
io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}, cb = () => {}) => {
    leaveCurrent(socket);
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = { code, board: Array(9).fill(null), turn: "X", status: "waiting", rematchVotes: new Set(), rematch: null, rematchTimer: null,
      players: [{ id: socket.id, name: cleanName(name), mark: "X", connected: true }] };
    rooms.set(code, room);
    socket.join(code); socket.data.roomCode = code; socket.data.mark = "X";
    cb({ ok: true, code }); broadcast(room);
  });
  socket.on("joinRoom", ({ code, name } = {}, cb = () => {}) => {
    leaveCurrent(socket);
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found. Check the code and try again." });
    if (room.players.length >= 2) return cb({ ok: false, error: "This room already has two players." });
    const mark = "O";
    room.players.push({ id: socket.id, name: cleanName(name), mark, connected: true });
    room.status = "playing";
    socket.join(code); socket.data.roomCode = code; socket.data.mark = mark;
    cb({ ok: true, code }); broadcast(room);
  });
  socket.on("move", ({ index } = {}, cb = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Join a room first." });
    if (room.status !== "playing") return cb({ ok: false, error: "The game is not currently active." });
    if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index]) return cb({ ok: false, error: "That square is not available." });
    if (socket.data.mark !== room.turn) return cb({ ok: false, error: "Wait for your turn." });
    room.board[index] = room.turn;
    const won = WIN_LINES.some(line => line.every(i => room.board[i] === room.turn));
    if (won || room.board.every(Boolean)) room.status = "finished";
    else room.turn = room.turn === "X" ? "O" : "X";
    broadcast(room); cb({ ok: true });
  });
  socket.on("rematch", (payload, cb = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "finished") return cb({ ok: false, error: "No finished game to rematch." });

    const action = payload && typeof payload.action === "string" ? payload.action : "request";
    const pendingRematch = room.rematch && room.rematch.pending;

    if (action === "accept") {
      if (!pendingRematch) return cb({ ok: false, error: "No rematch request is waiting for approval." });
      if (room.rematch.requestedBy === socket.id) return cb({ ok: false, error: "You already requested the rematch." });
      room.board = Array(9).fill(null);
      room.turn = "X";
      room.status = "playing";
      room.rematchVotes.clear();
      clearRematch(room);
      broadcast(room);
      return cb({ ok: true, accepted: true });
    }

    if (pendingRematch) return cb({ ok: false, error: "A rematch request is already pending. Wait for your friend to accept." });

    room.rematch = { requestedBy: socket.id, pending: true, expiresAt: Date.now() + REMATCH_TIMEOUT_MS };
    room.rematchVotes.clear();
    startRematchTimeout(room);
    broadcast(room);
    cb({ ok: true, requested: true });
  });
  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;
    if (room.status === "playing") room.status = "waiting";
    if (room.rematch && room.rematch.pending && room.players.filter(p => p.connected).length < 2) {
      clearRematch(room);
      room.players = [];
      rooms.delete(socket.data.roomCode);
      return;
    }
    broadcast(room);
  });
});
function cleanName(name) {
  const s = String(name || "").trim().replace(/[<>]/g, "").slice(0, 18);
  return s || "Player";
}
server.listen(PORT, "0.0.0.0", () => console.log(`Remote Duel running on port ${PORT}`));
