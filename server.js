const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory room storage. Each room: { id, participants: Map(socketId -> name) }
const rooms = new Map();

function getRoomSummary(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    id: roomId,
    participants: Array.from(room.participants.values()),
  };
}

// Create a new room, return its id
app.get('/api/create-room', (req, res) => {
  const roomId = uuidv4().slice(0, 6); // short shareable code
  rooms.set(roomId, { participants: new Map() });
  res.json({ roomId });
});

// Check if a room exists (used when someone tries to join via code)
app.get('/api/room/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(getRoomSummary(req.params.id));
});

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentName = null;

  socket.on('join-room', ({ roomId, name }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('join-error', 'Room not found.');
      return;
    }

    currentRoom = roomId;
    currentName = name || 'Anonymous';

    socket.join(roomId);
    room.participants.set(socket.id, currentName);

    // Tell everyone in the room the updated participant list
    io.to(roomId).emit('participants-update', Array.from(room.participants.values()));

    // Let everyone know someone joined
    socket.to(roomId).emit('system-message', `${currentName} joined the room.`);

    socket.emit('joined-room', { roomId, name: currentName });
  });

  socket.on('chat-message', (text) => {
    if (!currentRoom) return;
    const trimmed = String(text).slice(0, 500); // basic length guard
    io.to(currentRoom).emit('chat-message', {
      name: currentName,
      text: trimmed,
      time: Date.now(),
    });
  });

  socket.on('reaction', (emoji) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('reaction', { name: currentName, emoji });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.participants.delete(socket.id);
    io.to(currentRoom).emit('participants-update', Array.from(room.participants.values()));
    socket.to(currentRoom).emit('system-message', `${currentName} left the room.`);

    // Clean up empty rooms
    if (room.participants.size === 0) {
      rooms.delete(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Watch party server running on port ${PORT}`);
});
