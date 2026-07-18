const params = new URLSearchParams(window.location.search);
const roomId = params.get('id');
const name = localStorage.getItem('watchparty-name') || 'Anonymous';

document.getElementById('roomCodeDisplay').textContent = roomId;

const socket = io();

socket.emit('join-room', { roomId, name });

socket.on('join-error', (msg) => {
  alert(msg);
  window.location.href = '/';
});

// --- Participants ---
const participantList = document.getElementById('participantList');
socket.on('participants-update', (names) => {
  participantList.innerHTML = '';
  names.forEach((n) => {
    const li = document.createElement('li');
    li.textContent = n;
    participantList.appendChild(li);
  });
});

// --- Chat ---
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

function appendChatLine(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

socket.on('chat-message', (msg) => {
  appendChatLine(`<span class="chat-name">${escapeHtml(msg.name)}:</span> ${escapeHtml(msg.text)}`);
});

socket.on('system-message', (text) => {
  appendChatLine(`<span class="chat-system">${escapeHtml(text)}</span>`);
});

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  chatInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// --- Reactions ---
const reactionLayer = document.getElementById('reactionLayer');

document.querySelectorAll('.reaction-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('reaction', btn.dataset.emoji);
  });
});

socket.on('reaction', ({ emoji }) => {
  const el = document.createElement('span');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = `${20 + Math.random() * 60}%`;
  reactionLayer.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

// --- Invite link ---
document.getElementById('copyLinkBtn').addEventListener('click', () => {
  const link = window.location.href;
  navigator.clipboard.writeText(link).then(() => {
    alert('Invite link copied! Send it to a friend.');
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ Video sharing (WebRTC) ============

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const mediaVideo = document.getElementById('mediaVideo');
const placeholderText = document.getElementById('placeholderText');
const playerControls = document.getElementById('playerControls');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopSharingBtn = document.getElementById('stopSharingBtn');
const volumeSlider = document.getElementById('volumeSlider');
const shareRow = document.getElementById('shareRow');
const filePicker = document.getElementById('filePicker');

let isHost = false;
let hostId = null;
let localStream = null;
const hostPeers = {};      // used when I am the host: viewerId -> RTCPeerConnection
let viewerPeer = null;     // used when I am a viewer: single connection to the host

// Volume is always local-only — never sent over the network.
volumeSlider.addEventListener('input', () => {
  mediaVideo.volume = parseFloat(volumeSlider.value);
});

// --- Becoming the host (picking a local file) ---
filePicker.addEventListener('change', () => {
  const file = filePicker.files[0];
  if (!file) return;

  isHost = true;
  const url = URL.createObjectURL(file);
  mediaVideo.src = url;
  mediaVideo.muted = false;
  mediaVideo.play();

  mediaVideo.onloadedmetadata = () => {
    localStream = mediaVideo.captureStream ? mediaVideo.captureStream() : mediaVideo.mozCaptureStream();
    socket.emit('start-sharing');
  };

  showPlayerUI();
  stopSharingBtn.style.display = 'inline-block';
});

stopSharingBtn.addEventListener('click', () => {
  socket.emit('stop-sharing');
  resetPlayerUI();
});

function showPlayerUI() {
  placeholderText.style.display = 'none';
  playerControls.style.display = 'flex';
  shareRow.style.display = 'none';
}

function resetPlayerUI() {
  isHost = false;
  hostId = null;
  mediaVideo.pause();
  mediaVideo.removeAttribute('src');
  mediaVideo.load();
  placeholderText.style.display = 'block';
  placeholderText.textContent = '🎥 No one is sharing a video yet.\nPick a file from your computer to start watching together.';
  playerControls.style.display = 'none';
  shareRow.style.display = 'flex';
  Object.values(hostPeers).forEach((pc) => pc.close());
  for (const k in hostPeers) delete hostPeers[k];
  if (viewerPeer) { viewerPeer.close(); viewerPeer = null; }
}

// --- Someone else starts/stops sharing ---
socket.on('host-changed', ({ hostId: hId, hostName }) => {
  if (hId === socket.id) {
    hostLabel.textContent = 'You are sharing';
    return;
  }
  hostId = hId;
  placeholderText.textContent = `⏳ Connecting to ${hostName}'s video...`;
  hostLabel.textContent = `${hostName} is sharing`;
  showPlayerUI();
});

socket.on('host-stopped', () => {
  hostLabel.textContent = '';
  if (!isHost) resetPlayerUI();
});

// --- Host: connect to each viewer that needs a peer connection ---
socket.on('new-viewer', ({ viewerId }) => {
  if (!localStream) return;
  const pc = new RTCPeerConnection(rtcConfig);
  hostPeers[viewerId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-ice-candidate', { to: viewerId, candidate: e.candidate });
  };

  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer).then(() => offer))
    .then((offer) => socket.emit('webrtc-offer', { to: viewerId, offer }));
});

// --- Viewer: receive offer from host, answer it ---
socket.on('webrtc-offer', ({ from, offer }) => {
  hostId = from;
  const pc = new RTCPeerConnection(rtcConfig);
  viewerPeer = pc;

  pc.ontrack = (e) => {
    mediaVideo.srcObject = e.streams[0];
    mediaVideo.play();
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-ice-candidate', { to: from, candidate: e.candidate });
  };

  pc.setRemoteDescription(offer)
    .then(() => pc.createAnswer())
    .then((answer) => pc.setLocalDescription(answer).then(() => answer))
    .then((answer) => socket.emit('webrtc-answer', { to: from, answer }));
});

socket.on('webrtc-answer', ({ from, answer }) => {
  const pc = hostPeers[from];
  if (pc) pc.setRemoteDescription(answer);
});

socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
  const pc = isHost ? hostPeers[from] : viewerPeer;
  if (pc) pc.addIceCandidate(candidate).catch(() => {});
});

// --- Play/pause: anyone can trigger it, host applies it, host reports the result ---
let knownIsPlaying = true;

playPauseBtn.addEventListener('click', () => {
  const action = knownIsPlaying ? 'pause' : 'play';
  socket.emit('playback-control', { action });
});

socket.on('playback-control', ({ action }) => {
  if (!isHost) return;
  if (action === 'pause') mediaVideo.pause();
  else mediaVideo.play();
});

// Host reports actual state changes (covers the host clicking their own video too)
mediaVideo.addEventListener('play', () => {
  if (isHost) socket.emit('playback-state', { isPlaying: true });
});
mediaVideo.addEventListener('pause', () => {
  if (isHost) socket.emit('playback-state', { isPlaying: false });
});

socket.on('playback-state', ({ isPlaying }) => {
  knownIsPlaying = isPlaying;
  playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
});

// --- Seeking ---
const seekSlider = document.getElementById('seekSlider');
const currentTimeLabel = document.getElementById('currentTimeLabel');
const durationLabel = document.getElementById('durationLabel');
const hostLabel = document.getElementById('hostLabel');

let isDraggingSeek = false;
let knownDuration = 0;

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Host: periodically report time, and update the label locally
setInterval(() => {
  if (!isHost || !mediaVideo.duration) return;
  socket.emit('playback-time', { currentTime: mediaVideo.currentTime, duration: mediaVideo.duration });
}, 1000);

mediaVideo.addEventListener('timeupdate', () => {
  if (!isHost || isDraggingSeek) return;
  updateSeekUI(mediaVideo.currentTime, mediaVideo.duration);
});

function updateSeekUI(currentTime, duration) {
  knownDuration = duration || 0;
  currentTimeLabel.textContent = formatTime(currentTime);
  durationLabel.textContent = formatTime(duration);
  if (duration > 0) {
    seekSlider.value = (currentTime / duration) * 100;
  }
}

// Viewers get time updates from the host over the socket
socket.on('playback-time', ({ currentTime, duration }) => {
  if (isHost || isDraggingSeek) return;
  updateSeekUI(currentTime, duration);
});

// Anyone can drag the seek bar; the request is routed to the host
seekSlider.addEventListener('input', () => {
  isDraggingSeek = true;
  currentTimeLabel.textContent = formatTime((seekSlider.value / 100) * knownDuration);
});

seekSlider.addEventListener('change', () => {
  const targetTime = (seekSlider.value / 100) * knownDuration;
  socket.emit('playback-seek', { time: targetTime });
  isDraggingSeek = false;
});

socket.on('playback-seek', ({ time }) => {
  if (!isHost) return;
  mediaVideo.currentTime = time;
});
