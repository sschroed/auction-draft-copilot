// State + persistence. One object in chrome.storage.local, debounced writes,
// tiny pub/sub so the panel re-renders on any change.
(() => {
  const NS = window.__adcp;
  const { debounce } = NS.util;

  const STORAGE_KEY = 'adcp_state_v1';

  // A draft is ~120 sales, a few KB. The cap is about keeping the archive legible,
  // not about the storage quota.
  const MAX_ARCHIVED_DRAFTS = 50;

  // FPL league defaults (10-team, $200, 2QB / 2RB / 4 WR-TE flex / 4 bench, no K/DST).
  const DEFAULT_SETTINGS = {
    budget: 200,
    teams: 10,
    // Draftable slots only — IR excluded on purpose.
    slots: [
      { key: 'QB', label: 'QB', count: 2, accepts: ['QB'] },
      { key: 'RB', label: 'RB', count: 2, accepts: ['RB'] },
      { key: 'WRTE', label: 'WR/TE', count: 4, accepts: ['WR', 'TE'] },
      { key: 'BENCH', label: 'BN', count: 4, accepts: ['QB', 'RB', 'WR', 'TE', 'DST', 'K'] },
    ],
    // Replacement baselines for the value model, per pool. Null derives them from
    // starter demand; these came from fitting against real clearing prices, which is
    // what tools/calibrate.js and the panel's Calibrate button reproduce.
    baselines: { QB: 24, RB: 18, WRTE: 36 },
    // The league these baselines were fitted for. A fit does not transfer across
    // roster shapes — applying FPL's numbers to a 6-team 1QB league flattens the whole
    // curve (Allen $55 -> $30) — so changing teams or slots discards them and falls
    // back to deriving from starter demand.
    baselinesFor: 'QB=2,RB=2,WR/TE=4,BN=4@10',
  };

  // Identity of the league a fit belongs to: roster shape plus team count.
  const leagueSignature = (settings) =>
    settings.slots.map((s) => `${s.label}=${s.count}`).join(',') + '@' + settings.teams;

  const defaultState = () => ({
    settings: structuredClone(DEFAULT_SETTINGS),
    players: [],        // [{name, norm, pos, value, tier}]
    // Raw projections behind `players`, when values were computed rather than pasted
    // in finished. Calibration re-runs the model at many baselines and cannot do that
    // from dollar values alone, so the points have to survive the import.
    projections: [],    // [{name, norm, pos, pts}]
    // Sold log for everyone (drives inflation). [{norm, name, pos, price, mine, ts}]
    sold: [],
    // My roster rows point into `sold` via norm; kept separate for undo clarity.
    // [{norm, name, pos, price}]
    myRoster: [],
    // Which draft room the sold log and roster belong to. Mock and real drafts
    // have different league ids; without this, a mock's results follow you into
    // the real draft and quietly corrupt the budget.
    leagueKey: null,
    // Roster shape in force when this draft's first sale landed. Pinned there rather
    // than read at archive time: you finish a draft, reconfigure for the next one, and
    // only THEN enter the new room — reading it late stamps the finished draft with
    // the shape of the draft you are about to play.
    soldSignature: null,
    // Finished drafts kept for calibration. Every mock is a sample of what a room
    // pays, and those samples are the only way to fit replacement baselines — so
    // entering a new room banks the old one here instead of discarding it.
    archive: [],        // [{leagueKey, endedAt, sales: [{name, pos, price}]}]
    panel: { x: null, y: null, collapsed: false },
  });

  let state = defaultState();
  const listeners = new Set();

  const persist = debounce(() => {
    // chrome.* dies if the extension is reloaded while this page is still
    // open ("Extension context invalidated") — the refreshed page's fresh
    // script owns persistence from then on, so just go quiet.
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch {
      /* orphaned content script */
    }
  }, 150);

  function emit() {
    persist();
    for (const fn of listeners) fn(state);
  }

  const api = {
    get: () => state,

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async load() {
      let got = {};
      try {
        got = await chrome.storage.local.get(STORAGE_KEY);
      } catch {
        /* orphaned content script — run on in-memory defaults */
      }
      const saved = got[STORAGE_KEY];
      if (saved && typeof saved === 'object') {
        state = { ...defaultState(), ...saved };
        state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(saved.settings || {}) };
        // Drafts archived before shapes were recorded get stamped with the league
        // configured now. Not certain, but it is where they most likely came from,
        // and leaving them unlabelled would silently pool them into every fit.
        for (const d of state.archive) {
          if (!d.signature) d.signature = leagueSignature(state.settings);
        }
      }
      for (const fn of listeners) fn(state);
      return state;
    },

    setSettings(patch) {
      const next = { ...state.settings, ...patch };
      // Tuned baselines belong to the league they were fitted for. Silently carrying
      // them into a different roster shape is worse than having none.
      if (next.baselines && next.baselinesFor !== leagueSignature(next)) {
        next.baselines = null;
        next.baselinesFor = null;
      }
      state.settings = next;
      emit();
    },

    setPlayers(players, projections = null) {
      state.players = players;
      // Only replace projections when this import produced them; pasting a finished
      // values sheet leaves any earlier projections alone rather than blanking the
      // calibration input.
      if (projections) state.projections = projections;
      emit();
    },

    setBaselines(baselines) {
      state.settings = {
        ...state.settings,
        baselines: baselines || null,
        baselinesFor: baselines ? leagueSignature(state.settings) : null,
      };
      emit();
    },

    soldSet() {
      return new Set(state.sold.map((s) => s.norm));
    },

    // Record any sale. If mine, also add to roster. Dedupes by norm.
    markSold(player, { price = null, mine = false } = {}) {
      if (state.sold.some((s) => s.norm === player.norm)) return false;
      const row = {
        norm: player.norm, name: player.name, pos: player.pos,
        price: Number.isFinite(price) ? price : null, mine, ts: Date.now(),
      };
      if (!state.soldSignature) state.soldSignature = leagueSignature(state.settings);
      state.sold.push(row);
      if (mine && Number.isFinite(price)) {
        state.myRoster.push({ norm: player.norm, name: player.name, pos: player.pos, price });
      }
      emit();
      return true;
    },

    // Replace my roster with ESPN's version. Authoritative, so it also repairs
    // bad manual entries. No-ops when nothing changed — this runs on every scan
    // and must not trigger a render or a storage write each time.
    syncMyRoster(rows) {
      const key = (list) =>
        list.map((r) => `${r.norm}:${r.price}`).sort().join('|');
      if (key(rows) === key(state.myRoster)) return false;
      state.myRoster = rows.map((r) => ({ norm: r.norm, name: r.name, pos: r.pos, price: r.price }));
      // Anything I own is also sold; keep the sold log consistent.
      for (const r of state.myRoster) {
        const existing = state.sold.find((s) => s.norm === r.norm);
        if (existing) { existing.mine = true; existing.price = r.price; }
        else state.sold.push({ ...r, mine: true, ts: Date.now() });
      }
      emit();
      return true;
    },

    // Undo one sale (row from `sold` or `myRoster`) by norm.
    undoSold(norm) {
      state.sold = state.sold.filter((s) => s.norm !== norm);
      state.myRoster = state.myRoster.filter((r) => r.norm !== norm);
      emit();
    },

    setPanel(patch) {
      state.panel = { ...state.panel, ...patch };
      emit();
    },

    resetDraft() {
      state.sold = [];
      state.myRoster = [];
      state.soldSignature = null;
      emit();
    },

    // Bank the current draft's sales for calibration. Only priced sales are
    // observations — markSold stores price: null when an opponent's win was seen
    // without a number, and those tell us nothing about what the room pays.
    archiveCurrentDraft() {
      const sales = state.sold
        .filter((s) => Number.isFinite(s.price) && s.price > 0)
        .map((s) => ({ name: s.name, pos: s.pos, price: s.price }));
      if (!sales.length) return false;
      state.archive.push({
        leagueKey: state.leagueKey,
        // Prices only mean something against the roster that produced them. A 1QB
        // standard mock says nothing about what a quarterback costs in a 2QB league.
        signature: state.soldSignature || leagueSignature(state.settings),
        endedAt: Date.now(),
        sales,
      });
      if (state.archive.length > MAX_ARCHIVED_DRAFTS) {
        state.archive = state.archive.slice(-MAX_ARCHIVED_DRAFTS);
      }
      return true;
    },

    // Only drafts played under the current roster shape. Mixing shapes is the same
    // error as carrying baselines across leagues, one layer down.
    archivedSales() {
      const sig = leagueSignature(state.settings);
      return state.archive.filter((d) => d.signature === sig).flatMap((d) => d.sales);
    },

    // {matching, total} draft counts, for telling the user what the fit will use.
    archiveCounts() {
      const sig = leagueSignature(state.settings);
      const matching = state.archive.filter((d) => d.signature === sig);
      return {
        matchingDrafts: matching.length,
        totalDrafts: state.archive.length,
        matchingSales: matching.reduce((n, d) => n + d.sales.length, 0),
      };
    },

    clearArchive() {
      state.archive = [];
      emit();
    },

    // Entering a different draft room wipes the previous room's results, keeping
    // imported values and settings. The sales are archived first — they are the
    // whole input to calibration, and this is the only moment they exist.
    // Returns true if a wipe happened.
    ensureLeague(key) {
      if (!key) return false;
      if (state.leagueKey === key) return false;
      const hadData = state.sold.length > 0 || state.myRoster.length > 0;
      api.archiveCurrentDraft();
      state.leagueKey = key;
      state.sold = [];
      state.myRoster = [];
      state.soldSignature = null;
      emit();
      return hadData;
    },

    DEFAULT_SETTINGS,
  };

  NS.state = api;
})();
