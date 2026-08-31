#!/usr/bin/env node
// Turns a projections CSV into the panel's values CSV.
//
//   node tools/build-values.js projections.csv > values.csv
//
// Input:  Name,Pos,ProjPts[,EspnAuction]   (see tools/fetch-projections.js)
// Output: Name,Pos,Value,Tier              (paste straight into the panel's ⚙ box)
//
// The panel can do this itself — paste projections into the values box and it prices
// them in place. This tool is for batch work and for diffing model changes.
//
// Options (defaults describe FPL):
//   --teams N     teams in the league                     (10)
//   --budget N    auction budget per team                 ($200)
//   --slots SPEC  roster slots, same syntax as the panel  (QB=2, RB=2, WR/TE=4, BN=4)
//   --baselines SPEC  replacement baselines               (QB=24, RB=18, WR/TE=36)
//                     omit to derive them from starter demand; fit your own with
//                     tools/calibrate.js
const fs = require('fs');
const util = require('../src/util.js');
const { computeValues } = require('./value-model.js');

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
};

if (!file) {
  console.error('usage: node tools/build-values.js <projections.csv> [--teams N] [--budget N] [--slots SPEC] [--baselines SPEC]');
  process.exit(1);
}

const slotSpec = opt('slots', 'QB=2, RB=2, WR/TE=4, BN=4');
const slots = util.specToSlots(slotSpec);
if (!slots) {
  console.error(`Could not parse --slots "${slotSpec}"`);
  process.exit(1);
}
const baseSpec = opt('baselines', 'QB=24, RB=18, WR/TE=36');
const baseSlots = baseSpec ? util.specToSlots(baseSpec) : null;
const baselines = baseSlots
  ? Object.fromEntries(baseSlots.map((b) => [b.key, b.count]))
  : null;

const cfg = util.configFromSlots(slots, {
  teams: Number(opt('teams', 10)),
  budget: Number(opt('budget', 200)),
  baselines,
});

const { players: parsed, errors } = util.parseProjectionsCSV(fs.readFileSync(file, 'utf8'));
for (const e of errors.slice(0, 5)) process.stderr.write('warn: ' + e + '\n');
const players = parsed.map((p) => ({ name: p.name, pos: p.pos, pts: p.pts, espn: p.espn }));

const { replacementCounts, surplus } = computeValues(players, cfg);

const drafted = players.filter((p) => p.value > 1).sort((a, b) => b.value - a.value);
const spend = drafted.reduce((n, p) => n + p.value, 0);

// The full pool is the surplus above the $1-per-slot floor, plus that floor — which
// is teams x rosterSpots, not the 120 that FPL happens to work out to.
const floor = cfg.teams * cfg.rosterSpots;
process.stderr.write(
  `league: ${cfg.teams} teams, $${cfg.budget}, slots ${slotSpec}\n` +
  `replacement counts: ${JSON.stringify(replacementCounts)}\n` +
  `priced above $1: ${drafted.length} players, $${spend} of $${surplus + floor} pool\n`
);

// Emit everyone worth more than the $1 minimum, plus enough $1 depth to cover
// late nominations — the panel treats anyone unlisted as a $1 flier anyway.
const out = players
  .filter((p) => p.value > 1 || p.pts > 0)
  .sort((a, b) => b.value - a.value || b.pts - a.pts)
  .slice(0, 250);

console.log('Name,Pos,Value,Tier');
for (const p of out) console.log(`${p.name},${p.pos},${p.value},${p.tier}`);
