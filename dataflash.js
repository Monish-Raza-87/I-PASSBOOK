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
  // ── WHAT IS ALLOWED TO BE IN THIS FILE ──────────────────────────────────────
  //
  // This file is served from a public website, so it may hold ONLY numbers that
  // are already published somewhere a stranger can read. In practice that means
  // ArduPilot's own documentation, cited at each line below, plus the first-pass
  // ratios this reader has always used.
  //
  // Every number INDROVES gave us is deliberately NOT here. Those are operating
  // data, and they live in the private Drive store instead — written by the Log
  // limits panel and read back through `resolveRules` below. Adding one here
  // would publish it, so `TUNED` is the list of keys that must never gain a value
  // in this file.
  const LIMITS = {
    // Vibration. ArduPilot's published guidance (Common Measuring Vibration):
    // "Vibration levels below 30m/s/s are normally acceptable", and levels "above
    // 60m/s/s nearly always have problems with position or altitude hold".
    //
    // Those two figures are the default for EVERY axis here, and they are the
    // only vibration numbers in this file on purpose: X and Y are not Z, and the
    // per-axis limits that recognise that are Indrones' own — they arrive from
    // the store, not from here.
    //
    // `vibe` is kept as the X/Y fail level for any older caller still reading it.
    vibe: 30,
    vibeXYReview: 30,
    vibeXYFail: 60,
    vibeZReview: 30,
    vibeZFail: 60,
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

    // Current: ArduPilot's SHAPE, not an airframe's numbers. BATT_LOW_TIMER is
    // the documented period a battery condition must PERSIST before the failsafe
    // acts, and its default is 10 seconds. So a spike is never a fault and a
    // condition that holds is — which is the half of the rule that is public.
    // The airframe's own current limits are in the store (see TUNED).
    curHoldMs: 10000,

    // GPS. ArduPilot's own published guidance, which Indrones confirmed.
    hdopReview: 1.5,
    hdopFail: 2.0,
  };

  // ── the numbers that must NOT live in this file ─────────────────────────────
  //
  // One list, because a number in two places is a number that will disagree with
  // itself. This is BOTH the panel's field list AND the contract for what
  // `resolveRules` will accept from the store — and it is the list a reviewer
  // should check this file against before it ships.
  //
  // `pub` is what the field starts from where a figure is already public
  // (ArduPilot's); `null` means no figure has ever been published, so the field
  // starts EMPTY, and an empty field means NO GATE AT ALL. That is the safe
  // reading of "we have not agreed a limit": the log is shown and not failed.
  //
  // `perAirframe: true` marks a field that describes ONE AIRCRAFT rather than a
  // limit everyone can share — a pack's cell count, in practice. See the top of
  // `resolveRules` for why the shared default may not set one.
  const TUNED = [
    // ── the pack itself: what the aircraft IS, not a limit on it ─────────────
    //
    // These two exist for exactly one reason, and it is not decoration: a voltage
    // is only comparable between two aircraft once it is PER CELL. This fleet is
    // 4S in one airframe and 6S in another, so the same 21 V is a healthy pack on
    // one and 3.5 V/cell — nearly empty — on the other. A single pack-level number
    // would therefore be wrong for one of them by construction, and the reader
    // cannot divide by a cell count it does not know. So declaring the pack is the
    // PREREQUISITE for any voltage rule: without it there is no per-cell figure to
    // apply a rule to.
    //
    // Nothing in this group is a limit. It cannot fail a log, it is not scored,
    // and a blank one costs nothing but the readout. `pub: null` because no cell
    // count has ever been published.
    //
    // Both fields are the FINISHED number rather than a component of one. A "packs
    // in parallel" and a "cell mAh" would have had to be multiplied, and a fleet
    // where one airframe carries one pack and another carries two in parallel
    // makes that count ambiguous to type — an ambiguity that surfaces as a
    // plausible-looking, wrong percentage. So the pack's capacity is entered whole,
    // all batteries together, and nothing is multiplied here.
    { group: 'The pack — read from this, never scored', key: 'cellsSeries', label: 'Cells in series',       unit: 'S',   pub: null, min: 1, perAirframe: true, none: 'not recorded' },
    { group: 'The pack — read from this, never scored', key: 'packMah',     label: 'Capacity, all packs',   unit: 'mAh', pub: null, min: 1, perAirframe: true, none: 'not recorded' },
    { group: 'Vibration', key: 'vibeXYReview', label: 'X and Y — watch above', unit: 'm/s²', pub: 30 },
    { group: 'Vibration', key: 'vibeXYFail',   label: 'X and Y — fail above',  unit: 'm/s²', pub: 60 },
    { group: 'Vibration', key: 'vibeZReview',  label: 'Z — watch above',       unit: 'm/s²', pub: 30 },
    { group: 'Vibration', key: 'vibeZFail',    label: 'Z — fail above',        unit: 'm/s²', pub: 60, min: 1 },
    { group: 'Current',   key: 'curReview',    label: 'Watch above',           unit: 'A',    pub: null },
    { group: 'Current',   key: 'curFail',      label: 'Fail above',            unit: 'A',    pub: null },
    { group: 'Current',   key: 'curHoldMs',    label: 'Only if held for',      unit: 'ms',   pub: 10000, min: 1000 },
    { group: 'Motors',    key: 'pwmSpread',    label: 'Most the motors may differ by', unit: 'µs', pub: null },
    { group: 'Attitude',  key: 'attTrack',     label: 'Commanded vs achieved', unit: '°',    pub: null },
    { group: 'GPS',       key: 'hdopReview',   label: 'Watch above',           unit: '',     pub: 1.5 },
    { group: 'GPS',       key: 'hdopFail',     label: 'Fail above',           unit: '',     pub: 2.0 },
    { group: 'Reporting', key: 'scoreWobble',  label: 'Score may drift by',    unit: 'pts',  pub: null },
  ];

  // Build the rules one log is scored against: this file's public defaults, then
  // the store's profile for the airframe, then the store's `__default__` profile
  // underneath it. Precedence is deliberate — the most specific wins, and a
  // value of null or '' means "no limit agreed", which REMOVES the default rather
  // than falling back to it. Without that a blank field would quietly inherit a
  // number nobody chose.
  //
  // Never throws. A store file that has been hand-edited into nonsense resolves
  // to the public defaults, because a malformed config must not take the
  // analyser down with it.
  function resolveRules(config, airframe) {
    const out = Object.assign({}, LIMITS);
    let profiles = null;
    if (config && typeof config === 'object' && config.profiles && typeof config.profiles === 'object') {
      profiles = config.profiles;
    }
    const name = airframe && profiles && profiles[airframe] ? String(airframe) : '';
    const defaultLayer = (profiles && profiles.__default__) ? profiles.__default__ : null;
    const layers = [];
    if (defaultLayer) layers.push(defaultLayer);
    if (name) layers.push(profiles[name]);
    layers.forEach(src => {
      if (!src || typeof src !== 'object') return;
      // A limit can be shared; an AIRCRAFT cannot. `perAirframe` fields (the pack's
      // cell count) describe one machine, so the shared default is not allowed to
      // set them — a 4S default silently picked up by a 6S airframe would divide
      // the pack voltage by the wrong number and produce a per-cell figure that
      // looks entirely reasonable and is wrong. Refusing the layer means the
      // airframe that has not declared its pack simply gets no per-cell readout,
      // which is a missing number rather than a false one.
      const fromDefault = (src === defaultLayer);
      TUNED.forEach(f => {
        if (f.perAirframe && fromDefault) return;
        if (!Object.prototype.hasOwnProperty.call(src, f.key)) return;
        const v = src[f.key];
        if (v === null || v === '') delete out[f.key];
        else if (typeof v === 'number' && isFinite(v)) out[f.key] = v;
      });
    });
    // What the report says it was scored against, so a number on screen can
    // always be traced to the profile that produced it.
    out.airframe = name;
    out.profile = name || (layers.length ? 'the default profile' : 'built-in defaults');
    return out;
  }

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

  function analyse(parsed, rules) {
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
          // VALUES ONLY. This case used to judge vibration and clipping as well,
          // and it no longer does: both rules changed on 2026-10-06 and both are
          // decided in scoreFlightLog below, so that one condition is reported
          // once rather than twice. The axis limits there are per-axis (X and Y
          // are not Z, and they never were), and clipping there is a count a
          // human accepts or rejects rather than a flat review. What stays here
          // is the per-column ledger the numbers table is built from.
          ['VibeX', 'VibeY', 'VibeZ'].forEach(axis => {
            if (typeof msg[axis] === 'number') note('VIBE', axis, msg[axis], t);
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

    // VIBRATION AND CLIPPING ARE NOT REPORTED HERE ANY MORE. Both moved into
    // scoreFlightLog below, which is called before the verdict is folded, so
    // they still decide it. They moved because BOTH rules changed on 2026-10-06
    // and two detectors reporting one condition is a bug whatever the numbers:
    //   - vibration is now PER AXIS (X and Y are read against their own pair of
    //     limits, Z against a different pair), where this block applied one
    //     threshold to every axis;
    //   - clipping is now a count a human accepts or rejects, with a climbing
    //     count the signal that matters, where this block raised a flat review.
    // Deleting the old pair rather than editing it is deliberate: leaving either
    // one alive would report the same fault twice.
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

    // Indrones' own rules — the second pass. Merged in BEFORE the verdict is
    // folded so its observations can decide it, and it reads the RCOU findings
    // above rather than measuring motor saturation twice. See scoreFlightLog.
    const scored = scoreFlightLog(parsed, findings, rules);

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
      score: scored.score,
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
  function analyseBuffer(bytes, chunkSize, rules) {
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
    return analyse(parsed, rules);
  }

  // Streamed. A 100 MB log must never become a 100 MB string or a 100 MB
  // Uint8Array — phones run out of memory and the tab dies with no error worth
  // reading. So the file is read in 4 MB slices and only the parser's own state
  // is kept.
  async function analyseFile(file, onProgress, rules) {
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
    return analyse(parsed, rules);
  }

  // ═══ Indrones' own rules ═══════════════════════════════════════════════════
  //
  // A SECOND pass over the same decoded frames, kept separate from the detectors
  // in `analyse` so that nothing which already worked had to be rewritten. It
  // turns them into a subscore per area and one overall number, and it reports
  // the observations that carry a DECISION for a human rather than a number.
  //
  // Every NUMBER this pass uses arrives in `rules` — built by resolveRules from
  // the public defaults in this file and the store's profile for the airframe.
  // NOTHING Indrones gave us is written below, because this file is published:
  // see TUNED for the keys that must stay out of it. Where no number has been
  // agreed, NONE is invented — the area is reported and left unscored, and it
  // appears in `open` so the gap is visible rather than silently averaged away.
  //
  // The method is the desktop analyser's, as Indrones asked (Q14, "same as the
  // legacy analyser"): an area scores 100 x (fraction of samples inside the
  // REVIEW level), less a magnitude penalty that reaches 100 at the FAIL level.
  // An area with only one agreed level (attitude error, PWM spread) gets the
  // proportion alone — no second number is invented to complete the formula.
  // The total is the PLAIN MEAN of the areas actually measured, so vibration,
  // which has three of them, carries the most weight — exactly as it does in the
  // tool this replaces.
  //
  // Comparing two logs of one airframe: drift of no more than the configured
  // wobble is noise; anything larger must name the area that moved.
  // Full-charge cell voltage for the Li-ion chemistry these packs use — a
  // published constant of the cell, not an Indrones figure, and the same 4.2 V for
  // every airframe in the fleet. It is here only to turn a cell count into a pack
  // voltage on the report ("25.2 V full" beside "6S"); it gates nothing.
  const CELL_FULL_V = 4.2;

  // The pack, reduced to the three numbers the report actually uses. Every input
  // is optional and an absent one yields null rather than a guess: a wrong cell
  // count is worse than a missing one, because it produces a plausible number.
  function packInfo(R) {
    const num = v => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
    const series = num(R && R.cellsSeries);
    const packMah = num(R && R.packMah);
    return {
      series, packMah,
      fullPack: series ? series * CELL_FULL_V : null,
    };
  }

  function scoreFlightLog(parsed, findings, rules) {
    // The numbers this log is judged against: the public defaults, overlaid with
    // whatever the store's profile for this airframe says. An absent key means no
    // gate was agreed, and every threshold below is therefore read as "is there
    // one?" before it is compared to anything.
    const R = rules || LIMITS;
    // What the declared pack lets us SAY about a reading — and nothing more. Every
    // input is a fact about the aircraft (cells in series, packs in parallel, cell
    // capacity) and every output is arithmetic on those facts. There is no rule
    // here and nothing here can fail a log; it is only what turns a number into one
    // that can be COMPARED with another aircraft's.
    const pack = packInfo(R);
    const source = parsed.__messages || [];
    const out = [];
    const add = (severity, title, atSeconds, detail, message) =>
      findings.push({
        severity, title,
        atSeconds: atSeconds == null ? null : +atSeconds.toFixed(3),
        detail: detail || '',
        message: message || null,
      });

    // 100 x fraction inside `review`, less a penalty reaching 100 at `fail`.
    // Used wherever we have a SERIES of samples to count.
    const subscore = (over, n, worst, review, fail) => {
      if (!n) return null;
      let s = 100 * (1 - over / n);
      if (worst != null && fail != null && fail > review && worst > review) {
        s -= Math.min(100, (100 * (worst - review)) / (fail - review));
      }
      return Math.max(0, Math.round(s));
    };
    // 100 at or below `review`, 0 at or beyond `fail`. Used where the rule is
    // about ONE number that must be HELD, so there is no sample series to count.
    const ratioScore = (worst, review, fail) => {
      if (worst == null || !isFinite(worst)) return null;
      if (worst <= review) return 100;
      if (worst >= fail) return 0;
      return Math.round((100 * (fail - worst)) / (fail - review));
    };

    // ── accumulators ─────────────────────────────────────────────────────────
    const axis = {
      VibeX: { hi: null, at: null, over: 0, n: 0 },
      VibeY: { hi: null, at: null, over: 0, n: 0 },
      VibeZ: { hi: null, at: null, over: 0, n: 0 },
    };
    // A RUNNING MAXIMUM across the whole flight and all three IMUs. The desktop
    // analyser reads only the LAST Vibe sample and only IMU 1, so a clip early in
    // a flight is invisible to it — we had the same shape of bug in the rate
    // detectors below, kept only because they are not what this scores.
    const clip = { Clip0: 0, Clip1: 0, Clip2: 0 };
    let clipFirstAt = null, clipLastRiseAt = null;
    let vMin = null, vMinAt = null;
    let curPeak = null, curPeakAt = null, curSustained = null, curSustainedAt = null;
    let mahUsed = null, curPrevT = null, curPrevV = null;
    const curWindow = [];                        // samples inside the hold period
    let att = { hi: null, at: null, over: 0, n: 0 };
    const pwm = new Map();                       // channel -> { sum, n }
    let hdop = { hi: null, at: null, over: 0, n: 0 };

    const wrap180 = d => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

    for (let i = 0; i < source.length; i++) {
      const msg = source[i];
      const t = msg._t;

      if (msg._name === 'VIBE') {
        ['VibeX', 'VibeY', 'VibeZ'].forEach(a => {
          const v = msg[a];
          if (typeof v !== 'number' || !isFinite(v)) return;
          const s = axis[a];
          s.n++;
          // X and Y are the arms the airframe pushes against; Z is what the props
          // load, so the two pairs are read separately. Both come from the
          // resolved rules — this file carries only ArduPilot's 30/60 for each.
          // A rule with no value leaves `review` undefined, and `v > undefined`
          // is always false, so an un-agreed limit counts nothing as over.
          const review = a === 'VibeZ' ? R.vibeZReview : R.vibeXYReview;
          if (v > review) s.over++;
          if (s.hi == null || v > s.hi) { s.hi = v; s.at = t; }
        });
        ['Clip0', 'Clip1', 'Clip2'].forEach(c => {
          const v = msg[c];
          if (typeof v !== 'number' || !isFinite(v)) return;
          if (v > clip[c]) {
            clip[c] = v;
            if (v > 0) { if (clipFirstAt == null) clipFirstAt = t; clipLastRiseAt = t; }
          }
        });

      } else if (msg._name === 'BAT') {
        if (typeof msg.Volt === 'number' && isFinite(msg.Volt) && msg.Volt > 0) {
          if (vMin == null || msg.Volt < vMin) { vMin = msg.Volt; vMinAt = t; }
        }
        const c = msg.Curr;
        if (typeof c === 'number' && isFinite(c)) {
          if (curPeak == null || c > curPeak) { curPeak = c; curPeakAt = t; }
          // Energy drawn, integrated by trapezoid so an uneven log rate cannot
          // skew it. Reported, never gated — Indrones will set the threshold.
          if (curPrevT != null && t != null && t > curPrevT) {
            mahUsed = (mahUsed || 0) + ((curPrevV + c) / 2) * (t - curPrevT) * (1000 / 3600);
          }
          curPrevT = t; curPrevV = c;

          // "Held for N seconds", not a spike. The value we score is the highest
          // one that EVERY sample in a window of that length stayed above, so a
          // single sample cannot qualify and a real overload does.
          //
          // ArduPilot gates a battery on a condition held for 10 s
          // (BATT_LOW_TIMER). The duration is a store value like the limits
          // themselves, because Indrones overrode it for current on 2026-10-06;
          // the SHAPE — hold, not spike — is ArduPilot's and does not move.
          if (t != null) {
            curWindow.push({ t: t, v: c });
            const hold = (R.curHoldMs != null ? R.curHoldMs : LIMITS.curHoldMs) / 1000;
            if (t - curWindow[0].t >= hold) {
              let lo = Infinity;
              for (let k = 0; k < curWindow.length; k++) {
                if (t - curWindow[k].t <= hold && curWindow[k].v < lo) lo = curWindow[k].v;
              }
              if (isFinite(lo) && (curSustained == null || lo > curSustained)) {
                curSustained = lo; curSustainedAt = t;
              }
            }
            while (curWindow.length && t - curWindow[0].t > hold * 2) curWindow.shift();
          }
        }

      } else if (msg._name === 'ATT') {
        // COMMANDED vs ACHIEVED, which is what Indrones mean by attitude error,
        // in hover and in cruise alike. The limit is a store value — only the
        // measurement belongs here.
        //
        // This is not what the desktop analyser measures — it stores
        // `acos(cos(field))`, a RADIAN wrap whose output is always in [0, pi],
        // and compares it to a threshold of about 3.1, i.e. pi. Its attitude
        // check therefore cannot fail anything, and the report it prints is
        // labelled "degrees" while holding radians.
        [[msg.Roll, msg.DesRoll], [msg.Pitch, msg.DesPitch]].forEach(pair => {
          const actual = pair[0], wanted = pair[1];
          if (typeof actual !== 'number' || typeof wanted !== 'number') return;
          if (!isFinite(actual) || !isFinite(wanted)) return;
          att.n++;
          const e = Math.abs(wrap180(actual - wanted));
          if (e > R.attTrack) att.over++;
          if (att.hi == null || e > att.hi) { att.hi = e; att.at = t; }
        });

      } else if (msg._name === 'RCOU') {
        Object.keys(msg).forEach(col => {
          if (!/^C\d+$/.test(col)) return;
          const v = msg[col];
          if (typeof v !== 'number' || !isFinite(v)) return;
          const s = pwm.get(col) || { sum: 0, n: 0 };
          s.sum += v; s.n++;
          pwm.set(col, s);
        });

      } else if (msg._name === 'GPS') {
        let h = msg.HDop;
        if (typeof h === 'number' && isFinite(h) && h > 0) {
          // DataFlash stores HDop x100, so a good fix reads ~80-150, not 0.8-1.5.
          // Anything at or below 20 cannot be that scaled form, so it is taken as
          // already in metres. One rule, right either way — ArduPilot's own gate
          // is 1.5 to review and 2.0 to fail.
          if (h > 20) h = h / 100;
          hdop.n++;
          if (h > R.hdopReview) hdop.over++;
          if (hdop.hi == null || h > hdop.hi) { hdop.hi = h; hdop.at = t; }
        }
      }
    }

    // ── the scored areas ─────────────────────────────────────────────────────
    //
    // An area is scored ONLY when a limit was agreed for it. With the number
    // missing the area is not averaged in at 100 (which would quietly reward
    // having no rule) and it is not failed (which would punish it) — it is left
    // out of the mean entirely, and named in `open` below so the gap is visible
    // on screen instead of being a silence.
    const has = (...keys) => keys.every(k => R[k] != null && isFinite(R[k]));
    const parts = [];
    const band = (hi, review, fail) => hi == null ? '' : (hi >= fail ? 'red' : (hi > review ? 'amber' : 'green'));
    const noRule = [];

    [['VibeX', 'X', R.vibeXYReview, R.vibeXYFail, 'X and Y vibration'],
     ['VibeY', 'Y', R.vibeXYReview, R.vibeXYFail, 'X and Y vibration'],
     ['VibeZ', 'Z', R.vibeZReview, R.vibeZFail, 'Z vibration']].forEach(row => {
      const s = axis[row[0]], label = row[1], review = row[2], fail = row[3];
      if (s.n === 0) return;
      if (review == null || fail == null || !isFinite(review) || !isFinite(fail)) {
        if (noRule.indexOf(row[4]) < 0) noRule.push(row[4]);
        return;
      }
      const score = subscore(s.over, s.n, s.hi, review, fail);
      if (score == null) return;
      parts.push({
        id: 'vibe' + label, label: label + ' vibration', score,
        band: band(s.hi, review, fail),
        detail: `peak ${s.hi.toFixed(1)} m/s² — watch above ${review}, fail above ${fail}`,
      });
      if (s.hi >= fail) {
        add('fail', `${label} vibration past the limit`, s.at,
          `Peak ${s.hi.toFixed(1)} m/s² on ${row[0]} against a ${fail} m/s² limit, on ${s.over} of ${s.n} samples above the ${review} m/s² watch level. Vibration at this level degrades the attitude estimate and is a common cause of unexplained loss of control.`, 'VIBE');
      } else if (s.hi > review) {
        add('review', `${label} vibration worth a look`, s.at,
          `Peak ${s.hi.toFixed(1)} m/s² on ${row[0]}, between the ${review} m/s² watch level and the ${fail} m/s² limit.`, 'VIBE');
      }
    });

    if (att.n) {
      if (!has('attTrack')) noRule.push('Attitude tracking');
      else {
        parts.push({
          id: 'attitude', label: 'Attitude tracking', score: subscore(att.over, att.n, att.hi, R.attTrack, null),
          band: band(att.hi, R.attTrack, Infinity),
          detail: `worst commanded-vs-achieved error ${att.hi.toFixed(1)}° — ${R.attTrack}° is the limit`,
        });
        if (att.over) {
          add(att.hi > R.attTrack * 2 ? 'fail' : 'review', 'Attitude not tracking the command', att.at,
            `Worst error ${att.hi.toFixed(1)}° between commanded and achieved attitude, and ${att.over} of ${att.n} samples past the ${R.attTrack}° limit.`, 'ATT');
        }
      }
    }

    if (curSustained != null) {
      if (!has('curReview', 'curFail')) noRule.push('Current');
      else {
        const score = ratioScore(curSustained, R.curReview, R.curFail);
        parts.push({
          id: 'current', label: 'Current', score,
          band: band(curSustained, R.curReview, R.curFail),
          detail: `${curSustained.toFixed(1)} A held for ${R.curHoldMs / 1000} s (peak ${curPeak.toFixed(1)} A) — watch ${R.curReview} A, fail ${R.curFail} A`,
        });
        if (curSustained >= R.curFail) {
          add('fail', 'Current held past the limit', curSustainedAt,
            `${curSustained.toFixed(1)} A held for at least ${R.curHoldMs / 1000} s, against a ${R.curFail} A limit. The peak was ${curPeak.toFixed(1)} A.`, 'BAT');
        } else if (curSustained > R.curReview) {
          add('review', 'Current held above the watch level', curSustainedAt,
            `${curSustained.toFixed(1)} A held for at least ${R.curHoldMs / 1000} s, between the ${R.curReview} A watch level and the ${R.curFail} A limit.`, 'BAT');
        }
      }
    }
    // A spike that never HELD is not a fault on this rule, but it must not be
    // hidden either. Skipped when the peak IS the sustained value — then the
    // finding above already says it. Needs a limit to be meaningful at all.
    if (curPeak != null && has('curFail') && curPeak > R.curFail && (curSustained == null || curPeak > curSustained)) {
      add('info', 'Current spike, not held', curPeakAt,
        `Peak ${curPeak.toFixed(1)} A` +
        (curSustained == null
          ? `, never held for ${R.curHoldMs / 1000} s`
          : ` against ${curSustained.toFixed(1)} A held for ${R.curHoldMs / 1000} s`) +
        `, so it is not a fault on this rule.`, 'BAT');
    }

    if (pwm.size >= 2) {
      const means = [...pwm.entries()]
        .filter(e => e[1].n > 0)
        .map(e => ({ col: e[0], mean: e[1].sum / e[1].n }));
      const lo = means.reduce((a, b) => b.mean < a.mean ? b : a);
      const hi = means.reduce((a, b) => b.mean > a.mean ? b : a);
      const spread = hi.mean - lo.mean;
      if (!has('pwmSpread')) noRule.push('Motor balance');
      else {
        // One level, so the score is a straight pass or fail rather than a
        // gradient built from a number nobody gave.
        parts.push({
          id: 'pwmSpread', label: 'Motor balance', score: spread <= R.pwmSpread ? 100 : 0,
          band: spread <= R.pwmSpread ? 'green' : 'red',
          detail: `${spread.toFixed(0)} µs between the highest and lowest motor average (${hi.col} vs ${lo.col}) — limit ${R.pwmSpread}`,
        });
        if (spread > R.pwmSpread) {
          add('review', 'Motors working unevenly', null,
            `${hi.col} averages ${hi.mean.toFixed(0)} µs against ${lo.col} at ${lo.mean.toFixed(0)} µs — a spread of ${spread.toFixed(0)} µs, past the ${R.pwmSpread} limit. A thrust or ESC imbalance works one motor harder than the rest.`, 'RCOU');
        }
      }
      // Saturation was already decided by the main pass, which requires it to
      // HOLD (LIMITS.rcouRunMs). Read its verdict rather than measuring twice.
      const pinned = findings.filter(f => f.message === 'RCOU' && f.severity === 'fail');
      parts.push({
        id: 'motorSaturation', label: 'Motor saturation',
        score: pinned.length ? 0 : 100,
        band: pinned.length ? 'red' : 'green',
        detail: pinned.length ? pinned.length + ' channel(s) pinned at an end of the 1100–1900 range'
                              : 'no channel pinned at either end',
      });
    }

    if (hdop.n) {
      if (!has('hdopReview', 'hdopFail')) noRule.push('GPS quality');
      else {
        parts.push({
          id: 'gps', label: 'GPS quality', score: subscore(hdop.over, hdop.n, hdop.hi, R.hdopReview, R.hdopFail),
          band: band(hdop.hi, R.hdopReview, R.hdopFail),
          detail: `worst HDop ${hdop.hi.toFixed(2)} — review ${R.hdopReview}, fail ${R.hdopFail}`,
        });
        if (hdop.hi >= R.hdopFail) {
          add('fail', 'GPS position quality poor', hdop.at,
            `HDop reached ${hdop.hi.toFixed(2)} against a ${R.hdopFail} limit — the position estimate was worse than the aircraft can safely hold against.`, 'GPS');
        } else if (hdop.hi > R.hdopReview) {
          add('review', 'GPS position quality dipped', hdop.at,
            `HDop reached ${hdop.hi.toFixed(2)}, past the ${R.hdopReview} review level.`, 'GPS');
        }
      }
    }

    // ── what needs a human, not a number ─────────────────────────────────────
    const total = Math.max(clip.Clip0, clip.Clip1, clip.Clip2);
    const times = parsed.__time;
    const dur = times && isFinite(times.min) && isFinite(times.max) ? times.max - times.min : null;
    // ArduPilot: the counters "should stay at zero", but "low numbers (<100) are
    // likely ok especially if they occur during hard landings", and it is a
    // STEADILY CLIMBING count that signals a real vibration problem. So what
    // matters is whether the count was rising THROUGHOUT the flight, not whether
    // it happened to still be moving at the end — a single jump on touchdown is
    // the hard-landing case ArduPilot calls benign, and reading "moved late" as
    // "climbing" would fail every aircraft that lands firmly.
    const midpoint = dur ? times.min + dur * 0.5 : null;
    const clipClimbing = midpoint != null && clipFirstAt != null && clipLastRiseAt != null &&
                         clipFirstAt < midpoint && clipLastRiseAt > midpoint;
    const checklist = [];
    if (total > 0) {
      checklist.push({
        id: 'clipping',
        label: 'Accelerometer clipping',
        detail: `${total} clip${total === 1 ? '' : 's'} on the worst accelerometer` +
                (clipClimbing ? ', rising through the flight' : '') +
                '. Nothing is accepted until you tick it — no tick means fail.',
        needsTick: true,
      });
      add(clipClimbing ? 'fail' : 'review', 'Accelerometer clipping', clipFirstAt,
        `${total} clips. ArduPilot: the counter should stay at zero, though low numbers are likely ok on a hard landing` +
        (clipClimbing ? ' — and this one was climbing steadily through the flight, which is the signal that matters.'
                      : ', and this one did not rise steadily.'), 'VIBE');
    }
    if (mahUsed != null) {
      // How much of the pack that actually was, where the pack is known. mAh drawn
      // means nothing on its own — 3000 mAh is a third of a two-pack SIGMA100 and
      // most of a single-pack 25G — so the percentage is the readable number and
      // the raw mAh is kept beside it.
      const packPct = pack.packMah ? (mahUsed / pack.packMah) * 100 : null;
      checklist.push({
        id: 'mah',
        label: 'Capacity used',
        detail: `${mahUsed.toFixed(0)} mAh drawn` +
          (packPct != null
            ? ` — ${packPct.toFixed(0)}% of the ${pack.packMah} mAh the pack holds`
            : ' (the pack is not recorded for this airframe, so this cannot be read as a proportion)') +
          ` over the flight. Accepted or rejected by you, not by a threshold — there is no rule yet.`,
        needsTick: true,
      });
    }

    // Areas with no agreed rule. Reported, never averaged in.
    const open = [];
    // What the log was actually judged against. On screen this is the difference
    // between "this scored 78" and "this scored 78 as an S25" — and it is the
    // first thing to check when a score does not look like the airframe.
    open.push({
      id: 'profile',
      label: 'Scored against',
      detail: R.airframe
        ? `the ${R.airframe} profile` + (R.profile === R.airframe ? '' : ' with the default profile underneath')
        : (R.profile === 'built-in defaults'
            ? 'the built-in defaults only — no airframe was chosen and no default profile is set, so anything without a public figure below has no limit at all.'
            : 'the shared default profile — no airframe was chosen for this log.'),
    });
    // Every limit that is not set. Named individually, because "no limit agreed"
    // is a decision someone has to make, not a quiet zero.
    noRule.forEach(name => open.push({
      id: 'norule:' + name,
      label: name + ' — no limit set',
      detail: `There is no agreed figure for this, so it is shown and NOT scored. It is left out of the total rather than counted as a pass. Set it in Log limits.`,
    }));
    if (vMin != null) {
      // PER CELL wherever the pack is recorded, because that is the only form in
      // which the number means anything across this fleet: the same 21 V is a
      // healthy 4S pack and a nearly-empty 6S one. With no cell count declared we
      // still show the pack voltage — it is a real measurement — but say plainly
      // that it cannot be read against another airframe's, rather than quietly
      // implying it can.
      const perCell = pack.series ? vMin / pack.series : null;
      open.push({
        id: 'voltage',
        label: perCell != null ? 'Lowest cell voltage' : 'Lowest pack voltage',
        detail: (perCell != null
            ? `${perCell.toFixed(2)} V per cell — ${vMin.toFixed(2)} V on a ${pack.series}S pack ` +
              `(${pack.fullPack.toFixed(1)} V full), at ${vMinAt == null ? '—' : vMinAt.toFixed(1) + ' s'}. `
            : `${vMin.toFixed(2)} V at ${vMinAt == null ? '—' : vMinAt.toFixed(1) + ' s'}. The pack's cell ` +
              `count is not recorded for this airframe, so this cannot be compared with another aircraft's — ` +
              `set it under Log limits. `) +
          `No limit is applied: Indrones is still settling the voltage rule, so this is shown and not scored.`,
      });
    }
    open.push({
      id: 'err',
      label: 'ERR subsystem codes',
      detail: 'No rule yet. The list of codes that must fail a log outright is still being chosen, so these are counted above and scored on nothing.',
    });
    open.push({
      id: 'resistance',
      label: 'Battery internal resistance',
      detail: 'No rule yet — there is no value at which a pack is replaced, so it is shown and not scored.',
    });

    const measured = parts.filter(p => p.score != null);
    return {
      findings,
      score: {
        total: measured.length ? Math.round(measured.reduce((a, p) => a + p.score, 0) / measured.length) : null,
        parts,
        checklist,
        open,
        // Which profile produced this. Carried on the score itself so a stored
        // report still says what it was judged against months later.
        airframe: R.airframe || '',
        profile: R.profile || '',
        // The change between two logs of one airframe that is noise rather than
        // news. A store value like the limits — see TUNED.
        wobble: R.scoreWobble != null ? R.scoreWobble : null,
      },
    };
  }

  return {
    VERSION: '1.0.0',
    LIMITS,
    TUNED,
    resolveRules,
    packInfo,
    WATCHED,
    parseFormat,
    createParser,
    analyseBuffer,
    analyseFile,
    scoreFlightLog,
  };
})();
