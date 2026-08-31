// Passive DOM detection. One throttled MutationObserver, three concerns:
// nomination, current bid, sold feed. Read-only — textContent only, no events
// dispatched, nothing clicked.
//
// Selectors verified against a live ESPN mock draft (2026-08-30 recon,
// reference/dom-snapshots/). Multiple candidates per target, class-fragment
// based; the text-scan fallback works even if all of them rot.
(() => {
  const NS = window.__adcp;
  const { normalizeName, throttle } = NS.util;

  const SELECTORS = {
    // The on-the-block area.
    nominationName: [
      '[data-testid="player-selected"] .playerinfo__playername',
      '[class*="player-selected__player-info"] [class*="playername"]',
    ],
    nominationPos: [
      '[data-testid="player-selected"] .playerinfo__playerpos',
    ],
    nominationBox: [
      '[data-testid="player-selected"]',
      '[class*="pickArea"]',
    ],
    currentBid: [
      '[data-testid="bidding-form"] .current-amount',
      '[class*="bidding-form"] [class*="current-amount"]',
    ],
    // ESPN's own computed max for me: "Manual offer (max $189)".
    espnMax: [
      '[data-testid="bidding-form"] .manual-bid',
      '[class*="bidding-form"] [class*="manual-bid"]',
    ],
    // Sold/pick messages feed rows. Carries the buying team (needed to spot my
    // own wins) but only holds recent messages, so it is not a complete history.
    pickRows: [
      'li[class*="pick-message__container"]',
    ],
    // The draft board holds EVERY completed pick, so it is the authoritative
    // sold list — the feed had 27 rows when the board had 51. It has no buying
    // team, so it backstops the feed rather than replacing it.
    boardCells: [
      '[class*="draft-board-grid-pick-cell"][class*="completedPick"]',
    ],
    pickRowName: '.playerinfo__playername',
    pickRowInfo: '[class*="pick-info"]',
    // My card in the pick train (has my team name + remaining cash).
    myPickCard: [
      '[class*="auction-pick-component--own"]',
    ],
    // ESPN's own roster panel — the authoritative record of what I actually own
    // and paid. The abbreviated cell text ("B. Purdy") is useless for matching,
    // but the cell carries title="Brock Purdy".
    rosterTeamPicker: ['[class*="roster"] select', 'select'],
    // One card per team, each showing that team's remaining cash.
    pickTrainCards: [
      '[data-testid="auction-pick"]',
      '[class*="auction-pick-component"]',
    ],
    myBudget: [
      '[class*="auction-pick-component--own"] [class*="cash"]',
    ],
  };

  const q1 = (list, root = document) => {
    for (const sel of list) {
      try { const el = root.querySelector(sel); if (el) return el; } catch { /* bad sel */ }
    }
    return null;
  };
  const qAll = (list, root = document) => {
    for (const sel of list) {
      try { const els = root.querySelectorAll(sel); if (els.length) return [...els]; } catch { /* bad sel */ }
    }
    return [];
  };

  // Handlers wired by content.js.
  let hooks = null;
  let observer = null;
  let lastNominationKey = '';
  let lastBid = null;
  const seenSoldLines = new Set();

  const moneyRe = /\$\s*(\d{1,3})/;

  function matchNameIn(text) {
    const norm = normalizeName(text);
    if (!norm) return -1;
    const players = hooks.getPlayers();
    for (let i = 0; i < players.length; i++) if (players[i].norm === norm) return i;
    for (let i = 0; i < players.length; i++) {
      const p = players[i].norm;
      if (p.length >= 5) {
        const at = norm.indexOf(p);
        if (at !== -1) {
          const before = at === 0 || norm[at - 1] === ' ';
          const after = at + p.length === norm.length || norm[at + p.length] === ' ';
          if (before && after) return i;
        }
      }
    }
    return -1;
  }

  function myTeamName() {
    const card = q1(SELECTORS.myPickCard);
    if (!card) return '';
    // The card reads "4. My Team Name$141". Strip the money AND the
    // leading draft-position prefix — the roster panel labels the same team without
    // it, so leaving it in breaks every comparison against that panel.
    return normalizeName(
      card.textContent
        .replace(/\$\s*\d+/g, '')
        .replace(/\bnull\b/gi, '')
        .replace(/^\s*\d+\s*[.)]\s*/, '')
    );
  }

  function scanSoldFeed() {
    const mine = myTeamName();
    const rows = qAll(SELECTORS.pickRows);
    for (const row of rows.slice(0, 30)) {
      const text = row.textContent.trim();
      if (!text || seenSoldLines.has(text)) continue;
      // Only rows with a price are sales; nomination/chat messages lack one.
      const info = row.querySelector(SELECTORS.pickRowInfo);
      const priceM = (info ? info.textContent : text).match(moneyRe);
      if (!priceM) continue;
      seenSoldLines.add(text);
      const nameEl = row.querySelector(SELECTORS.pickRowName);
      const idx = matchNameIn(nameEl ? nameEl.textContent : text);
      if (idx === -1) continue;
      // Buyer team is the tail of pick-info: "$58 - Some Team".
      let isMine = false;
      if (mine && info) {
        const buyer = normalizeName(info.textContent.replace(/\$\s*\d+/g, '').replace(/^[\s-]+/, ''));
        isMine = buyer !== '' && (buyer === mine || mine.includes(buyer) || buyer.includes(mine));
      }
      hooks.onSold({ playerIdx: idx, price: Number(priceM[1]), mine: isMine });
    }
  }

  // Complete sold history from the board. Runs after the feed so the feed's
  // buyer information wins for anything it covers; markSold dedupes by name.
  function scanSoldBoard() {
    const soldSet = hooks.getSoldSet();
    for (const cell of qAll(SELECTORS.boardCells)) {
      const first = cell.querySelector('[class*="playerFirstName"]');
      const last = cell.querySelector('[class*="playerLastName"]');
      if (!first || !last) continue;
      const full = `${first.textContent.trim()} ${last.textContent.trim()}`;
      const norm = normalizeName(full);
      if (!norm || soldSet.has(norm)) continue;
      const idx = matchNameIn(full);
      if (idx === -1) continue;
      const priceM = (cell.querySelector('[class*="winningPrice"]')?.textContent || '').match(moneyRe);
      hooks.onSold({ playerIdx: idx, price: priceM ? Number(priceM[1]) : null, mine: false });
      soldSet.add(norm);
    }
  }

  // Read my roster straight from ESPN instead of inferring it from the pick feed.
  // This is self-healing: a mis-logged win, a stale entry, or a price typo is
  // corrected on the next scan rather than silently skewing the budget all draft.
  //
  // Guarded hard, because a wrong read here corrupts every number on the panel:
  // the roster panel has a team picker, so we only sync when it is still showing
  // MY team, and we never sync from a table we failed to parse.
  // Every team's remaining cash. The highest OPPOSING budget is a hard ceiling on
  // what any player can cost me: nobody can outbid it, so bidding past it + $1 is
  // burning money. Matters enormously late, when opponents are broke and the
  // league-wide inflation figure is dominated by my own unspent cash.
  function scanBudgets() {
    const cards = qAll(SELECTORS.pickTrainCards);
    if (!cards.length) return;
    let mine = null;
    const others = [];
    for (const card of cards) {
      const m = card.textContent.match(/\$\s*(\d+)/);
      if (!m) continue;
      const amt = Number(m[1]);
      const isMine = /auction-pick-component--own/.test(card.className) ||
                     !!card.querySelector('[class*="auction-pick-component--own"]') ||
                     !!card.closest('[class*="auction-pick-component--own"]');
      if (isMine && mine === null) mine = amt;
      else others.push(amt);
    }
    if (!others.length) return;
    hooks.onBudgets({ mine, maxOpposing: Math.max(...others), opposingTotal: others.reduce((a, b) => a + b, 0) });
  }

  function scanMyRoster() {
    const mine = myTeamName();
    if (!mine) return;

    const picker = q1(SELECTORS.rosterTeamPicker);
    if (picker) {
      const shown = normalizeName(
        (picker.selectedOptions && picker.selectedOptions[0]
          ? picker.selectedOptions[0].textContent
          : picker.value) || ''
      );
      // The picker truncates ("NO TIME FOR LO..."), so treat either string being a
      // prefix of the other as a match, and require a few characters so a stray
      // short label can't wave through another team's roster.
      if (shown.length >= 4 && !mine.startsWith(shown) && !shown.startsWith(mine)) return;
    }

    const rows = [];
    let sawTable = false;
    for (const tr of document.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 3) continue;
      const slot = tds[0].textContent.trim().toUpperCase();
      if (!/^(QB|RB|WR|TE|WR\/TE|FLEX|OP|BE|BN|IR|D\/ST|K)$/.test(slot)) continue;
      sawTable = true;
      const titled = tds[1].querySelector('[title]');
      const name = titled ? titled.getAttribute('title').trim() : '';
      const priceM = tds[2].textContent.match(moneyRe);
      if (!name || !priceM) continue; // empty slot
      if (slot === 'IR') continue;    // IR is not a draftable slot

      const idx = matchNameIn(name);
      const known = idx !== -1 ? hooks.getPlayers()[idx] : null;
      rows.push({
        norm: normalizeName(name),
        name: known ? known.name : name,
        // Prefer the position from my values list; fall back to the slot label
        // when the slot is itself a real position (bench rows are not).
        pos: known ? known.pos : (/^(QB|RB|WR|TE)$/.test(slot) ? slot : '?'),
        price: Number(priceM[1]),
      });
    }
    if (!sawTable) return; // selector rot — leave the manual log alone
    hooks.onRosterSync(rows);
  }

  function scanNomination(mutatedTexts) {
    const nameEl = q1(SELECTORS.nominationName);
    const boxEl = q1(SELECTORS.nominationBox);
    let idx = -1;
    let displayName = '';
    if (nameEl) {
      displayName = nameEl.textContent.trim();
      idx = matchNameIn(displayName);
    }
    if (idx === -1 && boxEl) idx = matchNameIn(boxEl.textContent);
    if (idx === -1 && !nameEl && !boxEl) {
      // Full fallback: mutated node text containing an unsold imported name.
      const soldSet = hooks.getSoldSet();
      for (const t of mutatedTexts) {
        const i = matchNameIn(t);
        if (i !== -1 && !soldSet.has(hooks.getPlayers()[i].norm)) { idx = i; break; }
      }
    }

    if (idx !== -1) {
      const norm = hooks.getPlayers()[idx].norm;
      if (norm !== lastNominationKey) {
        lastNominationKey = norm;
        lastBid = null;
        hooks.onNomination(idx);
      }
    } else if (displayName) {
      // On the block but not in the imported list — still show it.
      const key = 'unknown:' + normalizeName(displayName);
      if (key !== lastNominationKey) {
        lastNominationKey = key;
        lastBid = null;
        const posEl = q1(SELECTORS.nominationPos);
        hooks.onUnknownNomination({
          name: displayName,
          pos: posEl ? posEl.textContent.trim().toUpperCase() : '?',
        });
      }
    }
  }

  function scanBid() {
    const el = q1(SELECTORS.currentBid);
    if (!el) return;
    const m = el.textContent.match(moneyRe);
    if (!m) return;
    const amt = Number(m[1]);
    if (amt !== lastBid) {
      lastBid = amt;
      hooks.onBid(amt);
    }
  }

  function scanEspnMax() {
    const el = q1(SELECTORS.espnMax);
    if (!el) return;
    const m = el.textContent.match(/max\s*\$\s*(\d{1,3})/i);
    if (m) hooks.onEspnMax(Number(m[1]));
  }

  const scan = throttle((mutatedTexts) => {
    if (!hooks) return;
    try {
      scanSoldFeed();  // first: it knows who bought, so my own wins register
      scanSoldBoard(); // then: fills any gap the feed has scrolled past
      scanMyRoster();  // then: ESPN's roster overrides whatever we inferred
      scanBudgets();
      scanNomination(mutatedTexts);
      scanBid();
      scanEspnMax();
    } catch (e) {
      // Detection must never take the panel down.
      console.warn('[ADCP] detect error', e);
    }
  }, 250);

  function start(h) {
    hooks = h;
    if (observer) observer.disconnect();
    observer = new MutationObserver((muts) => {
      const texts = [];
      for (const m of muts) {
        for (const n of m.addedNodes) {
          const t = n.textContent;
          if (t && t.length > 3 && t.length < 400) texts.push(t);
        }
        if (m.type === 'characterData' && m.target.textContent) {
          texts.push(m.target.textContent);
        }
      }
      scan(texts);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan([]);
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
    hooks = null;
  }

  // Forget which pick rows we've already consumed and re-read the feed from
  // scratch. Required after the sold log is cleared: without this the rows
  // already in `seenSoldLines` are skipped forever, so the log silently stays
  // incomplete and both the sold verdicts and the inflation math go wrong.
  function resync() {
    seenSoldLines.clear();
    lastNominationKey = '';
    lastBid = null;
    scan([]);
  }

  NS.detect = { start, stop, resync, SELECTORS };
})();
