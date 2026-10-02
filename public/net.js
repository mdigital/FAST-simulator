// Multiplayer: a WebSocket to server.js, which relays messages between
// everyone in the same room (?room=name, default "lobby").
//
// Events (EventTarget): 'welcome', 'join', 'leave', 'peers', and one per
// message type ('pose', 'stool', 'scene', 'touch', 'tool', ...), with the
// message (including `from`, the sender's id) as event.detail.

export class Net extends EventTarget {
  constructor({ room = 'lobby', name = '' } = {}) {
    super();
    this.room = room;
    this.name = name;
    this.id = null;
    this.peers = new Map(); // id -> { id, name, colour }
    this.connected = false;
    this.ws = null;
    this.retry = 0;
  }

  /** Only when served by server.js (it hosts the relay), unless ?ws= is given. */
  static available() {
    const q = new URLSearchParams(location.search);
    if (q.has('solo')) return false;
    return q.has('ws') || location.pathname.startsWith('/__fastsim/');
  }

  connect() {
    const q = new URLSearchParams(location.search);
    const base = q.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__fastsim/ws`;
    const ws = (this.ws = new WebSocket(`${base}?room=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.name)}`));
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        this.connected = true;
        this.retry = 0;
        this.peers = new Map(msg.peers.map((p) => [p.id, p]));
        this.emit('welcome', msg);
        this.emit('peers', [...this.peers.values()]);
        for (const cached of msg.cache || []) this.emit(cached.t, cached); // world state so far
        return;
      }
      if (msg.t === 'join') { this.peers.set(msg.peer.id, msg.peer); this.emit('peers', [...this.peers.values()]); }
      if (msg.t === 'leave') { this.peers.delete(msg.id); this.emit('peers', [...this.peers.values()]); }
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this.peers.clear();
      if (was) this.emit('peers', []);
      // Reconnect with backoff (server restarts, Wi-Fi blips).
      setTimeout(() => this.connect(), Math.min(10000, 1000 * 2 ** this.retry++));
    };
  }

  send(msg) {
    if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
  }
}
