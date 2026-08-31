#!/usr/bin/env node
// Fit replacement baselines to observed auction prices.
//
//   node tools/calibrate.js <projections.csv> <sales.csv> [options]
//
// Input:  projections  Name,Pos,ProjPts[,EspnAuction]   (tools/fetch-projections.js)
//         sales        Name,Pos,Price                   (panel: Settings -> Export sales)
//
// Prints every candidate baseline set ranked by RMSE against what the room actually
// paid, with per-position bias so you can see WHERE the model is wrong and not just
// how much. Paste the winning line into the panel's baselines box, or into
// `fixedCounts` in tools/value-model.js.
//
// Options (defaults describe FPL):
//   --teams N        teams in the league                        (10)
//   --budget N       auction budget per team                    ($200)
//   --slots SPEC     roster slots, same syntax as the panel     (QB=2, RB=2, WR/TE=4, BN=4)
//   --top N          rows to print                              (12)
//   --min N          override the minimum-sales guard           (15)
const fs = require('fs');
const util = require('../src/util.js');
const calibrate = require('../src/calibrate.js');

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
};

if (files.length < 2) {
  console.error('usage: node tools/calibrate.js <projections.csv> <sales.csv> [--teams N] [--budget N] [--slots SPEC] [--top N]');
  process.exit(1);
}

const teams = Number(opt('teams', 10));
const budget = Number(opt('budget', 200));
const slotSpec = opt('slots', 'QB=2, RB=2, WR/TE=4, BN=4');
const top = Number(opt('top', 12));

const slots = util.specToSlots(slotSpec);
if (!slots) {
  console.error(`Could not parse --slots "${slotSpec}" (expected e.g. "QB=2, RB=2, WR/TE=4, BN=4")`);
  process.exit(1);
}
const cfg = util.configFromSlots(slots, { teams, budget });

const proj = util.parseProjectionsCSV(fs.readFileSync(files[0], 'utf8'));
const sales = calibrate.parseSalesCSV(fs.readFileSync(files[1], 'utf8'));
for (const e of [...proj.errors, ...sales.errors].slice(0, 5)) console.error('warn:', e);

const minOverride = Number(opt('min', calibrate.MIN_OBSERVATIONS));
const result = calibrate.sweep({
  projections: proj.players,
  observations: sales.sales,
  cfg,
  minObservations: minOverride,
});

if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

const positions = [...new Set(proj.players.map((p) => p.pos))].sort();
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`league: ${teams} teams, $${budget}, slots ${slotSpec}`);
console.log(`pools: ${JSON.stringify(cfg.pools)}  starters: ${JSON.stringify(cfg.starters)}`);
console.log(`matched ${result.n} of ${sales.sales.length} sales against ${proj.players.length} projections`);
if (result.thin) {
  console.log(`NOTE: under ${calibrate.WARN_OBSERVATIONS} matched sales — treat the winner as a hint, not a result.`);
}
if (result.unmatched.length) {
  console.log(`unmatched: ${result.unmatched.slice(0, 8).join(', ')}${result.unmatched.length > 8 ? ` (+${result.unmatched.length - 8})` : ''}`);
}
console.log('');
console.log(pad('baseline', 26) + padL('RMSE', 8) + '   bias by position (model - market)');
console.log('-'.repeat(26 + 8 + 3 + positions.length * 9));
for (const r of result.rows.slice(0, top)) {
  const bias = positions
    .map((pos) => `${pos} ${r.bias[pos] === undefined ? '   -' : (r.bias[pos] >= 0 ? '+' : '') + r.bias[pos].toFixed(1)}`)
    .join('  ');
  console.log(pad(r.label, 26) + padL('$' + r.rmse.toFixed(1), 8) + '   ' + bias);
}
console.log('');
const best = result.rows[0];
console.log(`best: ${best.label} at RMSE $${best.rmse.toFixed(1)}`);
console.log(`paste into the panel's baselines box:  ${Object.keys(best.fixedCounts || {}).sort().map((k) => `${k.replace('WRTE', 'WR/TE')}=${best.fixedCounts[k]}`).join(', ') || '(iterating — clear the box)'}`);
