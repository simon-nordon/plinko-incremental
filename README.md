[**Play Plinko Incremental on GitHub Pages**](https://simon-nordon.github.io/plinko-incremental/)

# Plinko Incremental

A browser-based Plinko game built with TypeScript, Vite, and Matter.js.

Fresh settings default to Prestige. Saved mode choices are preserved; a saved 1 Ball choice now opens Prestige. High is the default risk. Dev mode offers Low, Medium, High, and Extreme presets, with separate bucket tweaks for each. The bottom-right **Dev mode** toggle reveals the right-hand tuning panel with Risk, Rows, Ball Size, Weight, Bounciness, and progress reset. It also shows + / − controls directly beneath every bucket. Dev mode starts disabled on every page load.

- **Normal:** start with $5, drop balls from $1, and unlock larger stakes as your balance grows.
- **Prestige:** a copy of Normal built around cashing out. Start with $5 and only $1 balls. Once your balance first reaches $10 (the price of the cheapest skill), a **Cash out** button appears for good. Cashing out banks your balance, starts a fresh run and opens the Prestige skill tree. Banked cash buys permanent skills and pays off debts. Prestige defaults to 0% luck, so the 16-row High center shows 0.1×. Progress is saved under `plinko-prestige-v1`.
- **Double or Nothing:** the first $10 ball each life is on the house. Your spendable balance starts at $0; only the proceeds can buy upgrades. Subsequent drops wager your entire balance. Wait for all split children to land before dropping or buying again. Forced cash out is the greater of 10% of starting money and 5% of your highest balance this life: $1 initially, rising to $100 after reaching $2,000. It never falls until a new life. Falling below it ends the life after all balls settle; exactly the threshold is playable. The threshold appears beneath your balance. Upgrade purchases are blocked if they would leave less than this amount.
- **Bouncy Peg:** adds one randomly placed purple peg per life. Any first contact, including a graze, gives a fixed tangential kick aligned with the ball's travel (bounded by the simulation speed limit), then it becomes ordinary.
- **Split Peg:** adds one randomly placed blue peg per life. Its first hit splits a ball into two balls, each worth half the original. Stacked charges add more balls that share the same total value. Bouncy and Split can occupy the same peg and both activate on that hit.
- **Golden Bucket:** adds one randomly placed gold bucket per life. The first ball pays twice the base multiplier (0.3× → 0.6×, 110× → 220×), then the bucket returns to its base payout. Only one split child can consume its charge.
- **More Starting Money:** upgrades future house balls from $10 → $20 → $50 → $100 → $150 → $250 → $500 → $1,000 → $1,500 → $2,500 → $5,000… with no gameplay level cap. The 1 / 1.5 / 2.5 / 5 pattern repeats at each larger scale. Prices remain ten times the new starting amount ($200 for $20, $500 for $50, $1,000 for $100, $1,500 for $150, and so on). Applies next life and never grants spendable cash directly.

In Double or Nothing, Bouncy Peg, Split Peg, and Golden Bucket each cost $10 initially, then $20, $40, $80… independently. Purchases add one new charge immediately; spent charges stay spent. Unlock counts survive death, and every new life refills charges at fresh random positions. Special pegs use binomial weights for an ideal 50/50 left-right ball path, with equal total weight per row and no outer-edge pegs. Golden Buckets use the same binomial distribution after all rows, choosing among unassigned buckets. Actual physics and special effects can change the ball's path. A roll onto an occupied special peg rerolls exactly once; if the reroll is occupied too, the upgrades stack there. Every purchased charge is placed. Stacked Bouncy charges add their kicks, while stacked Split charges divide the ball's value among the resulting balls. Spent assignments stay reserved until the next life. Rows lock after the first drop; bucket tuning preserves assignments and spent charges.

In Dev mode, each bucket's + / − buttons change only that bucket by 0.1×, with a minimum of 0×. Edits wait for all balls to land and preserve special-peg assignments and spent charges. Adjustments are saved per mode, risk and row count, apply after Normal's Luck adjustment, and remain active when Dev mode is hidden. Golden Buckets double the adjusted payout. **Reset to [Risk] defaults** restores the selected risk and row count, leaving edits to other presets intact. Existing fixed-High edits migrate to High. The original High table remains the default for Normal and Double or Nothing; their 16-row center is still 0.1×. Normal mode retains its Luck control. Existing upgrades and legacy skill migrations are preserved.

History reports the net result of the entire drop, including all children. The house ball costs you nothing, so its proceeds are a net gain. Paid drops show actual profit or loss. In Double or Nothing, split children divide the original wager's value and cost, so their combined value is unchanged before bucket payouts. In Prestige, Double Peg children keep the parent's payout value while sharing its purchase cost. Fractional cents accumulate before rounding.

Progress is stored in your browser for the current site address; localhost, Cloudflare tunnels, and GitHub Pages have separate saves.

The default ball size is 1.8× the peg radius. Under **Tuning → Development**, **Reset all progress** clears all modes' upgrades, settings, and legacy saves in this browser, then reloads a fresh game. Tap twice within five seconds to confirm.

## Prestige skill tree

The debt storyline is the tree's trunk and grows north. Debts are paid in order from banked cash. Each one unlocks the next ball size, ten times larger: paying the first unlocks $10 balls, the second $100 balls, and so on. Only the next debt and one mystery debt are shown.

| # | Debt | Cost | Unlocks |
| --- | --- | --- | --- |
| 1 | Pay off the Step Pay burrito payments | $25 | $10 balls |
| 2 | Pay Ted back his $100 | $100 | $100 balls |
| 3 | Pay the electricity bill | $250 | $1K balls |
| 4 | Pay rent | $1,000 | $10K balls |
| 5 | Pay off the car loan | $20,000 | $100K balls |
| 6 | Pay off the student loans | $100,000 | $1M balls |
| 7 | Pay off the mortgage | $500,000 | $10M balls |
| 8 | Bail out Ted's company | $2,500,000 | $100M balls |
| 9 | End world hunger | $6,000,000 | $1B balls |
| 10 | Buy a private island | $25,000,000 | $10B balls |
| 11 | Fund Ted's moon base | $150,000,000 | $100B balls |
| 12 | Buy the moon | $1,000,000,000 | $1T balls |
| 13 | Pay off the national debt | $35T | $10T balls |

Five branches grow beside the trunk. A skill higher up a branch requires the one below it. Prices round up to whole dollars.

| Branch | Skill | Effect | Max | First price | Growth |
| --- | --- | --- | --- | --- | --- |
| Pegs | Bouncy Pegs | Permanent purple peg that kicks every ball sideways; never runs out | 10 | $25 | ×2 |
| Pegs | Double Pegs (needs Bouncy Pegs) | Permanent blue peg that adds a full-value copy of any ball touching it, once per peg per ball lineage | 10 | $100 | ×2.5 |
| Buckets | Beginner's Luck | Middle bucket pays 2× instead of 0.1× for its first 3 hits each run; it cracks on each hit and breaks on the third | 1 | $10 | — |
| Buckets | Bucket Slider (needs Beginner's Luck) | A marker hops one bucket every 0.45 s and doubles the bucket beneath it | 1 | $250 | — |
| Balls | Bouncy Balls | +1% chance per level that a ball spawns pink with 200% bounciness | 10 | $50 | ×1.8 |
| Pity | Rookie Luck | $1 balls pay +5% per level | 5 | $15 | ×2 |
| Pity | Pity Luck | +10% per level on every landing while your balance is below your starting money | 5 | $30 | ×2 |
| Pity | More Starting Money | Runs start with $5 → $10 → $15 → $25 → $40 → $60 → $100 → $150 → $250 → $400 → $600 | 10 | $20 | ×2 |
| Risk | Greed | +25% on every bucket per level; cashing out keeps 15% less per level | 3 | $500 | ×3 |
| Risk | Jackpot Edges (needs Greed) | The two outer buckets on each side pay double; the middle bucket becomes a 0× skull | 1 | $1,000 | — |

Special pegs are placed at fresh random positions each run using the same binomial weighting as Double or Nothing. A board holds at most 150 balls; Double Pegs stop copying at that limit. Skills bought mid-run apply immediately, except More Starting Money, which applies from the next run.

## Local development

Use Node.js 22 and npm:

```sh
npm ci
npm run dev
```

The development server runs at the root URL, including when accessed through a Cloudflare tunnel.

## Checks and production preview

```sh
npm test
npm run build
npm run preview
```

The production build is written to `dist` with the `/plinko-incremental/` asset prefix required by GitHub Pages. Open `http://localhost:4173/plinko-incremental/` for the local production preview.

## Deployment

GitHub Pages uses **GitHub Actions** as its build source. The workflow in `.github/workflows/pages.yml` tests, builds, and deploys `dist` on every push to `master`. It can also be started manually from the Actions tab. No server or Cloudflare tunnel is required for the published site.
