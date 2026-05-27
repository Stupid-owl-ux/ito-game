const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Game State Store ───
// rooms[code] = { code, hostId, phase, theme, players[], tableOrder[], settings }
const rooms = {};

const THEMES = [
  "Worst to best pizza toppings",
  "Least to most satisfying naps",
  "Coldest to hottest chilies you'd eat",
  "Most forgettable to most iconic movie villains",
  "Quietest to loudest animals",
  "Least to most acceptable reasons to cancel plans",
  "Easiest to hardest video games you've played",
  "Worst to best airport foods",
  "Least to most chaotic ways to eat ramen",
  "Least to most embarrassing childhood memories",
  "Lowest to highest number of times you'd rewatch a film",
  "Least to most useful superpowers in daily life",
  "Worst to best road trip songs",
  "Least to most spicy opinions you hold",
  "Least to most dramatic reactions to a spider",
  "Cheapest to most extravagant date ideas",
  "Least to most suspicious behavior at 2am",
  "Weakest to strongest coffee you need to function",
  "Least to most likely to survive a zombie apocalypse",
  "Smallest to biggest life decisions you've made on impulse"
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function genUniqueNumbers(count) {
  const pool = Array.from({ length: 100 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function getRoomPublicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    theme: room.theme,
    hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      socketId: p.socketId,
      ready: p.ready,
      connected: p.connected
    })),
    tableOrder: room.tableOrder,
    revealedSlots: room.revealedSlots || []
  };
}

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ── Create Room ──
  socket.on('create_room', ({ playerName }, cb) => {
    const code = generateRoomCode();
    const player = { id: uuidv4(), socketId: socket.id, name: playerName, number: null, ready: false, connected: true };
    rooms[code] = {
      code,
      hostId: player.id,
      phase: 'lobby',
      theme: '',
      players: [player],
      tableOrder: [],
      revealedSlots: []
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    console.log(`[Room ${code}] Created by ${playerName}`);
    cb({ ok: true, code, playerId: player.id, roomState: getRoomPublicState(rooms[code]) });
  });

  // ── Join Room ──
  socket.on('join_room', ({ code, playerName }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Game already in progress.' });
    if (room.players.length >= 8) return cb({ ok: false, error: 'Room is full (max 8 players).' });
    const nameTaken = room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (nameTaken) return cb({ ok: false, error: 'That name is already taken in this room.' });

    const player = { id: uuidv4(), socketId: socket.id, name: playerName, number: null, ready: false, connected: true };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    console.log(`[Room ${code}] ${playerName} joined`);

    socket.to(code).emit('room_updated', getRoomPublicState(room));
    cb({ ok: true, code, playerId: player.id, roomState: getRoomPublicState(room) });
  });

  // ── Start Game ──
  socket.on('start_game', (_, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.hostId !== socket.data.playerId) return cb?.({ ok: false, error: 'Only the host can start.' });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'Need at least 2 players.' });

    const nums = genUniqueNumbers(room.players.length);
    room.players.forEach((p, i) => { p.number = nums[i]; p.ready = false; });
    room.theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    room.phase = 'clue';
    room.tableOrder = room.players.map((_, i) => i);
    room.revealedSlots = [];

    // Broadcast public state to everyone
    io.to(room.code).emit('room_updated', getRoomPublicState(room));

    // Send each player their secret number privately
    room.players.forEach(p => {
      io.to(p.socketId).emit('your_card', { number: p.number, theme: room.theme });
    });

    console.log(`[Room ${room.code}] Game started — theme: "${room.theme}"`);
    cb?.({ ok: true });
  });

  // ── Player Ready (clue given) ──
  socket.on('player_ready', (_, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player) return;
    player.ready = true;

    io.to(room.code).emit('room_updated', getRoomPublicState(room));

    const allReady = room.players.every(p => p.ready);
    if (allReady) {
      room.phase = 'sort';
      io.to(room.code).emit('room_updated', getRoomPublicState(room));
      io.to(room.code).emit('phase_change', { phase: 'sort' });
      console.log(`[Room ${room.code}] All ready — moving to sort phase`);
    }
    cb?.({ ok: true });
  });

  // ── Update Table Order (any player can drag) ──
  socket.on('update_order', ({ tableOrder }, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'sort') return;
    room.tableOrder = tableOrder;
    socket.to(room.code).emit('order_updated', { tableOrder });
    cb?.({ ok: true });
  });

  // ── Reveal ──
  socket.on('reveal', (_, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (room.hostId !== socket.data.playerId) return cb?.({ ok: false, error: 'Only the host can reveal.' });
    room.phase = 'reveal';

    // Build reveal data: send everyone the numbers in tableOrder
    const revealData = room.tableOrder.map(playerIdx => ({
      playerIdx,
      name: room.players[playerIdx].name,
      number: room.players[playerIdx].number
    }));

    io.to(room.code).emit('reveal_results', { tableOrder: room.tableOrder, revealData });
    console.log(`[Room ${room.code}] Revealed`);
    cb?.({ ok: true });
  });

  // ── Play Again ──
  socket.on('play_again', (_, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (room.hostId !== socket.data.playerId) return cb?.({ ok: false, error: 'Only the host can restart.' });

    const nums = genUniqueNumbers(room.players.length);
    room.players.forEach((p, i) => { p.number = nums[i]; p.ready = false; });
    room.theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    room.phase = 'clue';
    room.tableOrder = room.players.map((_, i) => i);
    room.revealedSlots = [];

    io.to(room.code).emit('room_updated', getRoomPublicState(room));
    room.players.forEach(p => {
      io.to(p.socketId).emit('your_card', { number: p.number, theme: room.theme });
    });
    io.to(room.code).emit('phase_change', { phase: 'clue' });
    cb?.({ ok: true });
  });

  // ─── WebRTC Signaling ───
  socket.on('webrtc_offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('webrtc_offer', { fromSocketId: socket.id, offer });
  });

  socket.on('webrtc_answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc_answer', { fromSocketId: socket.id, answer });
  });

  socket.on('webrtc_ice', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc_ice', { fromSocketId: socket.id, candidate });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      console.log(`[Room ${roomCode}] ${player.name} disconnected`);
      socket.to(roomCode).emit('player_disconnected', { playerId, name: player.name });
      io.to(roomCode).emit('room_updated', getRoomPublicState(room));
    }
    // Clean up empty rooms after 10 min
    const allGone = room.players.every(p => !p.connected);
    if (allGone) {
      setTimeout(() => {
        if (rooms[roomCode] && rooms[roomCode].players.every(p => !p.connected)) {
          delete rooms[roomCode];
          console.log(`[Room ${roomCode}] Cleaned up`);
        }
      }, 10 * 60 * 1000);
    }
  });

  // ── Reconnect ──
  socket.on('rejoin_room', ({ code, playerId }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Room expired or not found.' });
    const player = room.players.find(p => p.id === playerId);
    if (!player) return cb({ ok: false, error: 'Player not found in room.' });

    player.socketId = socket.id;
    player.connected = true;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;

    socket.to(code).emit('room_updated', getRoomPublicState(room));
    cb({ ok: true, roomState: getRoomPublicState(room) });

    if (player.number !== null) {
      socket.emit('your_card', { number: player.number, theme: room.theme });
    }
    console.log(`[Room ${code}] ${player.name} reconnected`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ito server running on port ${PORT}`));
