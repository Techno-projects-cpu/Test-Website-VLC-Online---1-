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
