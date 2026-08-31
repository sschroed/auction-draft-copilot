// Auction value model — projections to dollars, calibrated to FPL's roster rules.
//
// Runs unchanged in Node (via build-values.js) and in the browser console, so the
// numbers pasted into the panel are provably the ones this file produces.
//
// Why not just use ESPN's $ values: they assume a 1QB league. FPL starts TWO QBs
// and has NO dedicated TE slot, so ESPN underprices quarterbacks badly (Josh Allen
// projects highest in the pool at 369.7 pts and they list him at $22) and overprices
// tight ends. Both fall out correctly once replacement level is computed from the
// roster FPL actually uses.
(function (root) {
  const DEFAULT_CONFIG = {
    teams: 10,
    budget: 200,
    rosterSpots: 12,          // draftable spots per team; IR excluded
    // Starting slots per team, keyed by POOL (see `pools` below).
    starters: { QB: 2, RB: 2, WRTE: 4 },

    // Which pool each position competes in. Positions sharing a starting slot share
    // a pool — a TE is worth what a WR scoring the same points is worth, nothing more.
    // This default describes FPL's WR/TE flex; a league with a dedicated TE slot passes
    // `pools: {}` so WR and TE price against their own replacement levels. Getting this
    // wrong silently shifts every replacement level, so it is derived from the roster
    // slots rather than assumed (see modelConfig() in src/panel.js).
    pools: { WR: 'WRTE', TE: 'WRTE' },

    // How many players per pool sit above replacement. CALIBRATED against 21 real
    // clearing prices from an FPL practice draft: this set cut prediction error
    // from RMSE $19.9 to $11.9 and reproduces the shape real auctions have —
    // ~78 players carrying meaningful money and the rest at $1.
    //
    // Letting the model solve for this instead (the original approach) drives
    // replacement down to the 120th player, which makes value nearly proportional
    // to raw points. That flattens the top of the curve and underprices elite
    // players by 40-50% — Josh Allen came out at $48 against a $72 market.
    // Set to null to go back to iterating.
    fixedCounts: { QB: 24, RB: 18, WRTE: 36 },
  };

  const poolOf = (pos, pools) => (pools || DEFAULT_CONFIG.pools)[pos] || pos;

  // Replacement level is circular: it depends on who gets drafted, which depends
  // on value, which depends on replacement level. Solve by iterating to a fixed point.
  function computeValues(players, cfg = {}) {
    const C = { ...DEFAULT_CONFIG, ...cfg };
    const totalDrafted = C.teams * C.rosterSpots;              // 120
    const surplus = C.teams * C.budget - totalDrafted;         // $2000 - $120 = $1880
    const poolFor = (pos) => poolOf(pos, C.pools);

    const pool = {};
    for (const p of players) {
      const k = poolFor(p.pos);
      (pool[k] = pool[k] || []).push(p);
    }
    for (const k of Object.keys(pool)) pool[k].sort((a, b) => b.pts - a.pts);

    // Seed each pool's baseline at league-wide starter demand.
    let counts = {};
    for (const k of Object.keys(pool)) counts[k] = (C.starters[k] || 0) * C.teams;

    // Pinning the baselines skips the iteration. Iterating to "everyone drafted is
    // above replacement" pushes replacement so deep that value ends up nearly
    // proportional to raw points, which flattens the top of the curve and badly
    // underprices elite players against what auctions actually pay.
    const passes = C.fixedCounts ? 1 : 8;
    if (C.fixedCounts) counts = { ...counts, ...C.fixedCounts };

    let drafted = [];
    for (let pass = 0; pass < passes; pass++) {
      // Replacement = best player at that pool who does NOT get drafted.
      const repl = {};
      for (const k of Object.keys(pool)) {
        const list = pool[k];
        const idx = Math.min(counts[k], list.length - 1);
        repl[k] = list[idx] ? list[idx].pts : 0;
      }
      for (const p of players) p.vorp = Math.max(0, p.pts - repl[poolFor(p.pos)]);

      // Tie-break by points. Many players sit at vorp 0, and without a deterministic
      // second key they sort arbitrarily — which let third-string QBs occupy draft
      // slots, drag QB replacement down to a ~10-point backup, and inflate every
      // quarterback. Points ordering keeps the filler realistic.
      drafted = [...players]
        .sort((a, b) => b.vorp - a.vorp || b.pts - a.pts)
        .slice(0, totalDrafted);

      // Recount how many of the drafted actually came from each pool, and repeat.
      const next = {};
      for (const k of Object.keys(pool)) next[k] = 0;
      for (const p of drafted) next[poolFor(p.pos)]++;
      if (C.fixedCounts) break;
      const stable = Object.keys(next).every((k) => next[k] === counts[k]);
      counts = next;
      if (stable) break;
    }

    const draftedSet = new Set(drafted);
    const sumVorp = drafted.reduce((n, p) => n + p.vorp, 0) || 1;
    for (const p of players) {
      p.value = draftedSet.has(p) ? Math.max(1, Math.round(1 + (p.vorp * surplus) / sumVorp)) : 1;
    }

    assignTiers(players);
    return { players, replacementCounts: counts, sumVorp, surplus };
  }

  // Tiers track where the cliffs are, per position — that's what's useful mid-auction
  // ("last guy in this tier") far more than an even split would be.
  function assignTiers(players) {
    const byPos = {};
    for (const p of players) (byPos[p.pos] = byPos[p.pos] || []).push(p);
    for (const list of Object.values(byPos)) {
      list.sort((a, b) => b.value - a.value || b.pts - a.pts);
      let tier = 1;
      for (let i = 0; i < list.length; i++) {
        if (i > 0) {
          const drop = list[i - 1].value - list[i].value;
          // A break needs to be a real cliff in both absolute and relative terms.
          if (drop >= 3 && drop >= 0.18 * Math.max(1, list[i - 1].value) && tier < 8) tier++;
        }
        list[i].tier = tier;
      }
    }
  }

  const api = { computeValues, assignTiers, poolOf, DEFAULT_CONFIG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ValueModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
