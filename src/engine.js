// Pure draft math: budget, max bid, inflation, slot filling, verdicts.
(() => {
  const NS = window.__adcp;

  const totalSlots = (settings) => settings.slots.reduce((n, s) => n + s.count, 0);

  // Greedy slot assignment: starters before bench (slot order in settings is
  // starters-first), each player fills the first open slot that accepts them.
  // Returns { filled: {slotKey: count}, overflow: [players] }.
  function fillSlots(settings, roster) {
    const filled = Object.fromEntries(settings.slots.map((s) => [s.key, 0]));
    // Which players landed in which slot group, so spend can be attributed.
    const assigned = Object.fromEntries(settings.slots.map((s) => [s.key, []]));
    const overflow = [];
    for (const p of roster) {
      const slot = settings.slots.find((s) => s.accepts.includes(p.pos) && filled[s.key] < s.count);
      if (slot) { filled[slot.key]++; assigned[slot.key].push(p); }
      else overflow.push(p);
    }
    return { filled, assigned, overflow };
  }

  function summarize(state) {
    const { settings, myRoster, sold, players } = state;

    const spent = myRoster.reduce((n, r) => n + (r.price || 0), 0);
    const budgetLeft = settings.budget - spent;
    const slotsTotal = totalSlots(settings);
    const slotsFilled = Math.min(myRoster.length, slotsTotal);
    const slotsOpen = Math.max(0, slotsTotal - slotsFilled);
    // Spec formula: remaining budget minus $1 per OTHER unfilled slot.
    const maxBid = slotsOpen > 0 ? budgetLeft - (slotsOpen - 1) : 0;
    const avgPerSlot = slotsOpen > 0 ? budgetLeft / slotsOpen : 0;

    // Inflation: league money still in play vs listed value still on the board.
    const soldSet = new Set(sold.map((s) => s.norm));
    const leagueSpent = sold.reduce((n, s) => n + (s.price || 0), 0);
    const leagueMoney = settings.teams * settings.budget - leagueSpent;
    let remainingListed = 0;
    for (const p of players) if (!soldSet.has(p.norm)) remainingListed += p.value;
    let inflation = remainingListed > 0 ? leagueMoney / remainingListed : 1;
    inflation = Math.min(1.4, Math.max(0.75, inflation)); // lightly capped

    // Position run: 3+ same-position sales within the last 5 picks.
    let run = null;
    const recent = sold.slice(-5);
    const posCounts = {};
    for (const s of recent) {
      if (!s.pos || s.pos === '?') continue;
      posCounts[s.pos] = (posCounts[s.pos] || 0) + 1;
      if (posCounts[s.pos] >= 3) run = { pos: s.pos, n: posCounts[s.pos] };
    }

    const { filled } = fillSlots(settings, myRoster);
    const needs = settings.slots.map((s) => ({
      key: s.key, label: s.label, filled: filled[s.key], count: s.count,
      open: s.count - filled[s.key],
    }));

    return { spent, budgetLeft, slotsTotal, slotsFilled, slotsOpen, maxBid, avgPerSlot, inflation, needs, soldSet, run };
  }

  const adjValue = (player, inflation) => Math.round(player.value * inflation);

  // One-line verdict for the pinned player.
  // Order matters: sold > position filled > above max > target/value call.
  function verdict(state, summary, player) {
    const { settings } = state;
    if (summary.soldSet.has(player.norm)) return { text: 'ALREADY SOLD', level: 'dead' };

    const { filled } = fillSlots(settings, state.myRoster);
    const hasRoom = settings.slots.some(
      (s) => s.accepts.includes(player.pos) && filled[s.key] < s.count
    );
    if (!hasRoom) return { text: 'POSITION FILLED', level: 'dead' };
    if (summary.slotsOpen === 0) return { text: 'ROSTER FULL', level: 'dead' };

    const adj = adjValue(player, summary.inflation);
    if (adj > summary.maxBid) return { text: `PRICED ABOVE MY MAX (${NS.util.fmt$(summary.maxBid)})`, level: 'warn' };

    const starterSlot = settings.slots.find(
      (s) => s.key !== 'BENCH' && s.accepts.includes(player.pos) && filled[s.key] < s.count
    );
    if (player.tier !== null && player.tier <= 2) {
      return { text: starterSlot ? 'TARGET — top tier' : 'TARGET — bench value', level: 'go' };
    }
    if (adj >= player.value) {
      return { text: starterSlot ? 'TARGET — fills starter' : 'VALUE — bench only', level: 'go' };
    }
    return { text: starterSlot ? 'FINE AT VALUE' : 'BENCH ONLY', level: 'ok' };
  }

  // The scarcity clock.
  //
  // BID TO prices one player at a time, which is blind to the way auctions are
  // actually lost. Overspend early and you fill half a roster with $1 bodies;
  // hoard too long and you own the budget but the board is empty — in testing we
  // reached a point with $148 against the field's $44 where the best player left
  // was worth $8. Money past the talent cliff buys nothing.
  //
  // So track the race that actually matters: unfilled STARTER slots against the
  // players still available to fill them. Bench slots are excluded — anyone fills
  // those, so they carry no urgency.
  function scarcity(state, summary) {
    const { settings, players, myRoster } = state;
    const { filled } = fillSlots(settings, myRoster);
    const rows = [];

    for (const slot of settings.slots) {
      if (slot.key === 'BENCH') continue;
      // Filled positions stay in the list, marked DONE. Dropping them made a
      // whole section vanish mid-draft, which reads as a bug and destroys the
      // stable QB / RB / WR-TE ordering the eye relies on.
      const need = Math.max(0, slot.count - filled[slot.key]);

      // Supply = unsold players who are actually worth starting. Anything the
      // value list prices at $1 is replacement level and always available, so it
      // is not supply in any meaningful sense.
      const pool = players
        .filter((p) => !summary.soldSet.has(p.norm) && slot.accepts.includes(p.pos) && p.value > 1)
        .sort((a, b) => a.value - b.value);

      // Could I even afford to fill these slots at current prices? Cheapest-first
      // is the most favourable case; if that already busts the budget, it is bad.
      const cheapest = pool.slice(0, need);
      const costToFill = cheapest.reduce((n, p) => n + Math.max(1, adjValue(p, summary.inflation)), 0);

      const row = {
        key: slot.key,
        label: slot.label,
        need,
        supply: pool.length,
        ratio: pool.length / need,
        costToFill,
        affordable: costToFill <= summary.budgetLeft,
        // Best player still available who can fill this slot — the concrete
        // "who should I be going after here" answer.
        best: pool.length ? pool[pool.length - 1] : null,
        // Prices of the best remaining options, dearest first. Used to reserve a
        // realistic amount for slots not yet filled.
        ladder: pool.slice(-10).reverse().map((p) => Math.max(1, adjValue(p, summary.inflation))),
      };
      row.urgency = urgencyOf(row);
      rows.push(row);
    }

    // Unmet needs first, most urgent at the top; completed slots sink to the end.
    rows.sort((a, b) => (a.need === 0) - (b.need === 0) || a.ratio - b.ratio);
    return rows;
  }

  // Deliberately NOT worded like a bid instruction. "HOLD" reads as "don't bid on
  // this player", which is the opposite of what deep supply means — it means you
  // are under no time pressure and can wait for a price you like.
  function urgencyOf(row) {
    if (row.need === 0) {
      return { level: 'done', label: 'DONE', why: 'starters filled' };
    }
    if (row.supply <= row.need) {
      return { level: 'critical', label: 'BUY NOW', why: 'supply is gone' };
    }
    if (row.ratio <= 2) {
      return { level: 'warn', label: 'BUY SOON', why: 'thinning out' };
    }
    return { level: 'go', label: 'NO RUSH', why: 'plenty left' };
  }

  // Money that must NOT be spent on the player in front of you, because it is
  // needed to fill starter slots that are still empty.
  //
  // This is the fix for the worst failure the tool produced: pricing players one
  // at a time, it approved six individually-fair WR buys — two of them bench —
  // that together consumed $190 and left both QB and both RB slots empty. Every
  // purchase was defensible; the roster was unfieldable.
  //
  // The reserve assumes you land solid-but-not-best options: for a slot needing N
  // more, it budgets the prices sitting just below the top N on the board. That
  // self-adjusts as the board drains, and collapses to $1 each when only
  // replacement-level players remain.
  // Divide the money you still have across the starter slots you still need.
  //
  // Without this the panel had no opinion on roster shape: it approved each buy
  // on its own merits and let $118 of $200 land on two receivers while QB and RB
  // sat empty. Allocation gives every open slot a claim on the budget up front,
  // so spending on one position visibly costs the others.
  //
  // Slots are weighted by what is actually still available to fill them — the
  // best remaining player's adjusted price. A slot whose position has been picked
  // clean earns a small share, because a $2 body is all that is left to buy;
  // a slot with elite talent on the board earns a large one. Re-derived on every
  // render, so it tracks the draft rather than a plan made before it started.
  function allocate(state, summary, rows) {
    const { assigned } = fillSlots(state.settings, state.myRoster);
    const bench = state.settings.slots.find((s) => s.key === 'BENCH');
    const benchOpen = bench ? Math.max(0, bench.count - (assigned.BENCH || []).length) : 0;
    // Hold a dollar for each empty bench spot; everything else is in play.
    const spendable = Math.max(0, summary.budgetLeft - benchOpen);

    const claims = [];
    for (const r of rows) {
      for (let i = 0; i < r.need; i++) {
        const v = r.ladder && r.ladder[i] != null ? r.ladder[i] : 1;
        claims.push({ key: r.key, weight: v, rank: i });
      }
    }
    const totalWeight = claims.reduce((n, c) => n + c.weight, 0) || 1;

    const groups = {};
    for (const r of rows) {
      groups[r.key] = {
        need: r.need,
        budget: 0,      // for all remaining slots in this group
        nextSlot: 0,    // for the single best one — the live bidding cap
        spent: (assigned[r.key] || []).reduce((n, p) => n + (p.price || 0), 0),
      };
    }
    for (const c of claims) {
      const share = (spendable * c.weight) / totalWeight;
      groups[c.key].budget += share;
      if (c.rank === 0) groups[c.key].nextSlot = share;
    }
    for (const k of Object.keys(groups)) {
      groups[k].budget = Math.round(groups[k].budget);
      groups[k].nextSlot = Math.max(1, Math.round(groups[k].nextSlot));
    }
    return { groups, spendable, benchOpen };
  }

  // Ceiling imposed by the rest of the roster rather than by this player's worth.
  //
  // Reserving projected market prices for every empty slot was tried first and is
  // wrong: at the open it reserved ~$200 and capped a $75 receiver at $1. The
  // failure being prevented is narrower than that. Every ruinous purchase in the
  // six-WR draft was DEPTH bought while starters stood empty — two bench
  // receivers at $17 and $19 with no QB and no RB on the roster. So that is the
  // rule: while a starting slot is unfilled, depth is a $1 flier and nothing more.
  function spendCap(state, summary, rows, player, alloc) {
    if (!player) return summary.budgetLeft;
    const open = rows.filter((r) => r.need > 0);
    // Depth while a starting slot is empty is a $1 flier, never a real purchase.
    const fills = open.find((r) =>
      state.settings.slots.find((s) => s.key === r.key)?.accepts.includes(player.pos));
    if (!fills) return open.length ? 1 : summary.budgetLeft;
    // Otherwise: this slot's share of the remaining budget.
    const g = alloc && alloc.groups ? alloc.groups[fills.key] : null;
    return g ? Math.max(1, g.nextSlot) : summary.budgetLeft;
  }

  // The single number to bid up to. Lives here rather than in the panel so the
  // NOW line and the pinned card can never disagree with each other.
  function bidTo(state, summary, player, caps = {}) {
    if (!player) return null;
    const v = verdict(state, summary, player);
    if (v.level === 'dead') return { amount: 0, pass: true, verdict: v };

    let amount = player.unknown
      ? 1
      : Math.min(adjValue(player, summary.inflation), summary.maxBid);
    // ESPN's own max is a real ceiling — the bid cannot exceed it.
    if (caps.espnMax != null) amount = Math.min(amount, caps.espnMax);

    let cappedBy = null;
    // Roster-construction ceiling: what is left after reserving for empty starters.
    let heldBack = null;
    if (caps.spendCap != null && caps.spendCap < amount) {
      amount = caps.spendCap;
      heldBack = true;
    }
    // Nobody can outbid the richest opponent, so paying past that is pure waste.
    if (caps.maxOpposing != null && caps.maxOpposing + 1 < amount) {
      amount = caps.maxOpposing + 1;
      cappedBy = caps.maxOpposing;
    }
    return { amount: Math.max(1, amount), pass: false, cappedBy, heldBack, verdict: v };
  }

  // What to do THIS second. Answers the live auction first, because that is the
  // only decision with a clock on it; falls back to who to go after next.
  function nextAction(state, summary, rows, pinned, currentBid, caps) {
    if (!state.players.length) {
      return { level: 'ok', text: 'IMPORT YOUR VALUES', detail: 'Open ⚙ and paste your list.' };
    }

    // Only positions still needing bodies drive urgency; DONE rows are display only.
    const open = rows.filter((r) => r.need > 0);

    // A budget that cannot cover the roster outranks any single auction.
    const short = budgetShortfall(summary, open);
    if (short) return short;

    if (pinned) {
      const alloc = caps.alloc || allocate(state, summary, rows);
      const capsPlus = { ...caps, spendCap: spendCap(state, summary, rows, pinned, alloc) };
      const bt = bidTo(state, summary, pinned, capsPlus);
      const fillsNeed = open.some((r) =>
        state.settings.slots.find((s) => s.key === r.key)?.accepts.includes(pinned.pos));

      // Refuse to spend real money on depth while starters are empty. This is
      // exactly how the six-WR roster happened.
      if (!fillsNeed && open.length && bt.amount <= 2) {
        return {
          level: 'dead',
          text: `PASS — ${pinned.name} is depth`,
          detail: `Still need ${open.map((r) => `${r.need} ${r.label}`).join(', ')}. Save the money.`,
        };
      }

      if (bt.pass) {
        return { level: 'dead', text: `PASS — ${pinned.name}`, detail: bt.verdict.text };
      }
      if (currentBid != null && currentBid > bt.amount) {
        return {
          level: 'dead',
          text: `PASS — ${pinned.name} at ${NS.util.fmt$(currentBid)}`,
          detail: `Worth ${NS.util.fmt$(bt.amount)} to you. Let it go.`,
        };
      }
      let why = '';
      if (bt.cappedBy != null) why = ` (room can only reach ${NS.util.fmt$(bt.cappedBy)})`;
      else if (bt.heldBack) {
        why = fillsNeed
          ? ` (${pinned.pos} slot's share of your ${NS.util.fmt$(summary.budgetLeft)})`
          : ` (depth only — ${open.map((r) => r.label).join('/')} still empty)`;
      }
      return {
        level: fillsNeed ? 'go' : 'ok',
        text: `BID — ${pinned.name} up to ${NS.util.fmt$(bt.amount)}`,
        detail: (fillsNeed ? `Fills ${pinned.pos}. ` : 'Depth only. ') + bt.verdict.text + why,
      };
    }

    if (!open.length) {
      return { level: 'ok', text: 'STARTERS FULL', detail: 'Bench and upside only from here.' };
    }
    const worst = open[0];
    const bestName = worst.best ? worst.best.name : 'nobody left';
    return {
      level: worst.urgency.level,
      text: `GO AFTER ${worst.label} — ${bestName}`,
      detail: `${worst.supply} left for ${worst.need} · ${worst.urgency.label.toLowerCase()}`,
    };
  }

  // Affordability is a whole-roster question, not a per-position one. Each slot
  // group can look affordable on its own while the total quietly busts the
  // budget — $7 + $15 + $4 against $15 left reads as three green lights.
  function budgetShortfall(summary, rows) {
    if (!rows.length) return null;
    const benchOpen = Math.max(0, summary.slotsOpen - rows.reduce((n, r) => n + r.need, 0));
    const usable = summary.budgetLeft - benchOpen; // $1 held back per bench spot
    const totalToFill = rows.reduce((n, r) => n + r.costToFill, 0);
    if (totalToFill <= usable) return null;
    return {
      level: 'critical',
      text: `BUDGET SHORT — starters cost ~${NS.util.fmt$(totalToFill)}, you have ${NS.util.fmt$(usable)}`,
      detail: 'Stop paying market. Hunt the cheapest startable players only.',
    };
  }

  NS.engine = {
    summarize, adjValue, verdict, fillSlots, totalSlots,
    scarcity, urgencyOf, bidTo, nextAction, spendCap, allocate,
  };
})();
