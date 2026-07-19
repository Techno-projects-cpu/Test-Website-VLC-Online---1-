const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// Each room: { participants: Map(socketId -> name), hostId, sourceType, sourceData }
// sourceType: null | 'file' | 'youtube' | 'twitch' | 'url'
const rooms = new Map();

function getRoomSummary(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return { id: roomId, participants: Array.from(room.participants.values()) };
}

app.get('/api/create-room', (req, res) => {
  const roomId = uuidv4().slice(0, 6);
  rooms.set(roomId, { participants: new Map(), hostId: null, sourceType: null, sourceData: null });
  res.json({ roomId });
});

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

    if (room.hostId && room.hostId !== socket.id) {
      const hostName = room.participants.get(room.hostId) || 'Someone';
      socket.emit('host-changed', { hostId: room.hostId, hostName, sourceType: room.sourceType });

      if (room.sourceType === 'file') {
        io.to(room.hostId).emit('new-viewer', { viewerId: socket.id });
      } else if (room.sourceData) {
        socket.emit('remote-source-loaded', { sourceType: room.sourceType, sourceData: room.sourceData, hostName });
      }
    }
  });

  socket.on('chat-message', (text) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chat-message', { name: currentName, text: String(text).slice(0, 500), time: Date.now() });
  });

  socket.on('reaction', (emoji) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('reaction', { name: currentName, emoji });
  });

  // --- Local file sharing / WebRTC signaling ---
  socket.on('start-sharing', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.hostId = socket.id;
    room.sourceType = 'file';
    room.sourceData = null;

    io.to(currentRoom).emit('host-changed', { hostId: socket.id, hostName: currentName, sourceType: 'file' });

    for (const viewerId of room.participants.keys()) {
      if (viewerId !== socket.id) socket.emit('new-viewer', { viewerId });
    }
  });

  // --- YouTube / Twitch / direct URL sharing (each client renders its own player) ---
  socket.on('start-remote-source', ({ sourceType, sourceData }) => {
    const room = rooms.get(currentRoom);
    if (!room || !sourceType || !sourceData) return;
    room.hostId = socket.id;
    room.sourceType = sourceType;
    room.sourceData = sourceData;

    io.to(currentRoom).emit('host-changed', { hostId: socket.id, hostName: currentName, sourceType });
    io.to(currentRoom).emit('remote-source-loaded', { sourceType, sourceData, hostName: currentName });
  });

  socket.on('stop-sharing', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== socket.id) return;
    room.hostId = null;
    room.sourceType = null;
    room.sourceData = null;
    io.to(currentRoom).emit('host-stopped');
  });

  socket.on('webrtc-offer', ({ to, offer }) => io.to(to).emit('webrtc-offer', { from: socket.id, offer }));
  socket.on('webrtc-answer', ({ to, answer }) => io.to(to).emit('webrtc-answer', { from: socket.id, answer }));
  socket.on('webrtc-ice-candidate', ({ to, candidate }) => io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate }));

  // File mode: only the host owns the media, route control there.
  // Remote modes (youtube/twitch/url): every client has an independent player, broadcast to all.
  socket.on('playback-control', ({ action }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.hostId) return;
    if (room.sourceType === 'file') io.to(room.hostId).emit('playback-control', { action });
    else io.to(currentRoom).emit('playback-control', { action });
  });

  socket.on('playback-state', ({ isPlaying }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== socket.id) return;
    io.to(currentRoom).emit('playback-state', { isPlaying });
  });

  socket.on('playback-seek', ({ time }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.hostId) return;
    if (room.sourceType === 'file') io.to(room.hostId).emit('playback-seek', { time });
    else io.to(currentRoom).emit('playback-seek', { time });
  });

  socket.on('playback-time', ({ currentTime, duration }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== socket.id) return;
    socket.to(currentRoom).emit('playback-time', { currentTime, duration });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.participants.delete(socket.id);

    if (room.hostId === socket.id) {
      room.hostId = null;
      room.sourceType = null;
      room.sourceData = null;
      socket.to(currentRoom).emit('host-stopped');
    }

    io.to(currentRoom).emit('participants-update', Array.from(room.participants.values()));
    socket.to(currentRoom).emit('system-message', `${currentName} left the room.`);

    if (room.participants.size === 0) rooms.delete(currentRoom);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Watch party server running on port ${PORT}`));
