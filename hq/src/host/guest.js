/* @zoria/kit :: hq/guest
   guest wrapper: window.ZARIA_HQ from postMessage envelopes

   Contract - `part3/01-hq-contract.md`, section 2. The show lives in a frame with
   an opaque origin, so the only door outward is postMessage;
   this wrapper turns the correspondence into an object the HQ works with like
   an ordinary data source.

   No network requests at all: recording files are requested by the host, not the browser. Not
   a single dependency: the file goes into the participant's bundle as is.

   Foreign messages are silently skipped (2.1): anything can land in the frame -
   browser extensions, neighboring libraries, debuggers. */

const V = 1;
const HELLO_WAIT_MS = 2000;

function envelope(type, rest) {
  const m = { zaria: V, type: type };
  for (const k of Object.keys(rest || {})) m[k] = rest[k];
  return m;
}

/* the host is whoever opened us: the frame's parent, or the opener for our own window */
function hostWindow() {
  if (typeof window === 'undefined') return null;
  if (window.parent && window.parent !== window) return window.parent;
  return window.opener || null;
}

class ZariaHQ {
  constructor(name) {
    this.v = V;
    this.mode = 'none';
    this.lang = 'uk';
    this.hq = name;
    this._packs = [];
    this._cap = 0;
    this._live = null;
    this._subs = new Map();
    this._files = new Map();
    this._promotes = new Map();
    this._seq = 0;
    this._host = hostWindow();
    this._opened = null;
  }

  /* ---- what the HQ sees ---- */

  packs() {
    return this._packs.slice();
  }

  cap() {
    return this._cap;
  }

  /* broadcast: manifest, hall, roster, tick count and focus spot. null in a recording */
  live() {
    return this._live;
  }

  on(type, fn) {
    let set = this._subs.get(type);
    if (!set) {
      set = new Set();
      this._subs.set(type, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  ready(t) {
    this._send('ready', { t: Number(t) || 0 });
  }

  file(id, name) {
    const key = id + '\u0000' + name;
    const had = this._files.get(key);
    if (had) return had.promise;
    let ok;
    let bad;
    const promise = new Promise((res, rej) => {
      ok = res;
      bad = rej;
    });
    this._files.set(key, { promise: promise, ok: ok, bad: bad });
    this._send('file', { id: id, name: name });
    return promise;
  }

  promote(preset) {
    const id = ++this._seq;
    let ok;
    const promise = new Promise((res) => {
      ok = res;
    });
    this._promotes.set(id, ok);
    this._send('promote', { id: id, preset: preset });
    return promise;
  }

  /* ---- internal ---- */

  _send(type, rest) {
    if (!this._host) return;
    /* '*' is deliberate: the frame has an opaque origin, and there's nothing to call it by.
       There's no secret in our messages - it's a request for show data */
    this._host.postMessage(envelope(type, rest), '*');
  }

  _emit(type, payload) {
    const set = this._subs.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
        /* the show's subscriber isn't our concern, but we can't stay silent about it */
        setTimeout(() => {
          throw e;
        }, 0);
      }
    }
  }

  _accept(msg) {
    if (!msg || msg.zaria !== V || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'lang':
        /* two languages, uk (the default) and en; anything else falls back to uk */
        this.lang = msg.lang === 'en' ? 'en' : 'uk';
        this._emit('lang', this.lang);
        return;
      case 'record':
        this.mode = 'record';
        this._packs = Array.isArray(msg.packs) ? msg.packs.slice() : [];
        this._cap = 0;
        this._settle();
        this._emit('record', this.packs());
        return;
      case 'live':
        this.mode = 'live';
        this._live = {
          manifest: msg.manifest,
          bots: msg.bots,
          roster: msg.roster,
          ticks: msg.ticks,
          seat: msg.seat,
        };
        this._cap = 0;
        this._settle();
        this._emit('live', this._live);
        return;
      case 'tick':
        this._cap = Math.max(this._cap, Number(msg.t) || 0);
        this._emit('tick', msg);
        return;
      case 'end':
        this._emit('end', msg);
        return;
      case 'promote-result': {
        const ok = this._promotes.get(msg.id);
        if (!ok) return;
        this._promotes.delete(msg.id);
        ok({ ok: !!msg.ok, status: msg.status, detail: msg.detail });
        this._emit('promote-result', msg);
        return;
      }
      case 'file-data': {
        const key = msg.id + '\u0000' + msg.name;
        const w = this._files.get(key);
        if (!w) return;
        this._files.delete(key);
        w.ok(msg.bytes);
        return;
      }
      case 'file-error': {
        const key = msg.id + '\u0000' + msg.name;
        const w = this._files.get(key);
        if (!w) return;
        this._files.delete(key);
        w.bad(new Error(String(msg.why || 'file not served')));
        return;
      }
      default:
        /* a foreign type - silently skip past (2.1) */
        return;
    }
  }

  _settle() {
    if (this._opened) {
      const ok = this._opened;
      this._opened = null;
      ok(this);
    }
  }
}

/* open a conversation with the host. Returns a promise that resolves when
   the feed (record or live) has arrived - or after 2 seconds of silence with mode
   "none": there may be no host, and the show then works on its own (2.7).

   window.ZARIA_HQ is set IMMEDIATELY, before any waiting: the HQ, which
   subscribes to events bypassing the promise, needs the object starting from the first line. */
export function openHost(opts) {
  const o = opts || {};
  const hq = new ZariaHQ(String(o.hq || 'hq').slice(0, 64));
  if (typeof window !== 'undefined') window.ZARIA_HQ = hq;
  if (typeof window === 'undefined') return Promise.resolve(hq);
  window.addEventListener('message', (e) => {
    if (hq._host && e.source !== hq._host) return;
    hq._accept(e.data);
  });
  const promise = new Promise((ok) => {
    hq._opened = ok;
  });
  hq._send('hello', { v: V, hq: hq.hq });
  const wait = o.waitMs === undefined ? HELLO_WAIT_MS : o.waitMs;
  const timer = setTimeout(() => hq._settle(), wait);
  return promise.then((v) => {
    clearTimeout(timer);
    return v;
  });
}
