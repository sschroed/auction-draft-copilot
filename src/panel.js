// Overlay panel. Shadow DOM so ESPN's CSS and ours never touch.
// Fully operable with zero detection: search box, I won, Gone, undo.
(() => {
  const NS = window.__adcp;
  const { fmt$, findPlayer, parseValuesCSV } = NS.util;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .panel {
      position: fixed; top: 12px; right: 12px; width: 322px;
      background: #101418; color: #e6e9ec; border: 1px solid #2a3138;
      border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.55);
      z-index: 2147483647; font-size: 13px; line-height: 1.35;
      user-select: none;
    }
    .panel.flash-amber { box-shadow: 0 0 0 3px #b8860b, 0 6px 24px rgba(0,0,0,.55); }
    .panel.flash-red   { box-shadow: 0 0 0 3px #c62828, 0 6px 24px rgba(0,0,0,.55); }
    .hdr {
      display: flex; align-items: center; gap: 6px; padding: 7px 10px;
      cursor: grab; border-bottom: 1px solid #2a3138; font-weight: 700;
    }
    .hdr .spacer { flex: 1; }
    .hdr button, .btn {
      background: #1c232a; color: #cfd6dc; border: 1px solid #333c45;
      border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px;
    }
    .hdr button:hover, .btn:hover { background: #26303a; }
    .body { padding: 8px 10px 10px; }
    .nums { display: flex; gap: 8px; margin-bottom: 8px; }
    .num { flex: 1; background: #161c22; border-radius: 8px; padding: 6px 8px; text-align: center; }
    .num .v { font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .num .l { font-size: 10px; color: #8b959e; text-transform: uppercase; letter-spacing: .04em; }
    .num.max .v { color: #7fd48a; }
    .pin {
      background: #161c22; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
      border-left: 4px solid #444;
    }
    .pin.go   { border-left-color: #43a047; }
    .pin.ok   { border-left-color: #789; }
    .pin.warn { border-left-color: #ffb300; }
    .pin.dead { border-left-color: #c62828; opacity: .8; }
    .pin .nm { font-size: 16px; font-weight: 800; }
    .pin .meta { color: #9aa4ad; font-size: 12px; margin: 2px 0; }
    .pin .vals { display: flex; gap: 12px; font-variant-numeric: tabular-nums; margin: 4px 0; }
    .pin .vals b { font-size: 19px; }
    .pin .bidto { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 2px 0; }
    .pin .bidto .lbl { font-size: 11px; font-weight: 600; color: #8b959e; text-transform: uppercase; letter-spacing: .05em; margin-right: 6px; }
    .pin .bidto.go { color: #7fd48a; } .pin .bidto.ok { color: #e6e9ec; }
    .pin .bidto.warn { color: #ffcc55; } .pin .bidto.dead { color: #ef7070; }
    .pin .verdict { font-weight: 700; font-size: 12px; }
    .pin .verdict.go { color: #7fd48a; } .pin .verdict.ok { color: #aab8c2; }
    .pin .verdict.warn { color: #ffcc55; } .pin .verdict.dead { color: #ef7070; }
    .pin .bid { font-variant-numeric: tabular-nums; color: #9aa4ad; font-size: 12px; }
    .pin .bid.over { color: #ef7070; font-weight: 700; }
    .row { display: flex; gap: 6px; margin-bottom: 8px; }
    input[type="text"], input[type="number"], textarea {
      background: #0c1013; color: #e6e9ec; border: 1px solid #333c45;
      border-radius: 6px; padding: 5px 7px; font-size: 13px; width: 100%;
      user-select: text;
    }
    input[type="number"] { width: 64px; font-variant-numeric: tabular-nums; }
    .needs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; font-variant-numeric: tabular-nums; }
    .need { background: #161c22; border-radius: 6px; padding: 2px 7px; font-size: 12px; }
    .need.full { color: #667077; }
    .need.open b { color: #7fd48a; }
    .roster { max-height: 130px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
    .roster li {
      display: flex; align-items: center; gap: 6px; padding: 2px 0;
      font-variant-numeric: tabular-nums; font-size: 12px;
    }
    .roster .p { flex: 1; white-space: normal; overflow-wrap: anywhere; }
    .roster .x { cursor: pointer; color: #8b959e; border: none; background: none; font-size: 12px; }
    .roster .x:hover { color: #ef7070; }
    .settings { border-top: 1px solid #2a3138; margin-top: 8px; padding-top: 8px; }
    .settings label { font-size: 11px; color: #8b959e; display: block; margin: 6px 0 2px; }
    .settings textarea { height: 90px; font-size: 11px; font-family: ui-monospace, Menlo, monospace; }
    .muted { color: #8b959e; font-size: 11px; }
    .plan {
      border-radius: 8px; padding: 6px 9px; margin-bottom: 8px;
      border-left: 4px solid #444; background: #161c22;
    }
    .plan .hd { font-size: 13px; font-weight: 800; letter-spacing: .01em; }
    .plan .dt { font-size: 11px; color: #9aa4ad; margin-top: 1px; }
    .plan.critical { border-left-color: #c62828; background: #241416; }
    .plan.critical .hd { color: #ff8a80; }
    .plan.warn { border-left-color: #ffb300; background: #241f13; }
    .plan.warn .hd { color: #ffcc55; }
    .plan.go { border-left-color: #43a047; }
    .plan.go .hd { color: #7fd48a; }
    .plan.ok .hd { color: #aab8c2; }
    .sect {
      font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
      color: #6b757d; margin: 0 0 3px 1px; font-weight: 700;
    }
    .bypos { margin-bottom: 8px; }
    /* Two lines per position: counts on top, the target underneath. Long names
       wrap instead of truncating — "Matthew Staff…" is useless mid-auction.
       NB: deliberately not called .row — the generic .row above is display:flex
       and was leaking in, laying these two lines side by side instead. */
    .bypos .posrow {
      display: block;
      padding: 4px 7px; background: #161c22; border-radius: 6px;
      margin-bottom: 3px; border-left: 3px solid #444;
      font-variant-numeric: tabular-nums;
    }
    .bypos .posrow.critical { border-left-color: #c62828; }
    .bypos .posrow.warn { border-left-color: #ffb300; }
    .bypos .posrow.go { border-left-color: #43a047; }
    .bypos .posrow.done { border-left-color: #2f3740; opacity: .5; }
    .bypos .posrow.done .tag { color: #7a848c; }
    .bypos .top { display: flex; align-items: baseline; gap: 7px; }
    .bypos .pos { font-weight: 800; font-size: 12px; }
    .bypos .cnt { font-size: 11px; color: #8b959e; flex: 1; }
    .bypos .tag { font-size: 10px; font-weight: 800; letter-spacing: .03em; }
    .bypos .posrow.critical .tag { color: #ef7070; }
    .bypos .posrow.warn .tag { color: #ffcc55; }
    .bypos .posrow.go .tag { color: #7fd48a; }
    .bypos .bestp {
      font-size: 11px; color: #cfd6dc; margin-top: 2px;
      white-space: normal; overflow-wrap: anywhere; line-height: 1.3;
    }
    .bypos .bestp b { color: #7fd48a; font-variant-numeric: tabular-nums; }
    .notice {
      background: #1d2a1f; border: 1px solid #2f5134; color: #9fe0aa;
      border-radius: 6px; padding: 5px 8px; margin-bottom: 8px; font-size: 11px;
    }
    .hidden { display: none !important; }
    .linkbtn {
      background: none; border: none; color: #8b959e; font-size: 11px;
      padding: 4px 0; cursor: pointer; text-align: left; width: 100%;
    }
    .linkbtn:hover { color: #e6e9ec; }
    .adv { border-top: 1px dashed #2a3138; margin-top: 4px; padding-top: 4px; }
    .settings .copyout { height: 70px; font-size: 10px; font-family: ui-monospace, Menlo, monospace; }
    .calout { white-space: pre-wrap; font-family: ui-monospace, Menlo, monospace; line-height: 1.5; }
    .calout .apply {
      background: #1b2a1d; border: 1px solid #3c6b42; color: #7fd48a;
      border-radius: 5px; padding: 1px 6px; font-size: 10px; cursor: pointer; margin-left: 6px;
    }
    .searchwrap { position: relative; flex: 1; }
    .sugg {
      position: absolute; top: 100%; left: 0; right: 0; background: #161c22;
      border: 1px solid #333c45; border-radius: 6px; z-index: 5; overflow: hidden;
    }
    .sugg div { padding: 4px 8px; cursor: pointer; font-size: 12px; }
    .sugg div:hover, .sugg div.sel { background: #26303a; }
  `;

  const el = (tag, attrs = {}, text = '') => {
    const e = document.createElement(tag);
    Object.assign(e, attrs);
    if (text) e.textContent = text;
    return e;
  };

  let root, panel, refs = {};
  let pinnedIdx = -1;
  let pinnedUnknown = null; // {name, pos} nominated but not in imported list
  let espnMax = null;       // ESPN's own "max $N" for reconciliation
  let maxOpposing = null;   // richest opponent — the real ceiling on any price
  let currentBid = null;    // live bid on the pinned player
  let flashTimer = null;

  // The currently pinned thing as a player-shaped object, or null.
  function pinnedPlayer(st) {
    if (pinnedIdx >= 0 && st.players[pinnedIdx]) return st.players[pinnedIdx];
    if (pinnedUnknown) {
      return {
        name: pinnedUnknown.name,
        norm: NS.util.normalizeName(pinnedUnknown.name),
        pos: pinnedUnknown.pos || '?',
        value: 0, tier: null, unknown: true,
      };
    }
    return null;
  }

  const slotCount = (st, key) => {
    const s = st.settings.slots.find((x) => x.key === key);
    return s ? `${s.count}/${s.count}` : '';
  };

  // Slot spec parsing lives in util.js so the Node tools describe a league the same way.
  const { slotsToSpec, specToSlots, configFromSlots } = NS.util;

  // The value model's config for the league currently configured in settings.
  function modelConfig(st) {
    return configFromSlots(st.settings.slots, {
      teams: st.settings.teams,
      budget: st.settings.budget,
      baselines: st.settings.baselines,
    });
  }

  // Baselines use the same LABEL=count spec as the roster slots, so "QB=24, RB=18,
  // WR/TE=36" reads the same way in both boxes. Empty means derive from starters.
  function baselinesToSpec(baselines) {
    if (!baselines || !Object.keys(baselines).length) return '';
    return Object.keys(baselines)
      .sort()
      .map((k) => `${k.replace('WRTE', 'WR/TE')}=${baselines[k]}`)
      .join(', ');
  }
  function specToBaselines(spec) {
    const slots = specToSlots(spec);
    if (!slots) return null;
    const out = {};
    for (const s of slots) out[s.key] = s.count;
    return out;
  }

  function build() {
    const host = el('div');
    host.id = 'adcp-host';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.appendChild(el('style', {}, ''));
    root.querySelector('style').textContent = CSS;

    panel = el('div', { className: 'panel' });
    root.appendChild(panel);

    // Header
    const hdr = el('div', { className: 'hdr' });
    hdr.append(el('span', {}, '💰 Co-Pilot'));
    refs.detBadge = el('span', { className: 'muted' }, '');
    hdr.append(refs.detBadge);
    hdr.append(el('span', { className: 'spacer' }));
    refs.gearBtn = el('button', { title: 'Settings' }, '⚙');
    refs.collapseBtn = el('button', { title: 'Collapse' }, '—');
    hdr.append(refs.gearBtn, refs.collapseBtn);
    panel.append(hdr);

    refs.body = el('div', { className: 'body' });
    panel.append(refs.body);

    refs.notice = el('div', { className: 'notice hidden' });
    refs.body.append(refs.notice);

    // Big numbers
    refs.nums = el('div', { className: 'nums' });
    refs.body.append(refs.nums);

    // What to do this second.
    refs.nowLabel = el('div', { className: 'sect hidden' }, 'Do now');
    refs.plan = el('div', { className: 'plan hidden' });
    refs.body.append(refs.nowLabel, refs.plan);

    // Per-position standing orders.
    refs.byposLabel = el('div', { className: 'sect hidden' }, 'By position');
    refs.bypos = el('div', { className: 'bypos hidden' });
    refs.body.append(refs.byposLabel, refs.bypos);

    // Pinned player card
    refs.pin = el('div', { className: 'pin' });
    refs.body.append(refs.pin);

    // Search + actions
    const row1 = el('div', { className: 'row' });
    const sw = el('div', { className: 'searchwrap' });
    refs.search = el('input', { type: 'text', placeholder: 'Search player… (2-3 letters)' });
    refs.sugg = el('div', { className: 'sugg hidden' });
    sw.append(refs.search, refs.sugg);
    row1.append(sw);
    refs.body.append(row1);

    const row2 = el('div', { className: 'row' });
    refs.price = el('input', { type: 'number', placeholder: '$', min: 1 });
    refs.wonBtn = el('button', { className: 'btn' }, 'I won');
    refs.goneBtn = el('button', { className: 'btn' }, 'Gone');
    row2.append(refs.price, refs.wonBtn, refs.goneBtn);
    refs.body.append(row2);

    // Positional needs
    refs.needs = el('div', { className: 'needs' });
    refs.body.append(refs.needs);

    // Roster
    refs.roster = el('ul', { className: 'roster' });
    refs.body.append(refs.roster);

    // Settings
    refs.settings = el('div', { className: 'settings hidden' });
    refs.settings.append(el('label', {}, 'Budget / Teams'));
    const srow = el('div', { className: 'row' });
    refs.setBudget = el('input', { type: 'number', min: 1 });
    refs.setTeams = el('input', { type: 'number', min: 2 });
    srow.append(refs.setBudget, refs.setTeams);
    refs.settings.append(srow);
    refs.settings.append(el('label', {}, 'Roster slots (LABEL=count, WR/TE etc.)'));
    refs.setSlots = el('input', { type: 'text' });
    refs.settings.append(refs.setSlots);
    refs.settings.append(el('label', {}, 'Values (Name,Pos,Value,Tier) or projections (Name,Pos,ProjPts)'));
    refs.csv = el('textarea', { placeholder: 'Justin Jefferson,WR,58,1' });
    refs.settings.append(refs.csv);
    const brow = el('div', { className: 'row' });
    refs.importBtn = el('button', { className: 'btn' }, 'Import');
    refs.snippetBtn = el('button', { className: 'btn' }, 'Copy pull script');
    refs.resetBtn = el('button', { className: 'btn' }, 'Reset draft');
    brow.append(refs.importBtn, refs.snippetBtn, refs.resetBtn);
    refs.settings.append(brow);
    refs.importMsg = el('div', { className: 'muted' }, '');
    refs.settings.append(refs.importMsg);

    // Copy-to-clipboard can be refused (no user activation, page not focused). Rather
    // than fail silently or open a dialog, reveal the text pre-selected so it can be
    // copied by hand.
    refs.copyOut = el('textarea', { className: 'copyout hidden', readOnly: true });
    refs.settings.append(refs.copyOut);

    // Calibration — the mock-draft loop. Hidden behind a disclosure because it is a
    // between-drafts activity and the panel is otherwise tuned for live use.
    refs.advToggle = el('button', { className: 'linkbtn' }, '▸ calibration');
    refs.settings.append(refs.advToggle);
    refs.adv = el('div', { className: 'adv hidden' });
    refs.adv.append(el('label', {}, 'Replacement baselines (blank = derive from starters)'));
    refs.setBaselines = el('input', { type: 'text', placeholder: 'QB=24, RB=18, WR/TE=36' });
    refs.adv.append(refs.setBaselines);
    refs.archiveMsg = el('div', { className: 'muted' }, '');
    refs.adv.append(refs.archiveMsg);
    const crow = el('div', { className: 'row' });
    refs.calibrateBtn = el('button', { className: 'btn' }, 'Calibrate');
    refs.exportBtn = el('button', { className: 'btn' }, 'Export sales');
    refs.clearArchiveBtn = el('button', { className: 'btn' }, 'Clear archive');
    crow.append(refs.calibrateBtn, refs.exportBtn, refs.clearArchiveBtn);
    refs.adv.append(crow);
    refs.calibrateOut = el('div', { className: 'muted calout' }, '');
    refs.adv.append(refs.calibrateOut);
    refs.settings.append(refs.adv);

    refs.body.append(refs.settings);

    wireEvents(hdr);
    // Populate settings inputs now. They used to fill in only when the gear was
    // clicked, so the baselines box read empty while baselines were actually set.
    syncSettingsInputs();
  }

  function wireEvents(hdr) {
    const S = NS.state;

    // Drag by header.
    let drag = null;
    hdr.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto';
      drag.pos = { x, y };
    });
    window.addEventListener('mouseup', () => {
      if (drag && drag.pos) S.setPanel(drag.pos);
      drag = null;
    });

    refs.collapseBtn.addEventListener('click', () => {
      const collapsed = !S.get().panel.collapsed;
      S.setPanel({ collapsed });
    });
    refs.gearBtn.addEventListener('click', () => {
      refs.settings.classList.toggle('hidden');
      syncSettingsInputs();
    });

    // Search with suggestions.
    refs.search.addEventListener('input', () => {
      const qtext = refs.search.value.trim();
      refs.sugg.innerHTML = '';
      if (qtext.length < 2) { refs.sugg.classList.add('hidden'); return; }
      const st = S.get();
      const soldSet = S.soldSet();
      const seen = new Set();
      const items = [];
      // Collect up to 5 matches by repeatedly excluding found ones.
      const excluded = new Set(soldSet);
      for (let k = 0; k < 5; k++) {
        const i = findPlayer(st.players, qtext, { excludeSold: excluded });
        if (i === -1) break;
        excluded.add(st.players[i].norm);
        if (!seen.has(i)) { seen.add(i); items.push(i); }
      }
      if (!items.length) { refs.sugg.classList.add('hidden'); return; }
      for (const i of items) {
        const p = st.players[i];
        const d = el('div', {}, `${p.name} · ${p.pos} · ${fmt$(p.value)}`);
        d.addEventListener('mousedown', (e) => { e.preventDefault(); pin(i, 'manual'); });
        refs.sugg.append(d);
      }
      refs.sugg.classList.remove('hidden');
    });
    refs.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const st = S.get();
        const i = findPlayer(st.players, refs.search.value, { excludeSold: S.soldSet() });
        if (i !== -1) pin(i, 'manual');
      }
      if (e.key === 'Escape') { refs.sugg.classList.add('hidden'); refs.search.blur(); }
      e.stopPropagation();
    });
    refs.search.addEventListener('blur', () => setTimeout(() => refs.sugg.classList.add('hidden'), 150));

    refs.wonBtn.addEventListener('click', () => {
      const p = pinnedPlayer(S.get());
      if (!p) return;
      const price = Number(refs.price.value);
      if (!Number.isFinite(price) || price < 1) { refs.price.focus(); return; }
      S.markSold(p, { price, mine: true });
      refs.price.value = '';
      clearPin();
    });
    refs.goneBtn.addEventListener('click', () => {
      const p = pinnedPlayer(S.get());
      if (!p) return;
      const price = Number(refs.price.value);
      S.markSold(p, { price: Number.isFinite(price) && price >= 1 ? price : null, mine: false });
      refs.price.value = '';
      clearPin();
    });

    refs.importBtn.addEventListener('click', () => {
      const st = S.get();
      const format = NS.util.sniffPasteFormat(refs.csv.value, { budget: st.settings.budget });
      const skipped = (errors) => (errors.length ? ` · ${errors.length} line(s) skipped` : '');

      if (format === 'values') {
        const { players, errors } = parseValuesCSV(refs.csv.value);
        if (players.length) S.setPlayers(players);
        refs.importMsg.textContent = `${players.length} values imported` + skipped(errors);
        return;
      }

      // Projections: price them here rather than making anyone run Node.
      const { players: proj, errors } = NS.util.parseProjectionsCSV(refs.csv.value);
      if (!proj.length) {
        refs.importMsg.textContent = 'Nothing to import — expected Name,Pos,ProjPts' + skipped(errors);
        return;
      }
      const cfg = modelConfig(st);
      const priced = proj.map((p) => ({ name: p.name, norm: p.norm, pos: p.pos, pts: p.pts }));
      // value-model.js is UMD and registers on the global; in a content script that
      // is the isolated world's window, not the page's.
      const { replacementCounts } = window.ValueModel.computeValues(priced, cfg);
      S.setPlayers(
        priced.map((p) => ({ name: p.name, norm: p.norm, pos: p.pos, value: p.value, tier: p.tier })),
        proj.map((p) => ({ name: p.name, norm: p.norm, pos: p.pos, pts: p.pts })),
      );
      // Never leave the format decision implicit — say what was detected and which
      // baselines produced the numbers, so a wrong guess is visible immediately.
      const above = priced.filter((p) => p.value > 1).length;
      refs.importMsg.textContent =
        `Computed ${above} values from ${proj.length} projections · ` +
        `${NS.calibrate.labelFor(replacementCounts)}` + skipped(errors);
    });

    // Reveal-and-select fallback for a refused clipboard write. No dialogs.
    function offerCopy(text, label) {
      refs.copyOut.value = text;
      const reveal = () => {
        refs.copyOut.classList.remove('hidden');
        refs.copyOut.focus();
        refs.copyOut.select();
        refs.importMsg.textContent = `${label} — select all and copy`;
      };
      try {
        navigator.clipboard.writeText(text).then(
          () => {
            refs.copyOut.classList.add('hidden');
            refs.importMsg.textContent = `${label} copied to clipboard`;
          },
          reveal,
        );
      } catch {
        reveal();
      }
    }

    refs.snippetBtn.addEventListener('click', () => {
      const leagueId = (location.search.match(/leagueId=(\d+)/) || [])[1];
      if (!leagueId) {
        refs.importMsg.textContent = 'No leagueId in this URL — open the draft room from your league.';
        return;
      }
      const positions = [...new Set(S.get().settings.slots.flatMap((sl) => sl.accepts))];
      offerCopy(
        NS.snippet.buildSnippet({ leagueId, positions }),
        `Pull script for league ${leagueId}`,
      );
    });

    refs.advToggle.addEventListener('click', () => {
      const hidden = refs.adv.classList.toggle('hidden');
      refs.advToggle.textContent = hidden ? '▸ calibration' : '▾ calibration';
      if (!hidden) renderArchiveMsg();
    });

    refs.setBaselines.addEventListener('change', () => {
      const spec = refs.setBaselines.value.trim();
      S.setBaselines(spec ? specToBaselines(spec) : null);
      refs.calibrateOut.textContent = spec
        ? 'Baselines set — re-import to reprice.'
        : 'Baselines cleared — derived from starters. Re-import to reprice.';
    });

    refs.exportBtn.addEventListener('click', () => {
      const sales = S.archivedSales().concat(
        S.get().sold.filter((x) => Number.isFinite(x.price) && x.price > 0)
          .map((x) => ({ name: x.name, pos: x.pos, price: x.price })),
      );
      if (!sales.length) {
        refs.calibrateOut.textContent = 'No priced sales yet.';
        return;
      }
      offerCopy(NS.calibrate.toSalesCSV(sales), `${sales.length} sales`);
    });

    let clearArmed = null;
    refs.clearArchiveBtn.addEventListener('click', () => {
      if (clearArmed) {
        clearTimeout(clearArmed);
        clearArmed = null;
        refs.clearArchiveBtn.textContent = 'Clear archive';
        S.clearArchive();
        renderArchiveMsg();
        refs.calibrateOut.textContent = 'Archive cleared.';
        return;
      }
      refs.clearArchiveBtn.textContent = 'Sure? tap again';
      clearArmed = setTimeout(() => {
        clearArmed = null;
        refs.clearArchiveBtn.textContent = 'Clear archive';
      }, 4000);
    });

    refs.calibrateBtn.addEventListener('click', () => {
      const st = S.get();
      if (!st.projections.length) {
        refs.calibrateOut.textContent =
          'Import projections first — fitting baselines re-runs the model, which needs points, not dollars.';
        return;
      }
      const observations = S.archivedSales().concat(
        st.sold.filter((x) => Number.isFinite(x.price) && x.price > 0)
          .map((x) => ({ name: x.name, pos: x.pos, price: x.price })),
      ).map((o) => ({ ...o, norm: NS.util.normalizeName(o.name) }));

      const result = NS.calibrate.sweep({
        projections: st.projections,
        observations,
        cfg: modelConfig(st),
      });
      if (!result.ok) {
        refs.calibrateOut.textContent = result.reason;
        return;
      }
      renderCalibration(result);
    });
    // Two-click confirm instead of confirm(): a native dialog blocks every event
    // in the page until dismissed, which is the last thing you want mid-auction.
    let resetArmed = null;
    refs.resetBtn.addEventListener('click', () => {
      if (resetArmed) {
        clearTimeout(resetArmed);
        resetArmed = null;
        refs.resetBtn.textContent = 'Reset draft';
        S.resetDraft();
        // Re-read the pick feed so anything already sold comes back immediately;
        // otherwise the cleared log can never rebuild itself.
        if (NS.detect && NS.detect.resync) NS.detect.resync();
        notice('Draft results cleared and re-synced from ESPN.');
        return;
      }
      refs.resetBtn.textContent = 'Sure? tap again';
      resetArmed = setTimeout(() => {
        resetArmed = null;
        refs.resetBtn.textContent = 'Reset draft';
      }, 4000);
    });

    for (const inp of [refs.setBudget, refs.setTeams, refs.setSlots]) {
      inp.addEventListener('change', () => {
        const patch = {};
        const b = Number(refs.setBudget.value); if (b > 0) patch.budget = b;
        const t = Number(refs.setTeams.value); if (t >= 2) patch.teams = t;
        const slots = specToSlots(refs.setSlots.value); if (slots) patch.slots = slots;
        S.setSettings(patch);
      });
    }

    // Keep keystrokes inside the panel from reaching ESPN's page handlers.
    for (const evt of ['keydown', 'keyup', 'keypress']) {
      panel.addEventListener(evt, (e) => e.stopPropagation());
    }
  }

  function syncSettingsInputs() {
    const st = NS.state.get();
    refs.setBudget.value = st.settings.budget;
    refs.setTeams.value = st.settings.teams;
    refs.setSlots.value = slotsToSpec(st.settings.slots);
    if (document.activeElement !== refs.setBaselines) {
      refs.setBaselines.value = baselinesToSpec(st.settings.baselines);
    }
    if (!refs.csv.value && st.players.length) {
      refs.importMsg.textContent = `${st.players.length} players loaded`;
    }
    renderArchiveMsg();
  }

  function renderArchiveMsg() {
    if (!refs.archiveMsg) return;
    const st = NS.state.get();
    const { matchingDrafts, totalDrafts, matchingSales } = NS.state.archiveCounts();
    const live = st.sold.filter((x) => Number.isFinite(x.price) && x.price > 0).length;
    const others = totalDrafts - matchingDrafts;
    refs.archiveMsg.textContent =
      `${matchingDrafts} draft${matchingDrafts === 1 ? '' : 's'} · ${matchingSales + live} priced sales` +
      (live ? ` (${live} live)` : '') +
      (others ? ` · ${others} archived under another roster shape, not used` : '');
  }

  // Top few candidates with an Apply button each. Bias is shown because it says WHERE
  // the model is wrong — a big positive at one position is the signal that moved the
  // FPL baselines, and RMSE alone hides it.
  function renderCalibration(result) {
    refs.calibrateOut.textContent = '';
    const head = el('div', {}, `${result.n} sales matched${result.thin ? ' — thin sample, treat as a hint' : ''}`);
    refs.calibrateOut.append(head);
    for (const r of result.rows.slice(0, 3)) {
      const bias = Object.keys(r.bias).sort()
        .map((pos) => `${pos}${r.bias[pos] >= 0 ? '+' : ''}${r.bias[pos].toFixed(0)}`)
        .join(' ');
      const line = el('div', {}, `${r.label} · RMSE $${r.rmse.toFixed(1)} · ${bias}`);
      if (r.fixedCounts) {
        const btn = el('button', { className: 'apply' }, 'apply');
        btn.addEventListener('click', () => {
          NS.state.setBaselines(r.fixedCounts);
          refs.setBaselines.value = baselinesToSpec(r.fixedCounts);
          refs.calibrateOut.textContent = `Applied ${r.label} — re-import your projections to reprice.`;
        });
        line.append(btn);
      }
      refs.calibrateOut.append(line);
    }
  }

  function pin(idx, source) {
    pinnedIdx = idx;
    pinnedUnknown = null;
    currentBid = null; // stale bid from the previous player must not leak across
    if (source === 'manual') { refs.search.value = ''; refs.sugg.classList.add('hidden'); }
    render(NS.state.get());
  }
  function pinUnknown(info) {
    pinnedIdx = -1;
    pinnedUnknown = info;
    currentBid = null;
    render(NS.state.get());
  }
  function clearPin() {
    pinnedIdx = -1; pinnedUnknown = null; currentBid = null;
    render(NS.state.get());
  }

  function setEspnMax(n) {
    if (n === espnMax) return;
    espnMax = n;
    render(NS.state.get());
  }

  function setBudgets({ maxOpposing: mo }) {
    if (mo === maxOpposing) return;
    maxOpposing = mo;
    render(NS.state.get());
  }

  function setBid(amount) {
    const st = NS.state.get();
    const p = pinnedPlayer(st);
    if (!p) return;
    const changed = amount !== currentBid;
    currentBid = amount;
    const sum = NS.engine.summarize(st);
    panel.classList.remove('flash-amber', 'flash-red');
    if (amount > sum.maxBid) panel.classList.add('flash-red');
    else if (amount >= sum.maxBid - 3) panel.classList.add('flash-amber');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => panel.classList.remove('flash-amber', 'flash-red'), 4000);
    if (refs.bidLine) {
      const bidTo = p.unknown ? 1 : Math.min(NS.engine.adjValue(p, sum.inflation), sum.maxBid);
      if (amount > bidTo) {
        refs.bidLine.textContent = `current bid ${fmt$(amount)} — OVERPRICED (worth ${fmt$(bidTo)})`;
        refs.bidLine.classList.add('over');
      } else {
        refs.bidLine.textContent = `current bid ${fmt$(amount)}`;
        refs.bidLine.classList.remove('over');
      }
    }
    // The DO NOW line flips between BID and PASS on the live bid, so it has to
    // re-render when the price moves — not only when state changes.
    if (changed) render(st);
  }

  function setDetectionStatus(text) { refs.detBadge.textContent = text; }

  let noticeTimer = null;
  function notice(text, ms = 8000) {
    if (!refs.notice) return;
    refs.notice.textContent = text;
    refs.notice.classList.remove('hidden');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => refs.notice.classList.add('hidden'), ms);
  }

  function render(st) {
    const sum = NS.engine.summarize(st);

    // Sales land continuously during a draft, so the archive line has to follow the
    // state like everything else. It used to refresh only when the gear was toggled,
    // which meant the count sat stale for a whole auction.
    renderArchiveMsg();

    panel.style.left = st.panel.x != null ? st.panel.x + 'px' : '';
    panel.style.top = st.panel.y != null ? st.panel.y + 'px' : '';
    if (st.panel.x != null) panel.style.right = 'auto';
    refs.body.classList.toggle('hidden', !!st.panel.collapsed);
    refs.collapseBtn.textContent = st.panel.collapsed ? '▢' : '—';

    // Big numbers
    refs.nums.innerHTML = '';
    const nums = [
      [fmt$(sum.budgetLeft), 'left'],
      [fmt$(sum.maxBid), 'max bid', 'max'],
      [fmt$(sum.avgPerSlot), '/slot'],
      [`${sum.slotsFilled}/${sum.slotsTotal}`, 'slots'],
    ];
    for (const [v, l, cls] of nums) {
      const d = el('div', { className: 'num' + (cls ? ' ' + cls : '') });
      d.append(el('div', { className: 'v' }, v), el('div', { className: 'l' }, l));
      refs.nums.append(d);
    }

    // DO NOW — the live decision, and BY POSITION — standing orders.
    const rows = NS.engine.scarcity(st, sum);
    const pinnedNow = pinnedPlayer(st);
    const alloc = NS.engine.allocate(st, sum, rows);
    const caps = { maxOpposing, espnMax, alloc };
    const action = NS.engine.nextAction(st, sum, rows, pinnedNow, currentBid, caps);

    refs.plan.innerHTML = '';
    if (!action) {
      refs.plan.classList.add('hidden');
      refs.nowLabel.classList.add('hidden');
    } else {
      refs.nowLabel.classList.remove('hidden');
      refs.plan.className = `plan ${action.level}`;
      refs.plan.append(el('div', { className: 'hd' }, action.text));
      refs.plan.append(el('div', { className: 'dt' }, action.detail));
    }

    refs.bypos.innerHTML = '';
    if (!rows.length) {
      refs.bypos.classList.add('hidden');
      refs.byposLabel.classList.add('hidden');
    } else {
      refs.bypos.classList.remove('hidden');
      refs.byposLabel.classList.remove('hidden');
      // Keep a stable QB / RB / WR-TE order so the eye learns where to look,
      // rather than reordering by urgency mid-auction.
      const ordered = st.settings.slots
        .map((s) => rows.find((r) => r.key === s.key))
        .filter(Boolean);
      for (const r of ordered) {
        const row = el('div', { className: `posrow ${r.urgency.level}` });
        const top = el('div', { className: 'top' });
        top.append(el('div', { className: 'pos' }, r.label));
        const g = alloc.groups[r.key];
        top.append(el('div', { className: 'cnt' },
          r.need === 0
            ? `${slotCount(st, r.key)} filled · spent ${fmt$(g ? g.spent : 0)}`
            : `need ${r.need} · ${r.supply} left · budget ${fmt$(g ? g.budget : 0)}`));
        top.append(el('div', { className: 'tag' }, r.urgency.label));
        row.append(top);

        const line = el('div', { className: 'bestp' });
        if (r.need === 0) {
          line.append(document.createTextNode('starters set — bench value only'));
        } else if (r.best) {
          // The number you would actually bid, not raw value — same engine call
          // as BID TO, so the room-max and budget ceilings are already applied.
          const bt = NS.engine.bidTo(st, sum, r.best,
            { ...caps, spendCap: NS.engine.spendCap(st, sum, rows, r.best, alloc) });
          line.append(document.createTextNode(r.best.name + ' — bid to '));
          line.append(el('b', {}, bt && !bt.pass ? fmt$(bt.amount) : '—'));
        } else {
          line.append(document.createTextNode('nobody left worth bidding on'));
        }
        row.append(line);
        row.title = `Filling ${r.need} ${r.label} costs about ${fmt$(r.costToFill)} at current prices`;
        refs.bypos.append(row);
      }
    }

    // Pinned card
    refs.pin.className = 'pin';
    refs.pin.innerHTML = '';
    const p = pinnedPlayer(st);
    if (!p) {
      refs.pin.append(el('div', { className: 'meta' },
        st.players.length ? 'Waiting for nomination — or search below.' : 'Import your values in ⚙ settings.'));
    } else {
      const v = p.unknown
        ? { text: 'NOT IN YOUR LIST — $1 flier only', level: 'warn' }
        : NS.engine.verdict(st, sum, p);
      refs.pin.classList.add(v.level);
      refs.pin.append(el('div', { className: 'nm' }, p.name));
      refs.pin.append(el('div', { className: 'meta' },
        `${p.pos}${p.tier != null ? ' · Tier ' + p.tier : ''}`));
      const vals = el('div', { className: 'vals' });
      const mk = (label, val) => {
        const d = el('div');
        d.append(el('div', { className: 'muted' }, label), el('b', {}, val));
        return d;
      };
      vals.append(
        mk('value', fmt$(p.value)),
        mk('adj', fmt$(NS.engine.adjValue(p, sum.inflation))),
        mk('my max', fmt$(sum.maxBid)),
      );
      refs.pin.append(vals);
      // The one number to act on: bid up to min(adjusted value, my max) —
      // $1 for unlisted fliers, PASS when the slot is filled or roster full.
      const bidTo = el('div', { className: `bidto ${v.level}` });
      bidTo.append(el('span', { className: 'lbl' }, 'bid to'));
      // Same engine call and the same roster-construction cap the DO NOW line
      // uses, so the two can never disagree.
      const bt = NS.engine.bidTo(st, sum, p,
        { ...caps, spendCap: NS.engine.spendCap(st, sum, rows, p, alloc) });
      if (bt.pass) {
        bidTo.append(el('span', {}, 'PASS'));
      } else {
        bidTo.append(el('span', {}, fmt$(bt.amount)));
        if (bt.cappedBy != null) {
          bidTo.append(el('span', { className: 'lbl', style: 'margin-left:8px' },
            'room can only reach ' + fmt$(bt.cappedBy)));
        }
      }
      refs.pin.append(bidTo);
      refs.pin.append(el('div', { className: `verdict ${v.level}` }, v.text));
      refs.bidLine = el('div', { className: 'bid' }, '');
      refs.pin.append(refs.bidLine);
    }

    // Needs
    refs.needs.innerHTML = '';
    for (const n of sum.needs) {
      const d = el('div', { className: 'need ' + (n.open > 0 ? 'open' : 'full') });
      d.innerHTML = `${n.label} <b>${n.filled}/${n.count}</b>`;
      refs.needs.append(d);
    }
    const infl = el('div', { className: 'need' });
    infl.textContent = `infl ×${sum.inflation.toFixed(2)}`;
    refs.needs.append(infl);
    if (maxOpposing != null) {
      const room = el('div', { className: 'need' });
      room.style.color = maxOpposing < 10 ? '#7fd48a' : '#aab8c2';
      room.textContent = `room max ${fmt$(maxOpposing)}`;
      room.title = 'Richest opponent. No player can cost you more than this + $1.';
      refs.needs.append(room);
    }
    // Position-run alert: 3+ same-position sales in the last 5 picks.
    if (sum.run) {
      const runChip = el('div', { className: 'need' });
      runChip.style.color = '#ffcc55';
      runChip.textContent = `⚠ ${sum.run.pos} run`;
      runChip.title = `${sum.run.n} of the last 5 sales were ${sum.run.pos}s — prices there are spiking`;
      refs.needs.append(runChip);
    }
    // Reconcile against ESPN's own max when detection has seen one.
    // ESPN reserves a dollar for the IR slot, so it sits $1 under our figure as a
    // matter of convention. Only flag a real divergence, or the chip is always on
    // and stops meaning anything.
    if (espnMax != null && Math.abs(espnMax - sum.maxBid) > 1) {
      const warn = el('div', { className: 'need' });
      warn.style.color = '#ffcc55';
      warn.textContent = `⚠ ESPN max ${fmt$(espnMax)}`;
      warn.title = 'ESPN disagrees with tracked budget — check your roster log';
      refs.needs.append(warn);
    }

    // Roster
    refs.roster.innerHTML = '';
    for (const r of st.myRoster) {
      const li = el('li');
      li.append(
        el('span', { className: 'p' }, `${r.pos} ${r.name}`),
        el('span', {}, fmt$(r.price)),
      );
      const x = el('button', { className: 'x', title: 'Undo' }, '↩');
      x.addEventListener('click', () => NS.state.undoSold(r.norm));
      li.append(x);
      refs.roster.append(li);
    }
  }

  NS.panel = {
    init() {
      build();
      NS.state.subscribe(render);
      render(NS.state.get());
    },
    pin, pinUnknown, clearPin, setBid, setEspnMax, setBudgets, setDetectionStatus, notice,
    getPinnedIdx: () => pinnedIdx,
  };
})();
