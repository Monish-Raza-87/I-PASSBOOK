/* ============================================================
   dataflash.js — ArduPilot DataFlash (.bin) flight log reader

   A plain script, loaded before app.js exactly like vendor/pdf-lib.min.js, and it
   only has to expose window.DataFlash. It parses ENTIRELY in the browser: the
   .bin is never uploaded, so a customer's flight data never leaves the device and
   the Drive store pays nothing for a 100 MB file — the store's cost is per
   OPERATION, and not sending it is the cheapest possible design.

   ── WHY THIS IS WRITTEN RATHER THAN VENDORED ────────────────────────────────

   The obvious library is WilliangalvanI/JsDataflashParser. It is GPL-3.0, and
   this repository is PUBLIC. Vendoring it would relicense the whole project.
   So this is written from the documented format instead, and a later "let's just
   drop in a parser" change must not undo that — the licence is the reason, not
   NIH.

   ── THE FORMAT, AND WHY THE PARSER IS DYNAMIC ───────────────────────────────

   A DataFlash log is a stream of frames:

       [0xA3] [0x95] [type] [payload …]

   and it is SELF-DESCRIBING: the first message in a file is an FMT frame whose
   own payload is a table describing every message that follows —

       FMT, Type, Length, Name, Format, Columns

   `Format` is a string of type characters ("BBnNZ"), `Columns` a comma-separated
   list of field names. So the layout of every message is data in the file, not a
   constant in the code.

   That is not a nicety. VIBE, BAT and RCOU genuinely change their column sets
   between firmware versions — a log written by ArduCopter 4.5 does not have the
   same VIBE as one from 4.3. A parser with hard-coded offsets does not crash on
   the newer file; it silently reports the WRONG NUMBERS, which is far worse for
   the person reading a crash report. Hence: never assume a layout, always read
   the one the file declares, and flag a declaration that does not add up.

   ── MEMORY ──────────────────────────────────────────────────────────────────

   A log can be 100 MB and millions of frames. Nothing per-frame is retained:
   the parameter table accumulates online (count/sum/min/max) and every detector
   keeps only the state it needs to decide (the previous sample, the run in
   progress, a bounded sample of the battery). The only growth with file size is
   the FMT table, which is bounded by the number of distinct message types.
   ============================================================ */

globalThis.DataFlash = (function () {
  'use strict';

  const SYNC0 = 0xA3;
  const SYNC1 = 0x95;
  const FMT_TYPE = 128;
  // FMT's own length, used to bootstrap. Only ever needed for the FIRST frame:
  // the file is required to open with an FMT, and that FMT is what defines every
  // length afterwards. 89 is the documented total (3-byte header + 86 payload).
  const FMT_LEN_BOOTSTRAP = 89;
  const CHUNK_BYTES = 4 * 1024 * 1024;

  // Type characters. Lower case is signed, upper case unsigned, and the letters
  // that carry a fixed-point divisor are listed separately below.
  const SIZES = {
    b: 1, B: 1, h: 2, H: 2, i: 4, I: 4, q: 8, Q: 8,
    f: 4, d: 8, c: 2, C: 2, e: 4, E: 4, L: 4, M: 1,
    n: 4, N: 16, Z: 64, a: 64,
  };
  // The fixed-point types. `L` is a latitude/longitude in 1e-7 degrees.
  const SCALE = { c: 0.01, C: 0.01, e: 0.01, E: 0.01, L: 1e-7 };
  // ── thresholds ──────────────────────────────────────────────────────────────
  // Each one is named, exported and commented, because a number buried in a
  // detector is a number nobody can argue with. Where a value comes from the
  // existing blueprint it says so; where it is a first pass it says that too,
  // rather than implying a precision this does not have.
  const LIMITS = {
    // ArduPilot's own guidance: vibration above 30 m/s/s is the level at which
    // the EKF and the attitude controller start to suffer, and it is the
    // threshold the existing blueprint already used.
    vibe: 30,
    // RCOU is a PWM output. ~1900+ means the controller is asking for everything
    // the motor has; ~1100- means it is pinned at idle (a motor or an ESC that
    // has stopped responding). Either must HOLD to matter — a single sample is a
    // gust, not a fault.
    rcouHigh: 1900,
    rcouLow: 1100,
    rcouRunMs: 500,
    // Attitude. Degrees per second between two consecutive samples: an airframe
    // can tumble fast, but not past 1000 deg/s, and anything over 500 is worth a
    // human looking. The absolute limit catches inverted flight.
    attRateReview: 500,
    attRateFail: 1000,
    attAbsLimit: 90,
    // Altitude. 30 m/s is faster than any of these aircraft descends in control;
    // 50 m across a single sample gap is not a flight, it is a barometer or a
    // GPS glitch.
    altRateMax: 30,
    altStepMax: 50,
    // Battery, all RELATIVE to the pack's own median voltage, so the rules do
    // not need to know how many cells are in series — one absolute threshold
    // would be wrong for a 4S and a 12S alike. These ratios are a first pass.
    batSag: 0.90,
    batBrownout: 0.80,
    batSpike: 2.0,
  };

  // Messages the analyser reads. Anything else is counted and skipped, which is
  // what keeps the memory bound independent of how many message types there are.
  const WATCHED = ['VIBE', 'RCOU', 'ATT', 'BARO', 'GPS', 'BAT', 'POWR', 'ERR', 'MSG', 'VER'];
  const UNITS = {
    VibeX: 'm/s/s', VibeY: 'm/s/s', VibeZ: 'm/s/s',
    Alt: 'm', Press: 'Pa', Spd: 'm/s', NSats: 'sats', Status: 'fix',
    Volt: 'V', Volt2: 'V', Curr: 'A', Vcc: 'V', Vservo: 'V',
    Roll: 'deg', Pitch: 'deg', Yaw: 'deg',
    Lat: 'deg', Lng: 'deg',
  };

  // ── format strings ──────────────────────────────────────────────────────────

  // A format string is a run of type characters, and a type character may carry a
  // repeat count in front of it (`4B` is four uint8s). The columns list then has
  // one name per EXPANDED position — so `4B` with "A,B,C,D" is four columns, not
  // one. Getting this wrong shifts every field after the array, which is the
  // silent-misread failure the whole dynamic approach exists to avoid.
  function parseFormat(str) {
    const fields = [];
    const re = /(\d*)([A-Za-z])/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      if (!n) return null;
      fields.push({ ch: m[2], n });
    }
    return fields.length ? fields : null;
  }

  const fieldCount = fields => fields.reduce((n, f) => n + f.n, 0);

  // The size a field occupies, or 0 if the type character is one this reader does
  // not know. 0 is deliberate: an unknown character must never be guessed a width,
  // because a guessed width silently shifts everything after it.
  const sizeOf = ch => SIZES[ch] || 0;

  function readString(bytes, at, len) {
    let end = at;
    const stop = at + len;
    while (end < stop && bytes[end] !== 0) end++;
    let s = '';
    for (let i = at; i < end; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // ── the parser ──────────────────────────────────────────────────────────────
  //
  // Frame length is `FMT.Length`, which is the TOTAL length including the 3-byte
  // header — so a frame with Length 89 occupies 89 bytes of the file and carries
  // an 86-byte payload. (89 = 3 + 1 + 1 + 4 + 16 + 64, the FMT message itself,
  // which is the arithmetic that proves the convention.)
  function createParser(sink) {
    /** @type {Map<number, {name:string, fields:Array, columns:Array, len:number, bad:string|null}>} */
    const fmts = new Map();
    const counts = new Map();
    const unknownTypes = new Set();
    let carry = new Uint8Array(0);
    let frames = 0;
    let skippedBytes = 0;
    let partialFrame = false;

    function handleFmt(bytes, at, total) {
      // The very first FMT has no declared layout yet; its own is fixed by the
      // spec, so read it directly rather than trying to look it up.
      if (bytes[at + 2] !== FMT_TYPE) return false;
      // Payload begins after the 3-byte header: Type(1) Length(1) Name(4)
      // Format(16) Columns(64) = 86 bytes, so the frame cannot be shorter than 89.
      const p = at + 3;
      if (p + 86 > at + total) return false;
      const type = bytes[p];
      const msgLen = bytes[p + 1];
      const name = readString(bytes, p + 2, 4);
      const format = readString(bytes, p + 6, 16);
      const columns = readString(bytes, p + 22, 64).split(',').map(s => s.trim()).filter(Boolean);
      const fields = parseFormat(format);
      let bad = null;
      if (!fields) bad = 'unreadable format string';
      else {
        const unknown = [...new Set(format.replace(/\d/g, '').split('').filter(c => !sizeOf(c)))];
        if (unknown.length) bad = `unknown type character(s) ${unknown.join(' ')}`;
        else if (fieldCount(fields) !== columns.length) {
          bad = `declares ${fieldCount(fields)} fields but ${columns.length} column names`;
        }
      }
      fmts.set(type, { name, fields, columns, len: msgLen, bad });
      return true;
    }

    function decode(bytes, at, fmt) {
      // The DataView is built with the array's own byteOffset so that every
      // offset below is relative to the array, matching the `bytes[k]` reads
      // readString does. `new DataView(bytes.buffer)` alone would be right only
      // while the array happens to start at the beginning of its buffer.
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = { _name: fmt.name, _t: null };
      let off = at + 3;
      let ci = 0;
      for (const f of fmt.fields) {
        const size = sizeOf(f.ch);
        for (let k = 0; k < f.n; k++) {
          const col = fmt.columns[ci++];
          let v;
          // Each type character is read explicitly. There is deliberately no
          // generic fallback: a character that reached here without a case is a
          // bug in SIZES, and returning 0 for it would put a plausible-looking
          // wrong number into a crash report. The declaration check above has
          // already rejected unknown characters, so this is defence in depth.
          switch (f.ch) {
            case 'b': v = view.getInt8(off); break;
            case 'B': case 'M': v = view.getUint8(off); break;
            case 'h': v = view.getInt16(off, true); break;
            case 'H': v = view.getUint16(off, true); break;
            case 'i': v = view.getInt32(off, true); break;
            case 'I': v = view.getUint32(off, true); break;
            case 'q': v = Number(view.getBigInt64(off, true)); break;
            case 'Q': v = Number(view.getBigUint64(off, true)); break;
            case 'f': v = view.getFloat32(off, true); break;
            case 'd': v = view.getFloat64(off, true); break;
            case 'c': v = view.getInt16(off, true) * SCALE.c; break;
            case 'C': v = view.getUint16(off, true) * SCALE.C; break;
            case 'e': v = view.getInt32(off, true) * SCALE.e; break;
            case 'E': v = view.getUint32(off, true) * SCALE.E; break;
            case 'L': v = view.getInt32(off, true) * SCALE.L; break;
            case 'n': case 'N': case 'Z': v = readString(bytes, off, size); break;
            case 'a': {
              v = [];
              for (let j = 0; j < 32; j++) v.push(view.getInt16(off + j * 2, true));
              break;
            }
            default: v = null;
          }
          if (col) out[col] = v;
          off += size;
        }
      }
      return out;
    }

    // Feed a chunk. Frames split across a chunk boundary are carried, not
    // dropped — including a boundary that lands between the two sync bytes,
    // which is the case a naive `indexOf` scan gets wrong.
    function push(chunk) {
      let bytes;
      if (carry.length) {
        bytes = new Uint8Array(carry.length + chunk.length);
        bytes.set(carry, 0);
        bytes.set(chunk, carry.length);
      } else {
        bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      }

      let pos = 0;
      while (pos + 3 <= bytes.length) {
        // Find the sync pair at or after pos.
        let i = -1;
        for (let k = pos; k + 1 < bytes.length; k++) {
          if (bytes[k] === SYNC0 && bytes[k + 1] === SYNC1) { i = k; break; }
        }
        if (i < 0) {
          skippedBytes += bytes.length - pos;
          break;
        }
        if (i > pos) skippedBytes += i - pos;

        const type = bytes[i + 2];
        const known = fmts.get(type);
        // Bootstrap: with no FMT table yet, FMT itself is the only frame whose
        // length we can know. Its own message defines the rest.
        const len = known ? known.len : (type === FMT_TYPE ? FMT_LEN_BOOTSTRAP : 0);

        if (len < 4) {
          // Unknown type with no declared length: we cannot know where this frame
          // ends, so step past the sync pair and resynchronise on the next one.
          unknownTypes.add(type);
          pos = i + 2;
          continue;
        }
        if (i + len > bytes.length) {
          // The frame runs past what we have. Keep it for the next chunk.
          partialFrame = true;
          pos = i;
          break;
        }

        if (type === FMT_TYPE) handleFmt(bytes, i, len);
        else if (known) {
          counts.set(known.name, (counts.get(known.name) || 0) + 1);
          if (WATCHED.indexOf(known.name) !== -1 && !known.bad) {
            const msg = decode(bytes, i, known);
            if (msg.TimeUS !== undefined) msg._t = msg.TimeUS / 1e6;
            sink(msg);
          } else if (known.bad) {
            counts.set(known.name + ' (unreadable)', (counts.get(known.name + ' (unreadable)') || 0) + 1);
          }
        }
        frames++;
        partialFrame = false;
        pos = i + len;
      }

      // Keep the tail: an incomplete frame, or a trailing 0xA3 that may be the
      // first half of a sync pair whose partner is in the next chunk.
      if (pos < bytes.length) {
        const tail = bytes.slice(pos);
        carry = tail.length > 1 && tail[0] !== SYNC0 ? tail.slice(tail.length - 1) : tail;
      } else {
        carry = new Uint8Array(0);
      }
      if (carry.length === 0) partialFrame = false;
      return { frames, skippedBytes };
    }

    function finish() {
      // A non-empty carry at the end that begins with a sync pair is a frame cut
      // off mid-flight — a truncated file. It is reported, never invented.
      const truncated = carry.length > 3 && carry[0] === SYNC0 && carry[1] === SYNC1;
      return {
        frames,
        skippedBytes,
        truncated,
        fmts,
        counts,
        unknownTypes: [...unknownTypes],
        messages: [...fmts.values()].filter(f => f.bad).map(f => ({ name: f.name, problem: f.bad })),
      };
    }

    return { push, finish };
  }

  // ── online statistics ───────────────────────────────────────────────────────

  function Stats() {
    this.count = 0; this.sum = 0; this.min = Infinity; this.max = -Infinity;
    this.minAt = null; this.maxAt = null;
  }
  Stats.prototype.push = function (v, t) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    this.count++; this.sum += v;
    if (v < this.min) { this.min = v; this.minAt = t; }
    if (v > this.max) { this.max = v; this.maxAt = t; }
  };
  Stats.prototype.mean = function () { return this.count ? this.sum / this.count : null; };

  // A bounded sample, for the battery's median. Keeping every voltage sample of
  // a multi-hour log would grow with the flight; once the cap is hit every second
  // sample is dropped, so the window doubles in span and stays a fair estimate of
  // the median. A median is what makes the battery rules pack-size independent.
  function Sample(cap) { this.cap = cap || 20000; this.arr = []; this.stride = 1; this.seen = 0; }
  Sample.prototype.push = function (v) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    this.seen++;
    if (this.arr.length < this.cap) { this.arr.push(v); return; }
    if (this.seen % this.stride === 0) this.arr[(this.seen / this.stride) % this.cap] = v;
    if (this.arr.length >= this.cap && this.seen % (this.cap * this.stride) === 0) this.stride *= 2;
  };
  Sample.prototype.median = function () {
    if (!this.arr.length) return null;
    const s = this.arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // ── analysis ────────────────────────────────────────────────────────────────

  function analyse(parsed) {
    // No FMT table means no message has a known length, so nothing can be read
    // and a verdict would be a guess. The two cases are distinguished by what the
    // scanner actually SAW, not by `frames`: a frame can only be counted once its
    // length is known, so with no FMT the count is always zero — including for a
    // file that is full of frames. `unknownTypes` is the honest signal, since it
    // is filled exactly when a sync pair was found and the type behind it could
    // not be measured.
    if (!parsed.fmts || !parsed.fmts.size) {
      const sawFrames = !!(parsed.unknownTypes && parsed.unknownTypes.length);
      return {
        ok: false,
        error: sawFrames
          ? 'This file contains DataFlash frames but no FMT header, so the layout of every message is unknown. The FMT block is normally at the very start — check that the whole file was copied.'
          : 'This does not look like an ArduPilot DataFlash log — no frames were found.',
      };
    }

    // `__messages` and `__time` are attached by the entry points that own the
    // per-message sink. Defaulted rather than assumed: a caller that passes a
    // bare parser.finish() should get an analysis, not a TypeError.
    const source = parsed.__messages || [];
    const findings = [];
    const params = new Map();          // "MSG.Column" -> Stats
    // `message` is the DataFlash message the finding came from ('VIBE', 'RCOU',
    // 'BAT'…), or null for a whole-file observation like truncation. It is what
    // lets the report point at the parameter block the finding is about, and it
    // is recorded here rather than inferred from the title later — a title is
    // prose and changes; this is a fact about where the number came from.
    const add = (severity, title, atSeconds, detail, message) =>
      findings.push({
        severity, title,
        atSeconds: atSeconds == null ? null : +atSeconds.toFixed(3),
        detail: detail || '',
        message: message || null,
      });

    // ── VIBE ──
    let vibMax = -Infinity, vibMaxAt = null, vibMaxAxis = null;
    const clip = { Clip0: 0, Clip1: 0, Clip2: 0 };
    let clipSeen = false;
    // ── RCOU ──
    const run = new Map();             // column -> {since, value}
    let lastRcouT = null;
    // ── ATT ──
    let prevAtt = null;
    // ── altitude ──
    let prevAlt = null;
    // ── BAT ──
    const volts = new Sample(), currs = new Sample();
    let batMin = Infinity, batMinAt = null, batMaxCurr = -Infinity, batMaxCurrAt = null;
    // ── firmware faults ──
    const errs = [];
    const msgs = [];
    let firmware = null, vehicle = null;

    const note = (name, col, v, t) => {
      const key = name + '.' + col;
      let s = params.get(key);
      if (!s) { s = new Stats(); params.set(key, s); }
      s.push(v, t);
    };

    for (const msg of source) {
      const name = msg._name;
      const t = msg._t;
      switch (name) {
        case 'VIBE': {
          ['VibeX', 'VibeY', 'VibeZ'].forEach(axis => {
            const v = msg[axis];
            if (typeof v !== 'number') return;
            note('VIBE', axis, v, t);
            if (v > vibMax) { vibMax = v; vibMaxAt = t; vibMaxAxis = axis; }
          });
          ['Clip0', 'Clip1', 'Clip2'].forEach((c, i) => {
            if (typeof msg[c] === 'number') { clipSeen = true; clip[c] = Math.max(clip[c], msg[c]); }
          });
          break;
        }
        case 'RCOU': {
          lastRcouT = t;
          Object.keys(msg).forEach(col => {
            if (!/^C\d+$/.test(col)) return;
            const v = msg[col];
            if (typeof v !== 'number' || !isFinite(v)) return;
            note('RCOU', col, v, t);
            const saturated = v > LIMITS.rcouHigh ? 'high' : (v < LIMITS.rcouLow ? 'low' : null);
            const current = run.get(col);
            if (saturated) {
              if (!current || current.value !== saturated) run.set(col, { since: t, value: saturated });
            } else if (current) {
              // A run ENDS when the channel leaves saturation — and its duration
              // is measured from when it started, not from the last sample.
              const spanMs = (t - current.since) * 1000;
              if (spanMs >= LIMITS.rcouRunMs) {
                add('fail', `Motor output ${col} pinned ${current.value === 'high' ? 'at maximum' : 'at minimum'}`,
                  current.since,
                  `${col} held ${current.value === 'high' ? 'above' : 'below'} ${current.value === 'high' ? LIMITS.rcouHigh : LIMITS.rcouLow} for ${(spanMs / 1000).toFixed(1)} s — the controller was asking for something the output could not deliver.`, 'RCOU');
              }
              run.delete(col);
            }
          });
          break;
        }
        case 'ATT': {
          const roll = msg.Roll !== undefined ? msg.Roll : msg.DesRoll;
          const pitch = msg.Pitch !== undefined ? msg.Pitch : msg.DesPitch;
          note('ATT', 'Roll', roll, t);
          note('ATT', 'Pitch', pitch, t);
          note('ATT', 'Yaw', msg.Yaw, t);
          if (typeof roll === 'number' && typeof pitch === 'number') {
            if (Math.abs(roll) > LIMITS.attAbsLimit || Math.abs(pitch) > LIMITS.attAbsLimit) {
              add('fail', 'Aircraft past vertical', t,
                `roll ${roll.toFixed(1)}°, pitch ${pitch.toFixed(1)}° — beyond ±${LIMITS.attAbsLimit}°, which is inverted or tumbling.`, 'ATT');
            }
            if (prevAtt && t != null && prevAtt.t != null) {
              const dt = t - prevAtt.t;
              if (dt > 0 && dt < 1) {
                const rate = Math.max(Math.abs(roll - prevAtt.roll), Math.abs(pitch - prevAtt.pitch)) / dt;
                if (rate > LIMITS.attRateFail) {
                  add('fail', 'Impossible attitude change', t,
                    `${rate.toFixed(0)} °/s between consecutive samples (${dt.toFixed(3)} s apart). No airframe these logs come from can do that — the usual cause is a corrupted or mismatched sample.`, 'ATT');
                } else if (rate > LIMITS.attRateReview) {
                  add('review', 'Very fast attitude change', t, `${rate.toFixed(0)} °/s sustained between two samples.`, 'ATT');
                }
              }
            }
            if (t != null) prevAtt = { t, roll, pitch };
          }
          break;
        }
        case 'BARO': {
          const alt = msg.Alt;
          note('BARO', 'Alt', alt, t);
          if (typeof alt === 'number') {
            if (prevAlt && t != null && prevAlt.t != null) {
              const dt = t - prevAlt.t;
              const d = alt - prevAlt.alt;
              if (dt > 0 && dt < 2) {
                if (Math.abs(d) > LIMITS.altStepMax) {
                  add('fail', 'Altitude jumped in a single step', t,
                    `${d > 0 ? '+' : ''}${d.toFixed(1)} m across ${dt.toFixed(3)} s. That is a sensor or a gap, not a climb.`, 'BARO');
                } else if (Math.abs(d / dt) > LIMITS.altRateMax) {
                  add('review', 'Altitude changing faster than the aircraft can', t,
                    `${(d / dt).toFixed(1)} m/s over ${dt.toFixed(2)} s.`, 'BARO');
                }
              }
            }
            if (t != null) prevAlt = { t, alt };
          }
          break;
        }
        case 'BAT': {
          if (typeof msg.Volt === 'number' && msg.Volt > 0) {
            volts.push(msg.Volt); note('BAT', 'Volt', msg.Volt, t);
            if (msg.Volt < batMin) { batMin = msg.Volt; batMinAt = t; }
          }
          if (typeof msg.Volt2 === 'number' && msg.Volt2 > 0) note('BAT', 'Volt2', msg.Volt2, t);
          if (typeof msg.Curr === 'number') {
            currs.push(msg.Curr); note('BAT', 'Curr', msg.Curr, t);
            if (msg.Curr > batMaxCurr) { batMaxCurr = msg.Curr; batMaxCurrAt = t; }
          }
          break;
        }
        case 'POWR': { note('POWR', 'Vcc', msg.Vcc, t); note('POWR', 'Vservo', msg.Vservo, t); break; }
        case 'GPS': {
          note('GPS', 'NSats', msg.NSats, t);
          note('GPS', 'Spd', msg.Spd, t);
          break;
        }
        case 'ERR': {
          errs.push({ t, subsys: msg.Subsys, code: msg.ECode });
          break;
        }
        case 'MSG': {
          const text = String(msg.Message == null ? '' : msg.Message);
          if (text) {
            if (!firmware && /(ArduCopter|ArduPlane|ArduRover|ArduSub|APM:Copter|APM:Plane)\s*V?[\d.]+/.test(text)) {
              firmware = (text.match(/(?:APM:)?(ArduCopter|ArduPlane|ArduRover|ArduSub)\s*V?[\d.]+\S*/) || [text])[0].trim();
              vehicle = (firmware.match(/ArduCopter/) ? 'copter' : firmware.match(/ArduPlane/) ? 'plane'
                : firmware.match(/ArduRover/) ? 'rover' : firmware.match(/ArduSub/) ? 'sub' : null);
            }
            msgs.push({ t, text });
          }
          break;
        }
        default: break;
      }
    }

    // ── findings that need the whole run ──────────────────────────────────────

    if (vibMax > LIMITS.vibe) {
      add(vibMax > LIMITS.vibe * 2 ? 'fail' : 'review', 'Excessive vibration', vibMaxAt,
        `Peak ${vibMax.toFixed(1)} m/s/s on ${vibMaxAxis} against a ${LIMITS.vibe} m/s/s limit. Vibration at this level degrades the attitude estimate and is a common cause of unexplained loss of control.`, 'VIBE');
    }
    if (clipSeen && (clip.Clip0 || clip.Clip1 || clip.Clip2)) {
      add('review', 'Accelerometer clipping', null,
        `Clip counters — ${clip.Clip0}/${clip.Clip1}/${clip.Clip2}. A non-zero count means the accelerometer hit its limit, so the attitude estimate was wrong for the moments it did.`, 'VIBE');
    }
    // A channel still saturated when the log ends never got its closing edge.
    run.forEach((st, col) => {
      if (lastRcouT != null && (lastRcouT - st.since) * 1000 >= LIMITS.rcouRunMs) {
        add('fail', `Motor output ${col} still pinned at the end of the log`, st.since,
          `${col} was ${st.value === 'high' ? 'at maximum' : 'at minimum'} for the last ${((lastRcouT - st.since)).toFixed(1)} s of the recording.`, 'RCOU');
      }
    });
    if (errs.length) {
      add('fail', 'Firmware reported errors', errs[0].t,
        `${errs.length} ERR message${errs.length > 1 ? 's' : ''}. The first was subsystem ${errs[0].subsys}, code ${errs[0].code}. The full list is in the report below.`, 'ERR');
    }
    const badMsgs = msgs.filter(m => /error|fail|failsafe|crash|ekf|bad |unhealthy|imbalanced|thrust/i.test(m.text));
    if (badMsgs.length) {
      add('review', 'Firmware status messages worth reading', badMsgs[0].t,
        badMsgs.slice(0, 3).map(m => m.text).join(' · '), 'MSG');
    }

    const vMed = volts.median();
    if (vMed && batMin < Infinity) {
      const ratio = batMin / vMed;
      if (ratio < LIMITS.batBrownout) {
        add('fail', 'Battery voltage collapsed', batMinAt,
          `Fell to ${batMin.toFixed(2)} V, ${(ratio * 100).toFixed(0)}% of this flight's median of ${vMed.toFixed(2)} V. A drop this deep browns out the flight controller and the ESCs.`, 'BAT');
      } else if (ratio < LIMITS.batSag) {
        add('review', 'Deep battery sag', batMinAt,
          `Lowest ${batMin.toFixed(2)} V against a median of ${vMed.toFixed(2)} V (${(ratio * 100).toFixed(0)}%). Worth checking against the pack's age and the load at that moment.`, 'BAT');
      }
    }
    const cMed = currs.median();
    if (cMed && batMaxCurr > 0 && batMaxCurr > cMed * LIMITS.batSpike) {
      add('review', 'Current spike', batMaxCurrAt,
        `Peak ${batMaxCurr.toFixed(1)} A against a median of ${cMed.toFixed(1)} A. Sustained current well above the norm is how an ESC or a motor ends up failing.`, 'BAT');
    }

    if (parsed.truncated) {
      add('review', 'The log is truncated', null,
        'The last frame is cut off mid-message, so the recording ends early. If the flight ended in a crash, that is exactly where the useful data stopped — check whether the file was copied completely.');
    }
    parsed.messages.forEach(m => {
      add('review', `${m.name} could not be read`, null,
        `The file declares this message's layout as ${m.problem}. Its values are excluded from the report rather than guessed at.`, m.name);
    });
    if (parsed.unknownTypes.length) {
      add('info', 'Message types with no definition', null,
        `Types ${parsed.unknownTypes.join(', ')} appeared without a preceding FMT, so their length is unknown and they were skipped. This is normal for the first frames after a mid-flight log restart.`);
    }

    // ── verdict ───────────────────────────────────────────────────────────────
    const worst = findings.reduce((w, f) =>
      f.severity === 'fail' ? 'FAIL' : (f.severity === 'review' && w !== 'FAIL' ? 'REVIEW' : w), 'PASS');

    const times = parsed.__time;
    const duration = times && times.count ? (times.max - times.min) : null;

    const parameters = [...params.entries()].map(([key, s]) => {
      const dot = key.indexOf('.');
      const col = key.slice(dot + 1);
      return {
        message: key.slice(0, dot), column: col,
        unit: UNITS[col] || '',
        count: s.count,
        min: s.min === Infinity ? null : +s.min.toFixed(3),
        max: s.max === -Infinity ? null : +s.max.toFixed(3),
        mean: s.mean() == null ? null : +s.mean().toFixed(3),
      };
    }).sort((a, b) => a.message.localeCompare(b.message) || a.column.localeCompare(b.column));

    return {
      ok: true,
      verdict: worst,
      meta: {
        firmware: firmware || 'not reported in this log',
        vehicle,
        durationSeconds: duration == null ? null : +duration.toFixed(1),
        frames: parsed.frames,
        skippedBytes: parsed.skippedBytes,
        truncated: !!parsed.truncated,
        messages: [...parsed.counts.entries()].map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      },
      findings: findings.sort((a, b) => {
        const rank = { fail: 0, review: 1, info: 2 };
        return rank[a.severity] - rank[b.severity] || (a.atSeconds == null ? -1 : a.atSeconds) - (b.atSeconds == null ? -1 : b.atSeconds);
      }),
      parameters,
    };
  }

  // ── entry points ────────────────────────────────────────────────────────────

  // Everything in memory. Used by the tests, and by small logs.
  //
  // `chunkSize` feeds the same bytes through the STREAMING path in slices
  // instead of in one push. It exists so the carry logic — including a frame
  // split between the two sync bytes — is exercised by the same entry point the
  // file reader uses, rather than only being reachable from a browser.
  function analyseBuffer(bytes, chunkSize) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const messages = [];
    const time = new Stats();
    const parser = createParser(msg => {
      messages.push(msg);
      if (typeof msg.TimeUS === 'number') time.push(msg.TimeUS / 1e6, msg.TimeUS / 1e6);
    });
    if (chunkSize > 0) {
      for (let at = 0; at < u8.length; at += chunkSize) parser.push(u8.slice(at, Math.min(at + chunkSize, u8.length)));
    } else {
      parser.push(u8);
    }
    const parsed = parser.finish();
    parsed.__messages = messages;
    parsed.__time = time;
    return analyse(parsed);
  }

  // Streamed. A 100 MB log must never become a 100 MB string or a 100 MB
  // Uint8Array — phones run out of memory and the tab dies with no error worth
  // reading. So the file is read in 4 MB slices and only the parser's own state
  // is kept.
  async function analyseFile(file, onProgress) {
    const messages = [];
    const time = new Stats();
    const parser = createParser(msg => {
      messages.push(msg);
      if (typeof msg.TimeUS === 'number') time.push(msg.TimeUS / 1e6, msg.TimeUS / 1e6);
    });
    const total = file.size || 0;
    let at = 0;
    while (at < total) {
      const slice = file.slice(at, Math.min(at + CHUNK_BYTES, total));
      const buf = await slice.arrayBuffer();
      parser.push(new Uint8Array(buf));
      at += CHUNK_BYTES;
      if (onProgress) onProgress(Math.min(1, at / total));
    }
    const parsed = parser.finish();
    parsed.__messages = messages;
    parsed.__time = time;
    return analyse(parsed);
  }

  return {
    VERSION: '1.0.0',
    LIMITS,
    WATCHED,
    parseFormat,
    createParser,
    analyseBuffer,
    analyseFile,
  };
})();
