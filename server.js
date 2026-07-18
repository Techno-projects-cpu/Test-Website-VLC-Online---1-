const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// In-memory room storage.
// Each room: { participants: Map(socketId -> name), hostId: socketId|null }
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
  rooms.set(roomId, { participants: new Map(), hostId: null });
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

    io.to(roomId).emit('participants-update', Array.from(room.participants.values()));
    socket.to(roomId).emit('system-message', `${currentName} joined the room.`);
    socket.emit('joined-room', { roomId, name: currentName });

    // If someone is already sharing, tell the new joiner and tell the host
    // to open a connection to them.
    if (room.hostId && room.hostId !== socket.id) {
      const hostName = room.participants.get(room.hostId) || 'Someone';
      socket.emit('host-changed', { hostId: room.hostId, hostName });
      io.to(room.hostId).emit('new-viewer', { viewerId: socket.id });
    }
  });

  socket.on('chat-message', (text) => {
    if (!currentRoom) return;
    const trimmed = String(text).slice(0, 500);
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

  // --- Video sharing / WebRTC signaling ---

  socket.on('start-sharing', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.hostId = socket.id;

    io.to(currentRoom).emit('host-changed', { hostId: socket.id, hostName: currentName });

    // Tell the new host to open a connection to every existing viewer
    for (const viewerId of room.participants.keys()) {
      if (viewerId !== socket.id) {
        socket.emit('new-viewer', { viewerId });
      }
    }
  });

  socket.on('stop-sharing', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== socket.id) return;
    room.hostId = null;
    io.to(currentRoom).emit('host-stopped');
  });

  socket.on('webrtc-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
  });

  // Anyone can request play/pause; only routed to the current host, who
  // actually owns the media and applies the change.
  socket.on('playback-control', ({ action }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.hostId) return;
    io.to(room.hostId).emit('playback-control', { action });
  });

  // Host broadcasts the resulting state so everyone's UI (button label) matches
  socket.on('playback-state', ({ isPlaying }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== socket.id) return;
    socket.to(currentRoom).emit('playback-state', { isPlaying });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.participants.delete(socket.id);

    if (room.hostId === socket.id) {
      room.hostId = null;
      socket.to(currentRoom).emit('host-stopped');
    }

    io.to(currentRoom).emit('participants-update', Array.from(room.participants.values()));
    socket.to(currentRoom).emit('system-message', `${currentName} left the room.`);

    if (room.participants.size === 0) {
      rooms.delete(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Watch party server running on port ${PORT}`);
});
