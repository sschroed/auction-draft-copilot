# Auction Draft Co-Pilot

Read-only Chrome extension that overlays a live assistant on an ESPN salary cap
(auction) draft room. It prices players for *your* league's roster rules, tracks every
sale to keep inflation honest, and tells you the most you should pay for the player on
the block.

> Not affiliated with, endorsed by, or sponsored by ESPN or The Walt Disney Company.
> ESPN is their trademark, used here only to say what the extension reads. This is a
> personal, non-commercial project.

<img src="docs/panel-live.png" alt="The Co-Pilot panel during a draft: budget summary, a DO NOW
recommendation, per-position budget allocation, the pinned player with a BID TO ceiling, and
roster and inflation chips." width="330">

## Load it

1. Chrome → `chrome://extensions` → enable **Developer mode** (top right)
2. **Load unpacked** → pick this folder
3. Open your draft room (real or mock). The panel appears top-right.

**Upgrading, or reloading after a code change:** `chrome://extensions` → ↻ on the extension
card, **then refresh the draft tab**. Reloading the extension does not replace the script
already running in a page that is open — miss the refresh and you are still on the old
version with no indication that anything is stale.

The panel drags by its header if it is in your way. On a short window the settings panel can
run past the bottom of the screen; collapsing the **calibration** section brings it back.

## Set it up for your league

Open **⚙ settings** in the panel:

- **Budget / Teams** — auction budget per team, and how many teams.
- **Roster slots** — `LABEL=count`, comma separated. `QB=2, RB=2, WR/TE=4, BN=4` means
  two QBs, two RBs, four spots either WR or TE, and four bench. A slash means the
  positions share a slot and therefore share a price: with `WR/TE`, a tight end is worth
  exactly what a receiver scoring the same is worth. `BN` (or `BENCH`) is depth — it
  costs money but creates no starter demand. `D/ST` is the one slash that is not a flex —
  it is read as the single position, so a standard roster is
  `QB=1, RB=2, WR=2, TE=1, RB/WR/TE=1, D/ST=1, K=1, BN=7`.
- **Values box** — paste your player numbers and hit **Import**.

<img src="docs/panel-settings.png" alt="The settings panel: budget and teams, the roster slot
spec, the paste box accepting values or projections, and the calibration section showing ranked
replacement baselines with apply buttons." width="330">

Roster shape drives everything. Replacement level is computed from the slots you enter,
so a 2QB league and a 1QB league produce genuinely different prices from the same
projections. That is the whole point.

**Get the slots right before you calibrate.** A fitted baseline belongs to the roster it was
fitted for, so changing the slots or the team count discards it and goes back to deriving
from starter demand. Changing the budget does not. If you have spent three mock drafts
earning a fit, do not casually edit `BN=4` to `BN=5` afterwards.

## Getting player numbers in

The box takes either format and tells you which it used:

| Format | Columns | What happens |
|---|---|---|
| Finished values | `Name,Pos,Value,Tier` | Used as-is. Tier optional. |
| Projections | `Name,Pos,ProjPts` | Priced by the built-in model, using your slots. |

Tabs or commas, header optional. It distinguishes them by content — a `ProjPts` header,
decimals in column 3, or a figure larger than your budget all mean projections — and the
import message always says which it picked and what it did.

**Where projections come from is up to you.** None ship with this repo. Any source works
as long as it lands in `Name,Pos,ProjPts` form. If you want ESPN's own numbers scored
under your league's rules, ⚙ → **Copy pull script** hands you a console snippet
pre-filled with your league id; paste it into DevTools on a fantasy.espn.com page and
copy out the CSV. That request runs in your browser, in your session, by hand — the
extension itself never makes one.

## Calibrate it to your league

The one number that cannot be read off your league's rules is **replacement baseline** —
how many players at each position are worth real money. It has to be fitted against what
a room actually pays. Mock drafts are how you get that data, and the panel collects it
for you:

1. Run a mock draft with the panel open. It records every sale and price.
2. Enter another draft room. The finished draft is archived automatically — this is why
   your mocks are not lost when you start a new one.
3. ⚙ → **calibration** → **Calibrate**. It sweeps candidate baselines against your
   archived sales and ranks them by error, showing per-position bias so you can see
   *where* the model is wrong and not just how much.
4. **apply** the winner, then re-import your projections to reprice.

**The mock has to match your roster.** Prices only mean something against the roster that
produced them — a 1QB room says nothing about what a quarterback costs in a 2QB league — so
each archived draft records the shape it was played under and the fit uses only the drafts
that match your current settings. The archive line tells you how many apply and how many are
being set aside.

This matters more than it sounds, because **every public ESPN salary cap mock room is
"Standard" or "PPR Standard"**: 1QB with a dedicated TE slot. If your league is anything else,
none of those rooms will produce usable data, and `Calibrate` will correctly refuse to use
them. The one source that always matches is the **league-specific practice draft** at the top
of the mock draft lobby, which runs with your league's own settings.

Two or three *complete* mocks is enough to be useful. Completeness matters: money conservation
is what makes the scoring valid, and it only holds once the expensive players have sold, so a
mock abandoned early fits noticeably worse than one played out. Under 30 matched sales the
panel says so and tells you to treat the result as a hint.

For the full table, or to script it:

```
node tools/calibrate.js projections.csv sales.csv --teams 10 --slots 'QB=2, RB=2, WR/TE=4, BN=4'
```

`sales.csv` is what ⚙ → **Export sales** gives you. Scoring is raw RMSE against observed
prices. It deliberately does not correct for auction timing — early nominations clear
far above list and late ones crater — so absolute error is only comparable within one
dataset. The ranking is the useful part.

## Reading the panel

Top to bottom: a budget summary, one recommended action, a per-position plan, the player
currently on the block, and a row of status chips.

**The four numbers.** `LEFT` is your remaining budget. `MAX BID` is the most you could bid
and still afford $1 for every slot you have left to fill. `/SLOT` is what you have left
divided by the slots still open. `SLOTS` is filled out of total.

**DO NOW** is the single thing worth doing right now:

| Message | What it means |
|---|---|
| `BID — <player> up to $N` | Worth buying. `$N` is your ceiling, not a target. |
| `PASS — <player> at $N` | The bid has already passed your ceiling. |
| `PASS — <player> is depth` | Capped at $1 — cannot fill any starting slot you still have open. |
| `GO AFTER <SLOT> — <player>` | Nothing is on the block; this is the gap to attack next. |
| `PRICED ABOVE MY MAX ($N)` | Beyond what your budget can reach at all. |
| `BUDGET SHORT — starters cost ~$N, you have $N` | You can no longer fill a legal lineup. Stop buying depth. |

The depth rule is deliberate, and it is what stops the panel talking you into a roster it
cannot field. While a starting slot sits empty, a player who cannot fill it is worth $1 and no
more, however good the price looks.

**BY POSITION** splits your remaining budget across the slots you still need, weighted by the
best player left to fill each, and names that player with a ceiling. It is recomputed every
render, so it tracks the draft rather than a plan you made beforehand. Money committed to one
position visibly shrinks what is available everywhere else.

**The pinned player** shows `value` (list), `adj` (adjusted for inflation), `my max`, and
**BID TO** — the ceiling after inflation, your budget, the position's share, and the room's
ability to pay. Its verdict is one of `TARGET — top tier` / `— fills starter` / `— bench
value`, `FINE AT VALUE`, `NO RUSH`, or `DONE` when the slot is full.

**The chips**:

| Chip | Meaning |
|---|---|
| `infl ×N` | Remaining league money ÷ remaining listed value. Above 1.00 the pool is going for more than list; below, less. |
| `room max $N` | The richest single opponent's remaining budget. Nothing can cost you more than `$N + 1`, because no one else can bid past `$N`. |
| `⚠ <POS> run` | 3 or more of the last 5 sales were that position — prices there are spiking. |
| `⚠ ESPN max $N` | ESPN's own figure disagrees with the tracked budget. Trust ESPN and repair your log with the `↩` buttons. |

## Use it during the draft

- Nomination detection pins the player automatically; the **search box** (2–3 letters) is
  the fallback.
- **BID TO is a ceiling, not a target** — the most you should pay, already adjusted for
  inflation and for what you can still afford.
- **I won** + price logs to your roster; **Gone** marks anyone else's win (price optional,
  feeds inflation). **↩** on a roster row undoes.
- Panel flashes **amber** within $3 of your max, **red** past it.
- Everything persists across refresh. **Reset draft** clears sales and roster but keeps
  your values, settings, and calibration archive.

Late in a draft, once your opponents are broke, BID TO stops being about the player's value
and starts being about what the room can physically reach — no player can cost more than the
richest opponent's remaining budget plus $1:

<img src="docs/panel-endgame.png" alt="The panel in the endgame: BID TO $9 with the note ROOM
CAN ONLY REACH $8, because no opponent has more than $8 left." width="330">

### When something looks wrong

**The panel has frozen on stale data.** If the draft is open in two places ESPN shows
**"Duplicate Connection"** and disconnects one of them. The page stops updating while the
auction carries on, which looks exactly like detection dying. Click ESPN's **Reconnect** —
the panel re-syncs on its own. Keep one draft tab open.

**Detection has stopped pinning players.** Nothing downstream depends on it. Type 2–3 letters
into the search box to pin the player yourself, then log the result with **I won** + price or
**Gone**. Budget, inflation, the position plan and BID TO all keep working; you are only doing
by hand what detection was doing for you.

**`⚠ ESPN max` has appeared.** ESPN's own figure disagrees with the budget the panel has
tracked, which means the sold log is wrong — usually a price entered from memory. Trust ESPN,
and walk your roster back with the `↩` buttons until the chip clears.

**You cannot see the panel.** It drags by its header, and its position is remembered between
sessions. If the settings panel runs off the bottom of a short window, collapse the
**calibration** section.


`DRAFT-NOTES.md` has the strategy findings from building this — why quarterbacks are
mispriced in 2QB leagues, why early prices run ~1.7× value, and the endgame read that
matters most.

## Guarantees

- Permissions: `storage` only. **No network requests**, no simulated clicks, no automated
  bidding — it reads the DOM of a page you are already looking at and draws a panel.
- No blocking dialogs anywhere. A native `confirm()` freezes every event on the page,
  which mid-auction is the last thing you want.
- The panel stays fully usable if detection fails entirely (search + buttons).
- No projection data, values, or draft results are committed to this repo.

## Batch tools

Optional — the panel does all of this itself.

```
node tools/build-values.js projections.csv > values.csv   # price a projection set
node tools/calibrate.js projections.csv sales.csv         # fit baselines
```

Both take `--teams`, `--budget`, and `--slots` with the same spec the panel uses.
`tools/value-model.js` is the model itself and runs unchanged in Node and the browser,
so the panel's numbers are provably the ones these tools produce.

`reference/test-values.csv` is a 5-player CSV for mock-draft smoke tests.
