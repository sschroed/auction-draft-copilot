// Entry point: only activates in the draft room, wires state -> panel -> detect.
(() => {
  const NS = window.__adcp;
  if (NS.__started) return;

  // Must be the draft room itself. Plain substring checks match the mock draft
  // LOBBY too ("/football/mockdraftlobby"), which put the panel on the wrong page.
  const inDraftRoom = () =>
    /\/football\/(draft|liveDraft)\b/i.test(location.pathname) &&
    !/lobby/i.test(location.pathname);

  async function boot() {
    if (NS.__started) return;
    NS.__started = true;

    await NS.state.load();

    // Scope the sold log and roster to this specific draft room.
    const leagueKey = (location.search.match(/leagueId=(\d+)/) || [])[1] || null;
    const wiped = NS.state.ensureLeague(leagueKey);

    NS.panel.init();
    if (wiped) NS.panel.notice('New draft room — cleared previous results. Values kept.');

    NS.detect.start({
      getPlayers: () => NS.state.get().players,
      getSoldSet: () => NS.state.soldSet(),

      onNomination(idx) {
        NS.panel.pin(idx, 'auto');
        NS.panel.setDetectionStatus('· live');
      },
      onUnknownNomination(info) {
        NS.panel.pinUnknown(info);
        NS.panel.setDetectionStatus('· live');
      },
      onBid(amount) {
        NS.panel.setBid(amount);
      },
      onEspnMax(amount) {
        NS.panel.setEspnMax(amount);
      },
      onRosterSync(rows) {
        NS.state.syncMyRoster(rows);
      },
      onBudgets(info) {
        NS.panel.setBudgets(info);
      },
      onSold({ playerIdx, price, mine }) {
        const p = NS.state.get().players[playerIdx];
        if (!p) return;
        NS.state.markSold(p, { price, mine });
        if (NS.panel.getPinnedIdx() === playerIdx) NS.panel.clearPin();
      },
    });
  }

  if (inDraftRoom()) {
    boot();
  } else {
    // ESPN is a SPA — watch for navigation into the draft room.
    let tries = 0;
    const t = setInterval(() => {
      if (inDraftRoom()) { clearInterval(t); boot(); }
      else if (++tries > 600) clearInterval(t); // give up after ~10 min
    }, 1000);
  }
})();
