// Calibration — recover replacement baselines from observed auction prices.
//
// The model's `fixedCounts` (how many players per pool sit above replacement) is the
// one setting that cannot be read off a league's rules. It has to be fitted against
// what a room actually pays. This module is how that fit gets done, and it is the
// reason the panel archives every mock draft: run some mocks, sweep, apply.
//
// Runs in Node (tools/calibrate.js) and in the panel, sharing one implementation so
// the button and the terminal can never disagree about the answer.
//
// SCORING: raw RMSE of model dollars against observed sale prices, which is how the
// shipped FPL baselines were originally derived. It deliberately does NOT normalize
// for auction timing. Early nominations clear far above list and late ones crater
// (see DRAFT-NOTES.md), so a draft that ends with money unspent biases every candidate
// in the same direction. That is tolerable because it shifts the whole table together
// and the RANKING is what gets used — but it means the absolute RMSE numbers are only
// comparable within one dataset.
(function (root) {
  root.__adcp = root.__adcp || {};
  const NS = root.__adcp;
  const isNode = typeof module !== 'undefined' && !!module.exports;

  // In the browser these are already global; manifest.json loads util.js and
  // value-model.js ahead of this file.
  const VM = isNode ? require('../tools/value-model.js') : root.ValueModel;
  const util = isNode ? require('./util.js') : NS.util;
  const { normalizeName, normalizePos } = util;

  // Below this many matched sales the fit is noise, not signal.
  const MIN_OBSERVATIONS = 15;
  const WARN_OBSERVATIONS = 30;

  // "QB24/RB18/WR-TE36", or "iterating" for the self-solving baseline.
  function labelFor(fixedCounts) {
    if (!fixedCounts) return 'iterating';
    return Object.keys(fixedCounts)
      .sort()
      .map((k) => `${k.replace('WRTE', 'WR-TE')}${fixedCounts[k]}`)
      .join('/');
  }

  // Score one candidate. Returns rmse, match count, and per-position mean signed
  // error as MODEL MINUS MARKET — positive means the model prices that position
  // above what the room paid. Bias is what isolated quarterback as the culprit the
  // first time around, so it is reported even though ranking is on RMSE alone.
  function scoreCandidate(projections, observations, cfg, fixedCounts) {
    // computeValues writes value/vorp/tier onto the objects it is given. Clone per
    // candidate or every run after the first scores the previous run's leftovers.
    const players = projections.map((p) => ({
      name: p.name, norm: p.norm, pos: p.pos, pts: p.pts,
    }));
    const { replacementCounts } = VM.computeValues(players, { ...cfg, fixedCounts });

    const byNorm = new Map();
    for (const p of players) byNorm.set(p.norm, p);

    let sumSq = 0;
    let n = 0;
    const biasAcc = {};
    const unmatched = [];
    for (const o of observations) {
      const p = byNorm.get(o.norm);
      if (!p) { unmatched.push(o.name); continue; }
      const err = p.value - o.price;
      sumSq += err * err;
      n++;
      const b = biasAcc[p.pos] || (biasAcc[p.pos] = { sum: 0, n: 0 });
      b.sum += err;
      b.n++;
    }

    const bias = {};
    for (const pos of Object.keys(biasAcc)) {
      bias[pos] = biasAcc[pos].sum / biasAcc[pos].n;
    }

    return {
      fixedCounts,
      label: labelFor(fixedCounts),
      rmse: n ? Math.sqrt(sumSq / n) : Infinity,
      n,
      bias,
      unmatched,
      replacementCounts,
    };
  }

  const cartesian = (axes) =>
    axes.reduce((acc, [key, vals]) => {
      const out = [];
      for (const partial of acc) for (const v of vals) out.push({ ...partial, [key]: v });
      return out;
    }, [{}]);

  // Multiples of league-wide starter demand. A pool's baseline is never sensibly
  // below its starter count, but the shipped FPL numbers sit both above (QB 20->24)
  // and below (WR-TE 40->36) it, so the grid has to straddle 1.0x generously.
  const COARSE = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];

  function candidateGrid(cfg, multipliers) {
    const axes = Object.keys(cfg.starters).map((pool) => {
      const base = Math.max(1, cfg.starters[pool] * cfg.teams);
      const vals = [...new Set(multipliers.map((m) => Math.max(1, Math.round(base * m))))];
      return [pool, vals.sort((a, b) => a - b)];
    });
    return cartesian(axes);
  }

  // Coarse grid, then a local +/-3 walk around the winner. A full fine grid is a few
  // thousand model runs, which stalls the panel mid-draft; this lands on the same
  // optimum for a fraction of the work.
  function refineAround(best, cfg) {
    const axes = Object.keys(best).map((pool) => {
      const vals = [];
      for (let d = -3; d <= 3; d++) vals.push(Math.max(1, best[pool] + d));
      return [pool, [...new Set(vals)]];
    });
    return cartesian(axes);
  }

  // Rows always include the two reference baselines from DRAFT-NOTES.md so the table
  // shows what the tuning actually bought you: `iterating` (let replacement solve
  // itself) and `starters` (baseline = league-wide starter demand).
  function referenceCandidates(cfg) {
    const startersOnly = {};
    for (const pool of Object.keys(cfg.starters)) {
      startersOnly[pool] = cfg.starters[pool] * cfg.teams;
    }
    return [null, startersOnly];
  }

  function sweep({ projections, observations, cfg, extraCandidates = [], minObservations = MIN_OBSERVATIONS }) {
    const obs = observations.filter((o) => Number.isFinite(o.price) && o.price > 0);
    if (obs.length < minObservations) {
      return {
        ok: false,
        n: obs.length,
        reason:
          `Need at least ${minObservations} sales with prices to fit baselines; have ${obs.length}. ` +
          'Run another mock draft.',
        rows: [],
      };
    }

    const score = (fc) => scoreCandidate(projections, obs, cfg, fc);
    const seen = new Set();
    const rows = [];
    const add = (fc) => {
      const key = labelFor(fc);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(score(fc));
    };

    for (const fc of referenceCandidates(cfg)) add(fc);
    for (const fc of extraCandidates) if (fc) add(fc);

    const coarse = candidateGrid(cfg, COARSE).map(score);
    let best = coarse.reduce((a, b) => (b.rmse < a.rmse ? b : a));
    for (const fc of refineAround(best.fixedCounts, cfg)) add(fc);
    for (const r of coarse) {
      if (!seen.has(r.label)) { seen.add(r.label); rows.push(r); }
    }

    rows.sort((a, b) => a.rmse - b.rmse);
    const matched = rows[0] ? rows[0].n : 0;
    return {
      ok: true,
      n: matched,
      thin: matched < WARN_OBSERVATIONS,
      unmatched: rows[0] ? rows[0].unmatched : [],
      rows,
    };
  }

  // `Name,Pos,Price` — what the panel exports and the Node tool reads.
  function parseSalesCSV(text) {
    const sales = [];
    const errors = [];
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cells = line.split(/\t|,/).map((c) => c.trim());
      if (cells.length < 3) { errors.push(`Line ${i + 1}: expected Name,Pos,Price`); continue; }
      const price = Number(cells[2].replace(/^\$/, ''));
      if (!Number.isFinite(price)) {
        if (sales.length === 0 && errors.length === 0) continue;  // header row
        errors.push(`Line ${i + 1}: price "${cells[2]}" is not a number`);
        continue;
      }
      sales.push({
        name: cells[0], norm: normalizeName(cells[0]), pos: normalizePos(cells[1]), price,
      });
    }
    return { sales, errors };
  }

  const toSalesCSV = (sales) =>
    'Name,Pos,Price\n' + sales.map((s) => `${s.name},${s.pos},${s.price}`).join('\n') + '\n';

  const api = {
    sweep, scoreCandidate, labelFor, parseSalesCSV, toSalesCSV,
    MIN_OBSERVATIONS, WARN_OBSERVATIONS,
  };
  NS.calibrate = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
