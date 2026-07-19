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

// ============ Participants ============
const participantList = document.getElementById('participantList');
socket.on('participants-update', (names) => {
  participantList.innerHTML = '';
  names.forEach((n) => {
    const li = document.createElement('li');
    li.textContent = n;
    participantList.appendChild(li);
  });
});

// ============ Chat ============
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
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

// ============ Reactions ============
const reactionLayer = document.getElementById('reactionLayer');
document.querySelectorAll('.reaction-btn').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('reaction', btn.dataset.emoji));
});
socket.on('reaction', ({ emoji }) => {
  const el = document.createElement('span');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = `${20 + Math.random() * 60}%`;
  reactionLayer.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

// ============ Invite link ============
document.getElementById('copyLinkBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => alert('Invite link copied! Send it to a friend.'));
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ Menu bar ============
const mediaMenuBtn = document.getElementById('mediaMenuBtn');
const mediaDropdown = document.getElementById('mediaDropdown');
const menuStopSharing = document.getElementById('menuStopSharing');

mediaMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  mediaDropdown.classList.toggle('open');
});
document.addEventListener('click', () => mediaDropdown.classList.remove('open'));
mediaDropdown.addEventListener('click', (e) => e.stopPropagation());

// ============ Source input modal (YouTube / Twitch / URL) ============
const sourceModal = document.getElementById('sourceModal');
const sourceModalTitle = document.getElementById('sourceModalTitle');
const sourceModalInput = document.getElementById('sourceModalInput');
const sourceModalCancel = document.getElementById('sourceModalCancel');
const sourceModalConfirm = document.getElementById('sourceModalConfirm');
let pendingSourceType = null;

function openSourceModal(type, title, placeholder) {
  pendingSourceType = type;
  sourceModalTitle.textContent = title;
  sourceModalInput.placeholder = placeholder;
  sourceModalInput.value = '';
  sourceModal.style.display = 'flex';
  sourceModalInput.focus();
  mediaDropdown.classList.remove('open');
}
sourceModalCancel.addEventListener('click', () => { sourceModal.style.display = 'none'; });

document.getElementById('menuOpenYoutube').addEventListener('click', () =>
  openSourceModal('youtube', 'Open YouTube Link', 'https://youtube.com/watch?v=...'));
document.getElementById('menuOpenTwitch').addEventListener('click', () =>
  openSourceModal('twitch', 'Open Twitch Link', 'https://twitch.tv/channelname or a VOD link'));
document.getElementById('menuOpenUrl').addEventListener('click', () =>
  openSourceModal('url', 'Open Direct Video URL', 'https://example.com/video.mp4'));

sourceModalConfirm.addEventListener('click', () => {
  const value = sourceModalInput.value.trim();
  if (!value) return;
  sourceModal.style.display = 'none';

  if (pendingSourceType === 'youtube') {
    const videoId = extractYoutubeId(value);
    if (!videoId) { alert('Could not read a YouTube video ID from that link.'); return; }
    socket.emit('start-remote-source', { sourceType: 'youtube', sourceData: { videoId } });
  } else if (pendingSourceType === 'twitch') {
    const twitchData = extractTwitchData(value);
    if (!twitchData) { alert('Could not read a Twitch channel or video from that link.'); return; }
    socket.emit('start-remote-source', { sourceType: 'twitch', sourceData: twitchData });
  } else if (pendingSourceType === 'url') {
    socket.emit('start-remote-source', { sourceType: 'url', sourceData: { url: value } });
  }
});

function extractYoutubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[\w-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

function extractTwitchData(url) {
  const vodMatch = url.match(/twitch\.tv\/videos\/(\d+)/);
  if (vodMatch) return { videoId: vodMatch[1], isVod: true };
  const channelMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
  if (channelMatch) return { channel: channelMatch[1], isVod: false };
  if (/^[a-zA-Z0-9_]+$/.test(url.trim())) return { channel: url.trim(), isVod: false };
  return null;
}

// ============ Shared player state ============
const mediaVideo = document.getElementById('mediaVideo');
const youtubeDiv = document.getElementById('youtubePlayer');
const twitchDiv = document.getElementById('twitchPlayer');
const placeholderText = document.getElementById('placeholderText');
const playerControls = document.getElementById('playerControls');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const playPauseBtn = document.getElementById('playPauseBtn');
const hostLabel = document.getElementById('hostLabel');
const volumeSlider = document.getElementById('volumeSlider');
const seekSlider = document.getElementById('seekSlider');
const currentTimeLabel = document.getElementById('currentTimeLabel');
const durationLabel = document.getElementById('durationLabel');

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let isHost = false;
let sourceType = null; // 'file' | 'youtube' | 'twitch' | 'url'
let localStream = null;
const hostPeers = {};
let viewerPeer = null;
let ytPlayer = null;
let ytReady = false;
let twitchPlayerObj = null;
let knownIsPlaying = true;
let knownDuration = 0;
let isDraggingSeek = false;

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showPlayerActive() {
  placeholderText.style.display = 'none';
  playerControls.style.display = 'flex';
}

function resetPlayerUI() {
  isHost = false;
  sourceType = null;

  mediaVideo.pause();
  mediaVideo.removeAttribute('src');
  mediaVideo.srcObject = null;
  mediaVideo.style.display = 'none';
  mediaVideo.load();

  youtubeDiv.style.display = 'none';
  youtubeDiv.innerHTML = '';
  ytPlayer = null;

  twitchDiv.style.display = 'none';
  twitchDiv.innerHTML = '';
  twitchPlayerObj = null;

  placeholderText.style.display = 'flex';
  playerControls.style.display = 'none';
  hostLabel.textContent = '';
  menuStopSharing.style.display = 'none';

  Object.values(hostPeers).forEach((pc) => pc.close());
  for (const k in hostPeers) delete hostPeers[k];
  if (viewerPeer) { viewerPeer.close(); viewerPeer = null; }

  seekSlider.value = 0;
  currentTimeLabel.textContent = '0:00';
  durationLabel.textContent = '0:00';

  subtitleTrack.src = '';
  ccBtn.style.display = 'none';
  ccBtn.classList.remove('cc-active');
}

function closeAllPeerConnections() {
  Object.values(hostPeers).forEach((pc) => pc.close());
  for (const k in hostPeers) delete hostPeers[k];
  if (viewerPeer) { viewerPeer.close(); viewerPeer = null; }
}

volumeSlider.addEventListener('input', () => {
  const v = volumeSlider.value / 100;
  mediaVideo.volume = v;
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(volumeSlider.value);
  if (twitchPlayerObj && twitchPlayerObj.setVolume) twitchPlayerObj.setVolume(v);
});

// ============ FILE MODE (WebRTC) ============
document.getElementById('filePicker').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  mediaDropdown.classList.remove('open');

  // Clean up any previous share (old file, old peer connections, old remote embeds)
  // before starting a new one — this is what caused the "flip" glitch on file switch.
  closeAllPeerConnections();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  youtubeDiv.innerHTML = ''; youtubeDiv.style.display = 'none'; ytPlayer = null;
  twitchDiv.innerHTML = ''; twitchDiv.style.display = 'none'; twitchPlayerObj = null;

  isHost = true;
  sourceType = 'file';
  mediaVideo.style.display = 'block';
  mediaVideo.pause();
  const url = URL.createObjectURL(file);
  mediaVideo.src = url;
  mediaVideo.muted = false;
  mediaVideo.play();

  mediaVideo.onloadedmetadata = () => {
    localStream = mediaVideo.captureStream ? mediaVideo.captureStream() : mediaVideo.mozCaptureStream();
    socket.emit('start-sharing');
  };

  showPlayerActive();
  menuStopSharing.style.display = 'block';
  hostLabel.textContent = 'You are sharing';
});

document.getElementById('menuStopSharing').addEventListener('click', () => {
  socket.emit('stop-sharing');
  resetPlayerUI();
});

socket.on('new-viewer', ({ viewerId }) => {
  if (!localStream) return;
  const pc = new RTCPeerConnection(rtcConfig);
  hostPeers[viewerId] = pc;
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-ice-candidate', { to: viewerId, candidate: e.candidate }); };
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer).then(() => offer))
    .then((offer) => socket.emit('webrtc-offer', { to: viewerId, offer }));
});

socket.on('webrtc-offer', ({ from, offer }) => {
  if (viewerPeer) { viewerPeer.close(); viewerPeer = null; }
  const pc = new RTCPeerConnection(rtcConfig);
  viewerPeer = pc;
  pc.ontrack = (e) => {
    mediaVideo.style.display = 'block';
    mediaVideo.srcObject = e.streams[0];
    mediaVideo.play();
  };
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-ice-candidate', { to: from, candidate: e.candidate }); };
  pc.setRemoteDescription(offer)
    .then(() => pc.createAnswer())
    .then((answer) => pc.setLocalDescription(answer).then(() => answer))
    .then((answer) => socket.emit('webrtc-answer', { to: from, answer }));
});

socket.on('webrtc-answer', ({ from, answer }) => { const pc = hostPeers[from]; if (pc) pc.setRemoteDescription(answer); });
socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
  const pc = isHost ? hostPeers[from] : viewerPeer;
  if (pc) pc.addIceCandidate(candidate).catch(() => {});
});

// ============ REMOTE SOURCES (YouTube / Twitch / URL) ============
let currentIsTwitchVod = false;

socket.on('remote-source-loaded', ({ sourceType: st, sourceData, hostName, startTime }) => {
  sourceType = st;
  showPlayerActive();
  hostLabel.textContent = isHost ? 'You loaded this video' : `${hostName} loaded a video`;
  menuStopSharing.style.display = isHost ? 'block' : 'none';

  mediaVideo.style.display = 'none';
  youtubeDiv.style.display = 'none';
  twitchDiv.style.display = 'none';

  const seed = startTime || 0;

  if (st === 'youtube') {
    youtubeDiv.style.display = 'block';
    loadYoutubePlayer(sourceData.videoId, seed);
    ccBtn.style.display = 'flex';
  } else if (st === 'twitch') {
    twitchDiv.style.display = 'block';
    currentIsTwitchVod = !!sourceData.isVod;
    loadTwitchPlayer(sourceData, seed);
    ccBtn.style.display = 'none';
  } else if (st === 'url') {
    mediaVideo.style.display = 'block';
    mediaVideo.src = sourceData.url;
    mediaVideo.addEventListener('loadedmetadata', () => {
      if (seed > 0) mediaVideo.currentTime = seed;
    }, { once: true });
    mediaVideo.play().catch(() => {});
    ccBtn.style.display = 'none';
  }
});

function loadYoutubePlayer(videoId, seed) {
  youtubeDiv.innerHTML = '<div id="ytTarget"></div>';
  function create() {
    ytPlayer = new YT.Player('ytTarget', {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, start: Math.floor(seed || 0) },
      events: {
        onReady: (e) => {
          if (seed > 0) e.target.seekTo(seed, true);
          e.target.playVideo();
        },
      },
    });
  }
  if (window.YT && window.YT.Player) create();
  else window.onYouTubeIframeAPIReady = create;
}

function loadTwitchPlayer(data, seed) {
  twitchDiv.innerHTML = '<div id="twitchTarget" style="width:100%;height:100%;"></div>';
  const opts = { width: '100%', height: '100%', parent: [window.location.hostname] };
  if (data.isVod) opts.video = data.videoId;
  else opts.channel = data.channel;
  twitchPlayerObj = new Twitch.Player('twitchTarget', opts);
  if (data.isVod && seed > 0) {
    twitchPlayerObj.addEventListener(Twitch.Player.READY, () => twitchPlayerObj.seek(seed));
  }
}

socket.on('host-changed', ({ hostId: hId, hostName, sourceType: st }) => {
  isHost = (hId === socket.id);
  if (isHost) return;
  if (!sourceType) {
    placeholderText.querySelector('.no-signal').textContent = `CONNECTING TO ${hostName.toUpperCase()}...`;
  }
});

socket.on('host-stopped', () => {
  if (!isHost) resetPlayerUI();
});

// ============ Playback control (play/pause/seek, unified across modes) ============
playPauseBtn.addEventListener('click', () => {
  const action = knownIsPlaying ? 'pause' : 'play';
  socket.emit('playback-control', { action });
});

socket.on('playback-control', ({ action }) => {
  if (sourceType === 'file') {
    if (!isHost) return;
    if (action === 'pause') mediaVideo.pause(); else mediaVideo.play();
  } else if (sourceType === 'youtube' && ytPlayer) {
    if (action === 'pause') ytPlayer.pauseVideo(); else ytPlayer.playVideo();
    setPlayingUI(action === 'play');
  } else if (sourceType === 'twitch' && twitchPlayerObj) {
    if (action === 'pause') twitchPlayerObj.pause(); else twitchPlayerObj.play();
    setPlayingUI(action === 'play');
  } else if (sourceType === 'url') {
    if (action === 'pause') mediaVideo.pause(); else mediaVideo.play();
  }
});

function setPlayingUI(isPlaying) {
  knownIsPlaying = isPlaying;
  playIcon.style.display = isPlaying ? 'none' : 'block';
  pauseIcon.style.display = isPlaying ? 'block' : 'none';
}

mediaVideo.addEventListener('play', () => {
  setPlayingUI(true);
  if (isHost && sourceType === 'file') socket.emit('playback-state', { isPlaying: true });
});
mediaVideo.addEventListener('pause', () => {
  setPlayingUI(false);
  if (isHost && sourceType === 'file') socket.emit('playback-state', { isPlaying: false });
});

socket.on('playback-state', ({ isPlaying }) => setPlayingUI(isPlaying));

// --- Seeking ---
setInterval(() => {
  if (!isHost) return;
  if (sourceType === 'file' && mediaVideo.duration) {
    socket.emit('playback-time', { currentTime: mediaVideo.currentTime, duration: mediaVideo.duration });
  } else if (sourceType === 'youtube' && ytPlayer && ytPlayer.getDuration) {
    const d = ytPlayer.getDuration();
    if (d) socket.emit('playback-time', { currentTime: ytPlayer.getCurrentTime(), duration: d });
  } else if (sourceType === 'twitch' && twitchPlayerObj && twitchPlayerObj.getDuration) {
    const d = twitchPlayerObj.getDuration();
    if (d) socket.emit('playback-time', { currentTime: twitchPlayerObj.getCurrentTime(), duration: d });
  }
}, 1000);

mediaVideo.addEventListener('timeupdate', () => {
  if (isDraggingSeek) return;
  if (sourceType === 'url' || (sourceType === 'file' && isHost)) {
    updateSeekUI(mediaVideo.currentTime, mediaVideo.duration);
  }
});

function updateSeekUI(currentTime, duration) {
  knownDuration = duration || 0;
  currentTimeLabel.textContent = formatTime(currentTime);
  durationLabel.textContent = formatTime(duration);
  if (duration > 0) seekSlider.value = Math.min(1000, (currentTime / duration) * 1000);
}

socket.on('playback-time', ({ currentTime, duration }) => {
  if (isHost || isDraggingSeek) return;
  updateSeekUI(currentTime, duration);
  correctDrift(currentTime);
});

// Viewers' YouTube/Twitch/URL players are independent — without this, they'd
// slowly drift apart from the host with no way to catch up.
const DRIFT_THRESHOLD_SECONDS = 1.5;

function correctDrift(hostTime) {
  if (sourceType === 'youtube' && ytPlayer && ytPlayer.getCurrentTime) {
    const diff = Math.abs(ytPlayer.getCurrentTime() - hostTime);
    if (diff > DRIFT_THRESHOLD_SECONDS) ytPlayer.seekTo(hostTime, true);
  } else if (sourceType === 'twitch' && currentIsTwitchVod && twitchPlayerObj && twitchPlayerObj.getCurrentTime) {
    const diff = Math.abs(twitchPlayerObj.getCurrentTime() - hostTime);
    if (diff > DRIFT_THRESHOLD_SECONDS) twitchPlayerObj.seek(hostTime);
  } else if (sourceType === 'url' && mediaVideo.duration) {
    const diff = Math.abs(mediaVideo.currentTime - hostTime);
    if (diff > DRIFT_THRESHOLD_SECONDS) mediaVideo.currentTime = hostTime;
  }
}

seekSlider.addEventListener('input', () => {
  isDraggingSeek = true;
  currentTimeLabel.textContent = formatTime((seekSlider.value / 1000) * knownDuration);
});

seekSlider.addEventListener('change', () => {
  const targetTime = (seekSlider.value / 1000) * knownDuration;
  socket.emit('playback-seek', { time: targetTime });
  isDraggingSeek = false;
});

socket.on('playback-seek', ({ time }) => {
  if (sourceType === 'file' && isHost) mediaVideo.currentTime = time;
  else if (sourceType === 'youtube' && ytPlayer) ytPlayer.seekTo(time, true);
  else if (sourceType === 'twitch' && twitchPlayerObj) twitchPlayerObj.seek(time);
  else if (sourceType === 'url') mediaVideo.currentTime = time;
});

// ============ Fullscreen ============
const playerShell = document.querySelector('.player-shell');
const fullscreenBtn = document.getElementById('fullscreenBtn');

fullscreenBtn.addEventListener('click', () => {
  const inFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
  if (!inFullscreen) {
    if (playerShell.requestFullscreen) playerShell.requestFullscreen();
    else if (playerShell.webkitRequestFullscreen) playerShell.webkitRequestFullscreen();
    else if (mediaVideo.webkitEnterFullscreen) mediaVideo.webkitEnterFullscreen(); // iOS Safari fallback
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
});

// ============ Subtitles ============
const subtitleTrack = document.getElementById('subtitleTrack');
const ccBtn = document.getElementById('ccBtn');
let subtitlesEnabled = true;

document.getElementById('subtitlePicker').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  mediaDropdown.classList.remove('open');
  let text = await file.text();
  if (!text.trim().startsWith('WEBVTT')) text = srtToVtt(text);
  socket.emit('load-subtitles', { vttText: text });
});

function srtToVtt(srt) {
  let vtt = 'WEBVTT\n\n' + srt.replace(/\r+/g, '');
  vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt;
}

socket.on('subtitle-loaded', ({ vttText }) => {
  const blob = new Blob([vttText], { type: 'text/vtt' });
  subtitleTrack.src = URL.createObjectURL(blob);
  if (mediaVideo.textTracks[0]) mediaVideo.textTracks[0].mode = subtitlesEnabled ? 'showing' : 'hidden';
  if (sourceType === 'file' || sourceType === 'url') ccBtn.style.display = 'flex';
});

ccBtn.addEventListener('click', () => {
  subtitlesEnabled = !subtitlesEnabled;
  ccBtn.classList.toggle('cc-active', subtitlesEnabled);
  if (mediaVideo.textTracks[0]) mediaVideo.textTracks[0].mode = subtitlesEnabled ? 'showing' : 'hidden';
  if (sourceType === 'youtube' && ytPlayer) {
    if (subtitlesEnabled) {
      if (ytPlayer.loadModule) ytPlayer.loadModule('captions');
      if (ytPlayer.setOption) ytPlayer.setOption('captions', 'track', {});
    } else if (ytPlayer.unloadModule) {
      ytPlayer.unloadModule('captions');
    }
  }
});
