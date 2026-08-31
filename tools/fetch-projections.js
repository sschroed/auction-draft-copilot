// Pulls ESPN's projections for YOUR league. Paste into the DevTools console on a
// fantasy.espn.com page for that league while logged in, then paste the printed CSV
// into the panel's values box — it prices them in place. For the batch route:
//
//     node tools/build-values.js projections.csv > values.csv
//
// Personal use, your own league, under your own session, run by hand. It is a single
// read of data you already have access to; do not schedule it, loop it, or point it at
// leagues that are not yours.
//
// The panel can hand you this same script pre-filled — Settings -> Copy pull script.
// That version lives in src/snippet.js; change one, change the other.
//
// Why ESPN: `appliedTotal` is already scored under YOUR league's rules, and `fullName`
// matches the draft room DOM exactly, which is what makes name matching reliable.
//
// We take the PROJECTIONS but not ESPN's auction values — theirs assume a 1QB league.
// See tools/value-model.js.
(async () => {
  // Read from the page you are on rather than hardcoding, so this is always your league.
  const LEAGUE_ID = (location.search.match(/leagueId=(\d+)/) || [])[1];
  if (!LEAGUE_ID) {
    throw new Error('No leagueId in this URL — open one of your league pages first (it will have ?leagueId=... in it).');
  }
  const SEASON = new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}` +
              `/segments/0/leagues/${LEAGUE_ID}?view=kona_player_info`;
  // A sort key is REQUIRED — a bare {"players":{"limit":N}} filter returns HTTP 400.
  const filter = { players: { limit: 400, sortPercOwned: { sortPriority: 1, sortAsc: false } } };

  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'x-fantasy-filter': JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error('ESPN returned ' + res.status);
  const data = await res.json();

  const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
  const KEEP = ['QB', 'RB', 'WR', 'TE'];   // add 'K' / 'DST' if your league drafts them
  const seasonProjection = (p) =>
    (p.player.stats || []).find(
      (s) => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 0
    )?.appliedTotal;

  const rows = data.players
    .map((p) => {
      const pos = POS[p.player.defaultPositionId];
      const pts = seasonProjection(p);
      // Positions your league does not roster would pollute the inflation math —
      // trim KEEP to match your roster.
      if (!(pts > 0) || !KEEP.includes(pos)) return null;
      return {
        name: p.player.fullName.replace(/,/g, ''),
        pos,
        pts,
        espn: p.player.draftRanksByRankType?.STANDARD?.auctionValue ?? '',
      };
    })
    .filter(Boolean);

  // Keep enough depth per position to place replacement level; the rest are $1 regardless.
  const DEPTH = { QB: 45, RB: 60, WR: 80, TE: 40, K: 32, DST: 32 };
  const kept = [];
  for (const pos of KEEP) {
    kept.push(...rows.filter((r) => r.pos === pos).sort((a, b) => b.pts - a.pts).slice(0, DEPTH[pos] || 40));
  }

  const csv = 'Name,Pos,ProjPts,EspnAuction\n' +
    kept.map((r) => `${r.name},${r.pos},${r.pts.toFixed(1)},${r.espn}`).join('\n') + '\n';

  console.log(csv);
  return `${kept.length} players — copy the CSV above`;
})();
