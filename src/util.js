// Auction Draft Co-Pilot — shared utilities.
// All modules hang off one namespace object; load order is set in manifest.json.
//
// Wrapped so it also loads in Node (tools/calibrate.js). Name matching MUST be the
// same code in both places: the calibration join pairs model output to observed sale
// prices by normalized name, and any divergence there silently drops players from the
// fit rather than erroring.
(function (root) {
  root.__adcp = root.__adcp || {};
  const NS = root.__adcp;

  const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

  // "A.J. Brown Jr." -> "aj brown"; forgiving on case, punctuation, suffixes, diacritics.
  function normalizeName(raw) {
    if (!raw) return '';
    return String(raw)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((tok) => tok && !SUFFIXES.has(tok))
      .join(' ');
  }

  // Position labels ESPN uses vs what values sheets use.
  function normalizePos(raw) {
    const p = String(raw || '').toUpperCase().replace(/[^A-Z/]/g, '');
    if (p === 'DST' || p === 'D/ST' || p === 'DEF') return 'DST';
    if (p === 'PK') return 'K';
    return p;
  }

  // Parse pasted values: `Name,Pos,Value,Tier` — commas or tabs, header optional,
  // Tier optional. Returns { players, errors }.
  function parseValuesCSV(text) {
    const players = [];
    const errors = [];
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cells = line.split(/\t|,/).map((c) => c.trim());
      if (cells.length < 3) {
        errors.push(`Line ${i + 1}: expected Name,Pos,Value[,Tier]`);
        continue;
      }
      const value = Number(cells[2].replace(/^\$/, ''));
      if (!Number.isFinite(value)) {
        // A non-numeric Value on the first data row is treated as a header.
        if (players.length === 0 && errors.length === 0) continue;
        errors.push(`Line ${i + 1}: value "${cells[2]}" is not a number`);
        continue;
      }
      const tier = cells.length > 3 && cells[3] !== '' ? Number(cells[3]) : null;
      players.push({
        name: cells[0],
        norm: normalizeName(cells[0]),
        pos: normalizePos(cells[1]),
        value: Math.max(0, Math.round(value)),
        tier: Number.isFinite(tier) ? tier : null,
      });
    }
    return { players, errors };
  }

  // Parse pasted projections: `Name,Pos,ProjPts[,EspnAuction]` — same separators and
  // optional header as parseValuesCSV. Feeds the value model rather than the panel.
  function parseProjectionsCSV(text) {
    const players = [];
    const errors = [];
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cells = line.split(/\t|,/).map((c) => c.trim());
      if (cells.length < 3) {
        errors.push(`Line ${i + 1}: expected Name,Pos,ProjPts`);
        continue;
      }
      const pts = Number(cells[2]);
      if (!Number.isFinite(pts)) {
        if (players.length === 0 && errors.length === 0) continue;  // header row
        errors.push(`Line ${i + 1}: projection "${cells[2]}" is not a number`);
        continue;
      }
      players.push({
        name: cells[0],
        norm: normalizeName(cells[0]),
        pos: normalizePos(cells[1]),
        pts,
        espn: Number(cells[3]) || 0,
      });
    }
    return { players, errors };
  }

  // Values and projections have the same shape — Name,Pos,number[,number] — so the
  // paste box has to tell them apart by content. Any ONE of these is decisive, and
  // all three point the same way on real files:
  //   1. a header naming ProjPts (both bundled tools emit one)
  //   2. a non-integer in column 3 (projections carry decimals; values are rounded)
  //   3. a column-3 figure above the league budget (no player can be worth more)
  // Returns 'projections' or 'values'.
  function sniffPasteFormat(text, { budget = 200 } = {}) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return 'values';
    if (/projpts/i.test(lines[0])) return 'projections';

    let max = 0;
    for (const line of lines) {
      const cells = line.split(/\t|,/).map((c) => c.trim());
      if (cells.length < 3) continue;
      const n = Number(cells[2].replace(/^\$/, ''));
      if (!Number.isFinite(n)) continue;
      if (!Number.isInteger(n)) return 'projections';
      if (n > max) max = n;
    }
    return max > budget ? 'projections' : 'values';
  }

  // Roster slots <-> the "QB=2, RB=2, WR/TE=4, BN=4" spec shown in settings.
  // Shared with the Node tools so a league described on the command line and a league
  // described in the panel produce the same model config.
  const BENCH_ACCEPTS = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

  function slotsToSpec(slots) {
    return slots.map((s) => `${s.label}=${s.count}`).join(', ');
  }

  function specToSlots(spec) {
    const out = [];
    for (const part of String(spec).split(',')) {
      const m = part.trim().match(/^([A-Za-z/]+)\s*=\s*(\d+)$/);
      if (!m) continue;
      const label = m[1].toUpperCase();
      const count = Number(m[2]);
      if (!count) continue;
      const accepts = label === 'BN' || label === 'BENCH'
        ? BENCH_ACCEPTS.slice()
        : label.split('/').map(normalizePos);
      out.push({ key: label.replace(/\//g, ''), label, count, accepts });
    }
    return out.length ? out : null;
  }

  // Turn roster slots into the value model's config. Replacement level depends
  // entirely on this, so it is derived from the league's actual roster rather than
  // assumed — on FPL's slots it reproduces value-model.js's DEFAULT_CONFIG exactly.
  //
  // Three rules, in order:
  //   1. A slot accepting 4+ positions is bench. It counts toward roster size (bench
  //      players cost money) but creates no starter demand.
  //   2. Positions that share a slot AND have no dedicated slot of their own pool
  //      together — FPL's WR/TE flex, where a TE is worth exactly what a WR scoring
  //      the same is worth.
  //   3. A multi-position slot whose positions DO have their own slots is a true flex
  //      (RB/WR/TE alongside dedicated RB, WR and TE slots). It is left out of starter
  //      demand rather than folded arbitrarily into one pool: counting it would have to
  //      pick a position to credit, and guessing wrong moves that pool's replacement
  //      level. This slightly understates demand in flex leagues; calibration against
  //      observed prices is the intended correction.
  function configFromSlots(slots, { teams, budget, baselines = null } = {}) {
    const starterSlots = [];
    let rosterSpots = 0;
    for (const s of slots) {
      const accepts = [...new Set((s.accepts || []).map(normalizePos))];
      rosterSpots += s.count;
      if (accepts.length < 4) starterSlots.push({ ...s, accepts });
    }

    const dedicated = new Set();
    for (const s of starterSlots) if (s.accepts.length === 1) dedicated.add(s.accepts[0]);

    const pools = {};
    const starters = {};
    for (const s of starterSlots) {
      if (s.accepts.length === 1) {
        const pos = s.accepts[0];
        starters[pos] = (starters[pos] || 0) + s.count;
        continue;
      }
      if (s.accepts.some((pos) => dedicated.has(pos))) continue;   // true flex — rule 3
      const key = s.accepts.slice().sort().reverse().join('');      // WR + TE -> "WRTE"
      for (const pos of s.accepts) pools[pos] = key;
      starters[key] = (starters[key] || 0) + s.count;
    }

    // fixedCounts must ALWAYS be set. computeValues merges over its own defaults, so
    // leaving it off does not mean "derive" — it means the caller silently inherits
    // FPL's tuned baselines, which is exactly the miscalibration this derivation
    // exists to prevent. Absent an explicit fit, replacement sits at starter demand.
    const derived = {};
    for (const pool of Object.keys(starters)) derived[pool] = starters[pool] * teams;
    const fixedCounts = baselines && Object.keys(baselines).length ? baselines : derived;

    return { teams, budget, rosterSpots, starters, pools, fixedCounts };
  }

  // Find a player by fuzzy text. Exact normalized match wins; otherwise
  // token-prefix ("jef" or "ju jef" pins Justin Jefferson). Returns index or -1.
  function findPlayer(players, query, { excludeSold = null } = {}) {
    const q = normalizeName(query);
    if (!q) return -1;
    const alive = (p) => !excludeSold || !excludeSold.has(p.norm);

    let idx = players.findIndex((p) => alive(p) && p.norm === q);
    if (idx !== -1) return idx;

    const qToks = q.split(' ');
    const matches = [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!alive(p)) continue;
      const toks = p.norm.split(' ');
      // Every query token must prefix some name token, in order.
      let ti = 0;
      let ok = true;
      for (const qt of qToks) {
        while (ti < toks.length && !toks[ti].startsWith(qt)) ti++;
        if (ti >= toks.length) { ok = false; break; }
        ti++;
      }
      if (ok) matches.push(i);
    }
    if (matches.length === 0) return -1;
    // Highest value first — during an auction that is almost always the one meant.
    matches.sort((a, b) => players[b].value - players[a].value);
    return matches[0];
  }

  const fmt$ = (n) => '$' + Math.max(0, Math.round(n));

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const run = () => { last = Date.now(); timer = null; fn(...args); };
      if (now - last >= ms) run();
      else if (!timer) timer = setTimeout(run, ms - (now - last));
    };
  }

  NS.util = {
    normalizeName, normalizePos, parseValuesCSV, parseProjectionsCSV,
    sniffPasteFormat, findPlayer, fmt$, debounce, throttle,
    slotsToSpec, specToSlots, configFromSlots, BENCH_ACCEPTS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.util;
})(typeof globalThis !== 'undefined' ? globalThis : this);
