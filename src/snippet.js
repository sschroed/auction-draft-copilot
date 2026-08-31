// The projections snippet the panel hands you to paste into DevTools.
//
// The extension deliberately does NOT fetch this itself. Requesting host permissions
// for ESPN's API and pulling on a timer would turn a thing you run by hand, once,
// against your own league into automated extraction — which is both what ESPN's terms
// prohibit and what the panel's "no network requests" guarantee rules out. Keeping the
// request in your own console keeps every claim in the README true.
//
// tools/fetch-projections.js is the same script as a standalone file, for when you are
// not sitting in a draft room. Change one, change the other.
(function (root) {
  root.__adcp = root.__adcp || {};
  const NS = root.__adcp;

  // NFL projections for season Y are published in the spring of Y. Before March,
  // "this season" is still last calendar year's.
  function currentSeason(now = new Date()) {
    return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  }

  // `positions` should match what your league actually rosters — including kickers and
  // defenses when you draft them, since anything left out is invisible to the inflation
  // math but still soaks up other teams' money.
  function buildSnippet({ leagueId, season = currentSeason(), positions = ['QB', 'RB', 'WR', 'TE'], limit = 400 } = {}) {
    const posList = positions.map((p) => `'${p}'`).join(', ');
    return `// Auction Draft Co-Pilot — projections pull for league ${leagueId}, ${season} season.
// Paste into the DevTools console on any fantasy.espn.com page while logged in, then
// copy the printed CSV into the panel's values box (Settings -> paste -> Import).
//
// Personal use, your own league, your own session, run by hand. Do not schedule it.
(async () => {
  const LEAGUE_ID = ${leagueId};
  const SEASON = ${season};
  const url = \`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/\${SEASON}\` +
              \`/segments/0/leagues/\${LEAGUE_ID}?view=kona_player_info\`;
  // A sort key is REQUIRED — a bare {"players":{"limit":N}} filter returns HTTP 400.
  const filter = { players: { limit: ${limit}, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'x-fantasy-filter': JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error('ESPN returned ' + res.status);
  const data = await res.json();

  const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
  const KEEP = [${posList}];
  const seasonProjection = (p) =>
    (p.player.stats || []).find(
      (s) => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 0
    )?.appliedTotal;

  const rows = data.players
    .map((p) => {
      const pos = POS[p.player.defaultPositionId];
      const pts = seasonProjection(p);
      if (!(pts > 0) || !KEEP.includes(pos)) return null;
      return {
        name: p.player.fullName.replace(/,/g, ''),
        pos,
        pts,
        espn: p.player.draftRanksByRankType?.STANDARD?.auctionValue ?? '',
      };
    })
    .filter(Boolean);

  // Keep enough depth per position to place replacement level; the rest are $1 anyway.
  const DEPTH = { QB: 45, RB: 60, WR: 80, TE: 40, K: 32, DST: 32 };
  const kept = [];
  for (const pos of KEEP) {
    kept.push(...rows.filter((r) => r.pos === pos).sort((a, b) => b.pts - a.pts).slice(0, DEPTH[pos] || 40));
  }

  const csv = 'Name,Pos,ProjPts,EspnAuction\\n' +
    kept.map((r) => \`\${r.name},\${r.pos},\${r.pts.toFixed(1)},\${r.espn}\`).join('\\n') + '\\n';
  console.log(csv);
  return \`\${kept.length} players — copy the CSV above\`;
})();`;
  }

  NS.snippet = { buildSnippet, currentSeason };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.snippet;
})(typeof globalThis !== 'undefined' ? globalThis : this);
