# Draft notes — FPL, Aug 30 2026, 8:00 PM EDT

Findings from building and live-testing the Co-Pilot. Read the strategy section before the draft.

## Acceptance test — PASSED

Run in a live ESPN FPL practice draft (league-specific, so identical settings), 2026-08-30:

| Check | Result |
|---|---|
| Panel injects, does not block ESPN's UI | pass |
| Values import (129 players) | pass |
| Nomination auto-detect and pin | pass — fires within a beat |
| Live bid tracking | pass |
| OVERPRICED callout | pass — "Gibbs, current bid $45 — OVERPRICED (worth $39)" |
| Position-run warning | pass — "⚠ QB run" fired during a real QB run |
| Sold auto-detect | pass — inflation moved ×1.34 → ×0.90 |
| Sold players excluded from search | pass — "Alle" returns nothing after Allen sold |
| Log a win, budget math | pass — $200 − $33 = $167 left, max bid $157 (= 167 − 10 empty slots) |
| Survives page refresh | pass — roster, budget, and values all restored |

### Three bugs found during testing — all fixed and re-verified

1. **Draft state leaked between rooms.** The sold log and roster had no idea which draft
   room they belonged to, so a mock's results followed you into the next room and silently
   corrupted the budget. State is now scoped to the league id in the URL; entering a
   different room clears the previous room's results and shows a banner. Imported values
   and settings are kept.
2. **Reset used a native `confirm()` dialog.** A browser modal blocks every event on the
   page until dismissed — hitting Reset mid-auction could have frozen the panel exactly
   when it was needed. Now a two-click inline confirm ("Sure? tap again"). There are no
   blocking dialogs anywhere in the extension.
3. **Panel appeared on the mock draft lobby**, because the old check matched the substring
   "draft" inside "mockdraftlobby". Now requires the actual draft-room path.
4. **The sold log could not rebuild after a reset.** Detection keeps an in-memory set of
   pick rows it has already consumed; clearing the log left those rows permanently skipped,
   so the panel kept insisting sold players were available (it claimed Smith-Njigba, Lamb,
   Bijan and Pickens were free when all four had gone). Reset now calls `detect.resync()`,
   which forgets consumed rows and re-reads from ESPN.
5. **Sold history was incomplete after a page refresh.** Detection read only the pick-message
   feed, which holds recent messages — 27 rows when the draft board had all 51 picks. Refresh
   at pick 80 and most of the sold history, and therefore the inflation math, was simply gone.
   The board is now scanned as the authoritative history (`.playerFirstName` /
   `.playerLastName` / `.winningPrice`), with the feed still supplying the buying team so
   your own wins are recognized.

6. **Roster sync silently skipped everything** (found only by a clean run from pick 1).
   ESPN auto-bid and won Jahmyr Gibbs for $59, leaving $141 — the panel still read $200 and
   an empty roster, so every number would have been wrong for the rest of the draft. The
   safety guard was the cause: the pick-train card labels the team `"4. My Team Name"` with
   a draft-position prefix, the roster panel labels it `"MY TEAM NA..."` truncated and
   without one, so the prefix-match concluded it was another team's roster and refused to
   sync. The guard meant to prevent bad data produced missing data instead. Now matches on
   either string being a prefix of the other, after stripping the position prefix.

   Every earlier test began mid-draft with a roster populated by hand, so the sync always had
   something to match and the zero-to-first-player path was never exercised. **A test that
   starts from a state you created can only find bugs you didn't create.**

### Live-draft gotcha, not a bug

If the draft is open in two places ESPN shows **"Duplicate Connection"** and disconnects one.
The panel then sits frozen on stale data while the auction moves on — it looks like detection
died. Click **Reconnect**; the panel re-syncs on its own. Keep one draft tab open tonight.

Note on how bug 1 surfaced: a test win logged during the acceptance run persisted into the
next session. The panel caught its own error — the **⚠ ESPN max** chip fired because the
tracked budget disagreed with ESPN's. That reconciliation check is worth trusting.

## The core edge: ESPN's dollar values assume a 1QB league

FPL starts **two** quarterbacks. ESPN's published auction values do not account for that.

| Player | Proj pts | ESPN's $ | Model $ |
|---|---|---|---|
| Josh Allen | 369.7 (highest in the pool) | $22 | $48 |
| Lamar Jackson | 322.9 | $10 | $38 |
| Jayden Daniels | 318.4 | $10 | $38 |
| Joe Burrow | 304.8 | $5 | $35 |

The mirror image hits tight ends: FPL has **no dedicated TE slot** (TEs compete with WRs for
the 4 WR/TE spots), so the usual elite-TE premium does not apply. Brock Bowers: ESPN $34, model $14.

**Anyone at your table using ESPN's sheet is working from numbers built for a different league.**

## Model correction — the first curve was too flat (fixed)

The original model let replacement level solve for itself by iterating until every drafted
player sat above replacement. That drives the baseline down to the 120th player, which makes
value nearly proportional to raw projected points — and points only vary about 2:1 across
the draftable pool. The result was a curve far too flat at the top: **Josh Allen priced at
$48 against a $72 clearing price**, while mid-tier players were accurate.

Recalibrated against 21 observed clearing prices from the practice draft:

| Baseline | RMSE vs market |
|---|---|
| iterative, 120 above replacement (original) | $19.9 |
| starters only (QB20/RB20/WR-TE40) | $15.0 |
| **QB24 / RB18 / WR-TE36 (now default)** | **$11.9** |

At starters-only baselines RB, WR and TE were already well calibrated (bias +1.9, +5.0, −2.0);
essentially all the error was at quarterback, so the QB pool needed the deeper baseline.
The corrected model prices 78 players above $1 (was 118), which is the shape real auctions
have — a meaningful top and a long $1 tail.

Residual: elite QBs still clear about $10–15 above model. That is real 2QB scarcity premium
and is left uncorrected rather than curve-fit away on 21 bot-draft data points.

## Market reality: expect early prices ~1.7× model value

First five sales in the practice draft:

| Player | Model | Sold for | Ratio |
|---|---|---|---|
| Josh Allen | $48 | $72 | 1.5× |
| Lamar Jackson | $38 | $71 | 1.9× |
| Ja'Marr Chase | $33 | $67 | 2.0× |
| Bijan Robinson | $38 | $67 | 1.8× |
| Jahmyr Gibbs | $41 | $60 | 1.5× |

Note this is **every position**, not just QB. That is not a flaw in the values — it is the
standard auction pattern: early in the draft everyone holds a full budget and bids it up.
Money leaves the room faster than value does, so later players go cheap. The panel already
models this: the inflation multiplier had dropped to **×0.90** by pick five, which is the
tool telling you the remaining pool is now worth 10% less than list.

Caveat: these are ESPN bot prices from a small sample. Human rooms differ in level, but the
early-overpay-then-crater shape is universal.

## The endgame trap: inflation lies once you're the only one with money

Late in the practice draft the panel showed inflation **×1.40** — "remaining players cost 40%
above list." It was the exact opposite of the truth. The actual budgets at that moment:

| | Cash left |
|---|---|
| **Me** | **$147** |
| All nine opponents combined | **$44** |
| Richest single opponent | **$8** |

Inflation is `remaining league money ÷ remaining listed value`. That is correct in aggregate —
all the money does get spent — but $147 of the $191 was **mine**. My own unspent cash was
inflating my own bid ceiling, telling me to pay up when nothing could cost more than $9.

The fix is a hard ceiling from the auction itself: **no player can cost more than the richest
opponent's remaining budget, plus $1.** Nobody can outbid it. The panel now reads every team's
cash, shows a **room max $N** chip, and caps BID TO at that number, labelling it
"room can only reach $N" when the room — not the player's value — is what is binding.

This is the single most valuable read in the endgame. When the room max is $8, you buy the
best player left for $9, every time, until your roster is full.

## The six-WR draft, and budget allocation

Running the panel's advice literally through a full mock produced a roster of **six wide
receivers, zero quarterbacks and zero running backs**, with $190 of $200 spent. It could not
field a legal lineup.

Nothing malfunctioned. Every purchase was individually defensible — each receiver was at or
under his value. The panel priced players one at a time and had no opinion about roster
shape, so it approved a sequence of fair buys that together destroyed the team. Two of them
were **bench** receivers at $17 and $19 bought while both QB slots and both RB slots were
empty.

Two fixes, in order of importance:

1. **Depth is $1 while a starter slot is empty.** If a player cannot fill an open starting
   slot, the bid caps at $1 and the panel says `PASS — <player> is depth`. Every ruinous
   purchase in that draft was depth bought over an empty starting job.
2. **Every open starter slot gets a share of the remaining budget.** Slots are weighted by
   the best player still available to fill them, so a picked-clean position earns a small
   claim and a position with elite talent left earns a large one. At the open this splits
   $196 into WR/TE $106 (four slots), RB $48 and QB $43 — and it caps the top receiver at
   **$30 rather than $71**, which is exactly the overspend that began the spiral.
   Recomputed every render, so it tracks the draft rather than a pre-draft plan.

The allocation is what makes spending visible as a trade-off: money committed to one
position now shows up as less available everywhere else.

A first attempt at fix 2 reserved projected *market* prices for every empty slot. It was far
too aggressive — at the open it reserved essentially the whole budget and capped a $75
receiver at $1. Weighting claims against a fixed pot is the version that works.

## How to actually use the panel

- **BID TO is a ceiling, not a target.** It is the most you should pay, already adjusted for
  inflation and capped by what you can afford. Bidding it every time is how you lose.
- **Expect to lose the first several players.** If the room pays 1.7× early, the correct play
  is to let them. Passing is not missing out; it is the strategy.
- **Your buying window is when the inflation chip drops below ×1.00** and stays there. That is
  arithmetic proof the remaining players are cheaper than their listed value.
- **Do not panic-buy quarterbacks.** The QB value curve here is flat by design — Allen $48,
  then five QBs at $38, then a cluster in the low $30s. If Allen goes for $72, Purdy or
  Mahomes at $32 is nearly the same production for less than half the money. That flatness
  is your single biggest advantage; spend it on RB/WR instead.
- **⚠ position run** means 3+ of the last 5 sales shared a position. Prices there are spiking;
  it is usually the moment to buy a *different* position.
- If the panel ever disagrees with ESPN's own budget, a **⚠ ESPN max** chip appears — trust
  ESPN and fix your log with the ↩ undo buttons.

## Regenerating the values

See the README — the panel does this itself now (paste projections into the values box
and it prices them in place). The batch route, for diffing model changes:

```
# 1. Settings -> Copy pull script, paste into the DevTools console on fantasy.espn.com
# 2. save the printed CSV locally, e.g. reference/espn-projections-2026.csv
node tools/build-values.js reference/espn-projections-2026.csv > reference/values-fpl.csv
```

Both files are gitignored: the projections are ESPN's, and the values are computed from
them. They live on your disk, not in the repo.

Baselines are no longer a constant to hand-edit. Set them in the panel, or fit them from
archived mock drafts with `tools/calibrate.js` — which is what produced the table above
and what will produce next season's.
