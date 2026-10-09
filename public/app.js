const socket = io();
const $ = id => document.getElementById(id);
let myMark = null, currentCode = null, latestState = null, toastTimer;
const lobby = $("lobby"), game = $("game");
function name() { return $("playerName").value.trim() || "Player"; }
function showToast(message) {
  $("toast").textContent = message; $("toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2200);
}
function error(target, message="") { $(target).textContent = message; }
function updateRematchCountdown() {
  const rematch = latestState?.rematch;
  if (latestState?.status !== "finished" || !rematch?.pending) return;
  const secondsLeft = Math.max(0, Math.ceil((rematch.expiresAt - Date.now()) / 1000));
  const requester = latestState.players.find(p => p.mark === rematch.requestedByMark)?.name || "your friend";
  if (rematch.requestedBy === socket.id) {
    $("status").textContent = `Rematch requested — accepting in ${secondsLeft}s`;
    $("rematchBtn").textContent = `Rematch sent — ${secondsLeft}s`;
    $("rematchBtn").disabled = true;
  } else {
    $("status").textContent = `Rematch request from ${requester} — accept within ${secondsLeft}s`;
    $("rematchBtn").textContent = `Accept rematch (${secondsLeft}s)`;
    $("rematchBtn").disabled = false;
  }
}
setInterval(updateRematchCountdown, 250);
function enterGame(code) {
  currentCode = code; $("roomLabel").textContent = code;
  lobby.classList.add("hidden"); game.classList.remove("hidden");
  error("lobbyError"); error("gameError");
}
$("createBtn").addEventListener("click", () => {
  error("lobbyError");
  socket.emit("createRoom", {name:name()}, result => {
    if (!result?.ok) return error("lobbyError", result?.error || "Could not create room.");
    myMark = "X"; enterGame(result.code);
  });
});
$("joinBtn").addEventListener("click", () => {
  error("lobbyError");
  socket.emit("joinRoom", {code:$("roomCode").value, name:name()}, result => {
    if (!result?.ok) return error("lobbyError", result?.error || "Could not join room.");
    myMark = "O"; enterGame(result.code);
  });
});
$("roomCode").addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
$("playerName").addEventListener("keydown", e => { if (e.key === "Enter") $("createBtn").click(); });
$("copyBtn").addEventListener("click", async () => {
  const url = `${location.origin}/?room=${currentCode}`;
  try { await navigator.clipboard.writeText(url); showToast("Invite link copied!"); }
  catch { showToast(`Share room code: ${currentCode}`); }
});
$("board").addEventListener("click", e => {
  const cell = e.target.closest(".cell");
  if (!cell || !latestState) return;
  error("gameError");
  socket.emit("move", {index:Number(cell.dataset.index)}, result => {
    if (!result?.ok) error("gameError", result?.error || "Move could not be made.");
  });
});
$("rematchBtn").addEventListener("click", () => {
  const action = latestState?.rematch?.pending && latestState.rematch.requestedBy !== socket.id ? "accept" : "request";
  socket.emit("rematch", { action }, result => {
    if (!result?.ok) error("gameError", result?.error || "Could not start a rematch.");
    else if (action === "accept") showToast("Rematch accepted — starting fresh!");
    else showToast("Rematch request sent — waiting for your friend.");
  });
});
$("leaveBtn").addEventListener("click", () => { location.href = location.pathname; });
socket.on("state", state => {
  latestState = state;
  const me = state.players.find(p => p.mark === myMark);
  if (!me) { myMark = null; return; }
  $("nameX").textContent = state.players.find(p => p.mark === "X")?.name || "Waiting…";
  $("nameO").textContent = state.players.find(p => p.mark === "O")?.name || "Waiting…";
  $("playerX").classList.toggle("active", state.turn === "X" && state.status === "playing");
  $("playerO").classList.toggle("active", state.turn === "O" && state.status === "playing");
  const cells = [...document.querySelectorAll(".cell")];
  const winLine = state.winnerLine || [];
  cells.forEach((cell, i) => {
    const mark = state.board[i];
    cell.textContent = mark === "X" ? "×" : mark === "O" ? "○" : "";
    cell.classList.toggle("x", mark === "X");
    cell.classList.toggle("o", mark === "O");
    cell.classList.toggle("winner", winLine.includes(i));
    cell.disabled = !!mark || state.status !== "playing" || state.turn !== myMark || state.players.length < 2;
  });
  if (state.players.length < 2 || state.status === "waiting") $("status").textContent = "Waiting for your friend to join… Share the room code.";
  else if (state.status === "finished" && state.rematch?.pending) {
    updateRematchCountdown();
  }
  else if (state.status === "finished" && state.winner) $("status").textContent = state.winner === myMark ? "🎉 You won! Nicely played." : `Game over — ${state.winner} wins this round.`;
  else if (state.status === "finished") $("status").textContent = "🤝 It's a draw. Well played both!";
  else $("status").textContent = state.turn === myMark ? "Your turn — make your move." : `Waiting for ${state.turn === "X" ? $("nameX").textContent : $("nameO").textContent}…`;
  $("rematchBtn").classList.toggle("hidden", state.status !== "finished");
  if (state.status === "finished" && state.rematch?.pending) {
    updateRematchCountdown();
  } else {
    $("rematchBtn").textContent = "Play again ↻";
    $("rematchBtn").disabled = false;
  }
  if (state.players.length === 1) showToast("Your friend disconnected. Waiting for them to return…");
});

socket.on("rematchExpired", () => {
  showToast("Rematch expired. Room closed.");
  setTimeout(() => { location.href = location.pathname; }, 1200);
});
socket.on("connect", () => {
  const code = new URLSearchParams(location.search).get("room");
  if (code && !$("roomCode").value) $("roomCode").value = code;
});
socket.on("disconnect", () => { if (currentCode) error("gameError", "Connection lost. Reconnect to continue playing."); });
