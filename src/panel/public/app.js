'use strict';
// Painel local do DJ Seraphine. Vanilla JS, sem dependências. Dados do servidor sempre entram
// pelo textContent (nunca innerHTML).

const $ = (id) => document.getElementById(id);
const LEVELS = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
const LOG_MAX = 2000;
const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

let csrf = null;
let snapshot = null;
let selectedGuild = readPreference('guild');
let events = null;
let channelsCache = { guildId: null, text: [], voice: [] };
let draggedId = null;
let toastTimer = null;
const logEntries = [];

// --------------------------------------------------------------- utilidades

function readPreference(key) {
  try { return localStorage.getItem(`dj.${key}`); } catch { return null; }
}

function writePreference(key, value) {
  try { localStorage.setItem(`dj.${key}`, value); } catch { /* sem armazenamento: ignora */ }
}

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;
  for (const [key, value] of Object.entries(options.attrs || {})) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

function duration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '??:??';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Mensagens do servidor vêm em markdown do Discord; no painel, texto puro. */
function plain(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/<#(\d+)>/g, (_, id) => {
      const channel = [...channelsCache.text, ...channelsCache.voice].find((c) => c.id === id);
      return channel ? `#${channel.name}` : '#canal';
    })
    .replace(/\*\*|`/g, '')
    .replace(/\\([\\*_~`|[\]()>#-])/g, '$1');
}

function toast(message, kind = 'ok') {
  const box = $('toast');
  box.textContent = plain(message);
  box.className = `toast ${kind}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let response;
  try {
    response = await fetch(path, {
      method, headers, credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'Sem conexão com o bot.' } };
  }
  let data = {};
  try { data = await response.json(); } catch { /* corpo vazio */ }
  if (response.status === 401 && path !== '/api/login') showLogin();
  return { ok: response.ok && data.ok !== false, status: response.status, data };
}

// --------------------------------------------------------------- login

function showLogin() {
  if (events) { events.close(); events = null; }
  csrf = null;
  $('app-view').hidden = true;
  $('login-view').hidden = false;
  $('login-token').focus();
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  const result = await api('/api/login', { method: 'POST', body: { token: $('login-token').value } });
  $('login-token').value = '';
  if (!result.ok) {
    $('login-error').textContent = result.data.error || 'Falha no login.';
    return;
  }
  csrf = result.data.csrf;
  start();
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

function start() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  connect();
}

function connect() {
  if (events) events.close();
  events = new EventSource('/api/events');
  events.addEventListener('state', (event) => {
    snapshot = JSON.parse(event.data);
    snapshot.receivedAt = Date.now();
    render();
  });
  events.addEventListener('logs', (event) => {
    logEntries.length = 0;
    logEntries.push(...JSON.parse(event.data));
    renderLogs();
  });
  events.addEventListener('log', (event) => appendLog(JSON.parse(event.data)));
  events.addEventListener('error', async () => {
    // EventSource reconecta sozinho; se a sessão caiu, volta para o login.
    const session = await api('/api/session');
    if (session.ok && !session.data.authenticated) showLogin();
  });
}

// --------------------------------------------------------------- estado

function currentGuild() {
  if (!snapshot) return null;
  return snapshot.guilds.find((g) => g.id === selectedGuild) || snapshot.guilds[0] || null;
}

function estimatedPosition(guild) {
  if (!guild || !guild.current) return 0;
  if (guild.status !== 'playing') return guild.positionSec;
  const elapsed = (Date.now() - snapshot.at) / 1000;
  const position = guild.positionSec + elapsed * guild.speed;
  return guild.current.durationSec ? Math.min(position, guild.current.durationSec) : position;
}

function render() {
  renderBot();
  renderTabs();
  const guild = currentGuild();
  if (guild && guild.id !== channelsCache.guildId) loadChannels(guild.id);
  renderGuild(guild);
  renderLogGuilds();
}

function renderBot() {
  const bot = snapshot.bot;
  const line = $('bot-status');
  line.replaceChildren(
    el('span', {}, [el('span', { className: `dot ${bot.ready ? 'on' : ''}` }), bot.ready ? 'gateway conectado' : 'gateway fora']),
    el('span', { text: bot.user || '' }),
    el('span', { attrs: { id: 'uptime' }, text: `no ar há ${duration((Date.now() - bot.startedAt) / 1000)}` }),
    el('span', { text: `yt-dlp ${bot.ytdlpVersion || '?'}` }),
    el('span', { text: `${bot.children} processo(s) yt-dlp/ffmpeg` }),
  );
}

function renderTabs() {
  const tabs = $('guild-tabs');
  const current = currentGuild();
  tabs.replaceChildren(...snapshot.guilds.map((guild) => {
    const button = el('button', { text: guild.name, className: current && guild.id === current.id ? 'active' : '' });
    button.addEventListener('click', () => {
      selectedGuild = guild.id;
      writePreference('guild', guild.id);
      render();
    });
    return button;
  }));
}

const STATUS_LABELS = { playing: 'tocando', paused: 'pausado', idle: 'parado', disconnected: 'fora do canal' };

function renderGuild(guild) {
  const connected = Boolean(guild && guild.status !== 'disconnected');
  $('join-box').hidden = !guild || connected;
  const badge = $('player-badge');
  badge.textContent = guild ? STATUS_LABELS[guild.status] : '—';
  badge.className = `badge ${guild ? guild.status : ''}`;
  $('session-info').textContent = connected
    ? `🔊 ${guild.voiceChannel ? guild.voiceChannel.name : '?'} · avisos em #${guild.textChannel ? guild.textChannel.name : '?'}`
    : '';

  const current = guild && guild.current;
  $('now').hidden = !current;
  if (current) {
    $('now-thumb').src = `https://i.ytimg.com/vi/${encodeURIComponent(current.id)}/mqdefault.jpg`;
    $('now-title').textContent = current.title;
    $('now-title').href = current.url;
    $('now-meta').textContent = [current.uploader, current.requestedBy].filter(Boolean).join(' · ');
  }
  $('progress').classList.toggle('disabled', !current || !current.durationSec);
  $('time-total').textContent = current ? duration(current.durationSec) : '0:00';
  updateProgress();

  for (const button of document.querySelectorAll('.controls button, [data-action="shuffle"], [data-action="clear"]')) {
    button.disabled = !connected;
  }
  $('toggle-pause').textContent = guild && guild.status === 'paused' ? '▶️' : '⏸️';
  $('toggle-pause').disabled = !current;

  for (const id of ['volume', 'loop', 'filter', 'autoplay']) $(id).disabled = !guild;
  if (guild) {
    if (document.activeElement !== $('volume')) $('volume').value = guild.volume;
    $('volume-label').textContent = `${guild.volume}%`;
    $('loop').value = guild.loop;
    $('filter').value = guild.filter;
    $('autoplay').checked = guild.autoplay;
  }
  renderQueue(guild);
}

function updateProgress() {
  const guild = currentGuild();
  const current = guild && guild.current;
  const position = estimatedPosition(guild);
  $('time-now').textContent = duration(current ? position : 0);
  const ratio = current && current.durationSec ? Math.min(1, position / current.durationSec) : 0;
  $('progress-fill').style.width = `${(ratio * 100).toFixed(2)}%`;
  const uptime = $('uptime');
  if (uptime && snapshot) uptime.textContent = `no ar há ${duration((Date.now() - snapshot.bot.startedAt) / 1000)}`;
}

setInterval(() => { if (snapshot) updateProgress(); }, 500);

// --------------------------------------------------------------- ações (otimistas)

/**
 * Aplica `optimistic` numa cópia do estado e mostra na hora; envia a ação. Se o bot recusar,
 * volta para o último estado real do servidor. O SSE traz o estado definitivo logo em seguida.
 */
async function act(action, optimistic) {
  const guild = currentGuild();
  if (!guild) return;
  if (optimistic) {
    const draft = structuredClone(guild);
    optimistic(draft);
    renderGuild(draft);
  }
  const result = await api(`/api/guilds/${guild.id}/actions`, { method: 'POST', body: action });
  if (!result.ok) {
    toast(result.data.error || 'Falhou.', 'error');
    renderGuild(currentGuild());
    return;
  }
  if (result.data.message) toast(result.data.message);
}

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    const type = button.dataset.action;
    const destructive = { stop: 'Parar a música e limpar a fila?', leave: 'Tirar o bot do canal (descarta a fila)?', clear: 'Limpar a fila?' };
    if (destructive[type] && !confirm(destructive[type])) return;
    const optimistic = {
      stop: (g) => { g.queue = []; g.current = null; g.status = 'idle'; },
      clear: (g) => { g.queue = []; },
      leave: (g) => { g.status = 'disconnected'; g.current = null; g.queue = []; },
    }[type];
    act({ type }, optimistic);
  });
}

$('toggle-pause').addEventListener('click', () => {
  const guild = currentGuild();
  if (!guild) return;
  const pausing = guild.status === 'playing';
  act({ type: pausing ? 'pause' : 'resume' }, (g) => {
    g.positionSec = estimatedPosition(guild);
    g.status = pausing ? 'paused' : 'playing';
  });
});

$('volume').addEventListener('input', () => { $('volume-label').textContent = `${$('volume').value}%`; });
$('volume').addEventListener('change', () => {
  const level = Number($('volume').value);
  act({ type: 'volume', level }, (g) => { g.volume = level; });
});
$('loop').addEventListener('change', () => {
  const mode = $('loop').value;
  act({ type: 'loop', mode }, (g) => { g.loop = mode; });
});
$('filter').addEventListener('change', () => {
  const filter = $('filter').value;
  act({ type: 'filter', filter }, (g) => { g.filter = filter; });
});
$('autoplay').addEventListener('change', () => {
  const enabled = $('autoplay').checked;
  act({ type: 'autoplay', enabled }, (g) => { g.autoplay = enabled; });
});

$('progress').addEventListener('click', (event) => {
  const guild = currentGuild();
  const current = guild && guild.current;
  if (!current || !current.durationSec) return;
  const rect = $('progress').getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const positionSec = Math.min(Math.floor(ratio * current.durationSec), current.durationSec - 1);
  act({ type: 'seek', positionSec });
});

$('join-button').addEventListener('click', () => {
  const voiceChannelId = $('join-voice').value;
  const textChannelId = $('join-text').value;
  if (!voiceChannelId || !textChannelId) return toast('Escolha o canal de voz e o de avisos.', 'error');
  act({ type: 'join', voiceChannelId, textChannelId });
});

$('add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = $('add-query').value.trim();
  if (!query) return;
  const button = event.submitter;
  if (button) button.disabled = true;
  await act({ type: 'add', query, mode: $('add-mode').value });
  if (button) button.disabled = false;
  $('add-query').value = '';
});

// --------------------------------------------------------------- fila

function moveLocally(queue, id, beforeId) {
  const from = queue.findIndex((t) => t.qid === id);
  if (from === -1) return;
  const [item] = queue.splice(from, 1);
  const to = beforeId === null ? queue.length : queue.findIndex((t) => t.qid === beforeId);
  queue.splice(to === -1 ? queue.length : to, 0, item);
}

function sendMove(id, beforeId) {
  if (id === beforeId) return;
  act({ type: 'move', id, beforeId }, (g) => moveLocally(g.queue, id, beforeId));
}

function renderQueue(guild) {
  const list = $('queue');
  const queue = guild ? guild.queue : [];
  const total = queue.reduce((sum, t) => sum + (t.durationSec || 0), 0);
  $('queue-summary').textContent = `${queue.length} faixa(s) · ${duration(total)}`;
  if (queue.length === 0) {
    list.replaceChildren(el('li', { className: 'empty', text: 'A fila está vazia.' }));
    return;
  }
  list.replaceChildren(...queue.map((track, index) => {
    const up = el('button', { text: '▲', title: 'Subir' });
    const down = el('button', { text: '▼', title: 'Descer' });
    const jump = el('button', { text: '⏩', title: 'Pular até esta' });
    const remove = el('button', { text: '✕', title: 'Remover', className: 'danger' });
    up.disabled = index === 0;
    down.disabled = index === queue.length - 1;
    up.addEventListener('click', () => sendMove(track.qid, queue[index - 1].qid));
    down.addEventListener('click', () => sendMove(track.qid, index + 2 < queue.length ? queue[index + 2].qid : null));
    jump.addEventListener('click', () => act({ type: 'skipto', id: track.qid }, (g) => {
      const at = g.queue.findIndex((t) => t.qid === track.qid);
      if (at === -1) return;
      g.current = g.queue[at];
      g.queue = g.queue.slice(at + 1);
      g.positionSec = 0;
    }));
    remove.addEventListener('click', () => act({ type: 'remove', id: track.qid }, (g) => {
      g.queue = g.queue.filter((t) => t.qid !== track.qid);
    }));

    const item = el('li', { attrs: { draggable: 'true', 'data-id': track.qid } }, [
      el('span', { className: 'pos', text: String(index + 1) }),
      el('div', {}, [
        el('div', { className: 'title', text: track.title, title: track.title }),
        el('div', { className: 'who', text: `${duration(track.durationSec)} · ${track.requestedBy}` }),
      ]),
      el('div', { className: 'item-actions' }, [up, down, jump, remove]),
    ]);
    item.addEventListener('dragstart', (event) => {
      draggedId = track.qid;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      draggedId = null;
      item.classList.remove('dragging');
    });
    item.addEventListener('dragover', (event) => {
      if (!draggedId) return;
      event.preventDefault();
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      item.classList.remove('drop-target');
      if (!draggedId || draggedId === track.qid) return;
      // Metade de baixo do item = soltar depois dele.
      const rect = item.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const beforeId = after ? (queue[index + 1] ? queue[index + 1].qid : null) : track.qid;
      sendMove(draggedId, beforeId);
    });
    return item;
  }));
}

// --------------------------------------------------------------- canais e mensagens

async function loadChannels(guildId) {
  channelsCache = { guildId, text: [], voice: [] };
  const result = await api(`/api/guilds/${guildId}/channels`);
  if (!result.ok || channelsCache.guildId !== guildId) return;
  channelsCache = { guildId, text: result.data.text, voice: result.data.voice };
  const fill = (select, channels, prefix) => {
    const previous = select.value;
    select.replaceChildren(...channels.map((c) => el('option', { text: `${prefix}${c.name}`, attrs: { value: c.id } })));
    if (channels.some((c) => c.id === previous)) select.value = previous;
  };
  fill($('join-voice'), channelsCache.voice, '🔊 ');
  fill($('join-text'), channelsCache.text, '#');
  fill($('message-channel'), channelsCache.text, '#');
}

$('message-content').addEventListener('input', () => {
  $('message-count').textContent = String($('message-content').value.length);
});
$('embed-toggle').addEventListener('change', () => { $('embed-fields').hidden = !$('embed-toggle').checked; });

$('message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const guild = currentGuild();
  if (!guild) return;
  const resultLine = $('message-result');
  resultLine.textContent = 'Enviando…';
  resultLine.className = 'small muted';
  const body = {
    channelId: $('message-channel').value,
    content: $('message-content').value,
    replyTo: $('message-reply').value.trim() || null,
    allowMentions: $('message-mentions').checked,
    embed: $('embed-toggle').checked
      ? { title: $('embed-title').value, description: $('embed-description').value, color: $('embed-color').value }
      : null,
  };
  const result = await api(`/api/guilds/${guild.id}/messages`, { method: 'POST', body });
  if (!result.ok) {
    resultLine.textContent = result.data.error || 'Falha ao enviar.';
    resultLine.className = 'small error';
    return;
  }
  const link = el('a', { text: 'abrir no Discord', attrs: { target: '_blank', rel: 'noopener noreferrer' } });
  if (/^https:\/\/(\w+\.)?discord\.com\//.test(result.data.url)) link.href = result.data.url;
  resultLine.replaceChildren('✅ Enviada — ', link);
  resultLine.className = 'small ok';
  $('message-content').value = '';
  $('message-count').textContent = '0';
});

// --------------------------------------------------------------- logs

function renderLogGuilds() {
  const select = $('log-guild');
  const previous = select.value;
  select.replaceChildren(
    el('option', { text: 'todos os servidores', attrs: { value: '' } }),
    ...snapshot.guilds.map((g) => el('option', { text: g.name, attrs: { value: g.id } })),
  );
  select.value = previous;
}

function fieldsText(fields) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'guildId') continue;
    if (key === 'err' && value && typeof value === 'object') parts.push(`err=${value.message || value.type || 'erro'}`);
    else parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return parts.join(' ');
}

function matches(entry) {
  if (entry.level < Number($('log-level').value)) return false;
  const guild = $('log-guild').value;
  if (guild && entry.guildId !== guild) return false;
  const text = $('log-text').value.trim().toLowerCase();
  if (text && !`${entry.msg} ${fieldsText(entry.fields)}`.toLowerCase().includes(text)) return false;
  return true;
}

function logLine(entry) {
  const level = LEVELS[entry.level] || String(entry.level);
  const time = new Date(entry.time);
  const stamp = `${timeFormat.format(time)}.${String(time.getMilliseconds()).padStart(3, '0')}`;
  return el('div', { className: `log-line l-${level}` }, [
    el('span', { className: 'time', text: `${stamp} ` }),
    el('span', { className: 'level', text: level.toUpperCase() }),
    el('span', { text: `${entry.msg} ` }),
    el('span', { className: 'fields', text: fieldsText(entry.fields) }),
  ]);
}

function scrollLogs() {
  if (!$('log-pause').checked) $('logs').scrollTop = $('logs').scrollHeight;
}

function renderLogs() {
  $('logs').replaceChildren(...logEntries.filter(matches).map(logLine));
  scrollLogs();
}

function appendLog(entry) {
  logEntries.push(entry);
  if (logEntries.length > LOG_MAX) logEntries.splice(0, logEntries.length - LOG_MAX);
  if (!matches(entry)) return;
  const box = $('logs');
  box.append(logLine(entry));
  while (box.childElementCount > LOG_MAX) box.firstElementChild.remove();
  scrollLogs();
}

for (const id of ['log-level', 'log-guild']) $(id).addEventListener('change', renderLogs);
$('log-text').addEventListener('input', renderLogs);
$('log-pause').addEventListener('change', scrollLogs);

// --------------------------------------------------------------- início

(async () => {
  const session = await api('/api/session');
  if (session.ok && session.data.authenticated) {
    csrf = session.data.csrf;
    start();
  } else {
    showLogin();
  }
})();
