[**Play Plinko Incremental on GitHub Pages**](https://simon-nordon.github.io/plinko-incremental/)

# Plinko Incremental

A browser-based Plinko game built with TypeScript, Vite, and Matter.js.

Fresh settings default to Double or Nothing with High risk and red balls. Saved mode and risk choices are preserved. The bottom-right **Dev mode** toggle reveals Risk, Rows, and the tuning panel, including Ball Size, Weight, Bounciness, and progress reset. It starts disabled on every page load.

- **Normal:** start with $5, drop balls from $1, and unlock larger stakes as your balance grows.
- **1 Ball · Incremental:** select it from **Game mode** to start with $5 and a single $1 ball type. Up to five balls can be in play at once, including queued drops and split children. It defaults to Low risk. Buy permanent upgrades from the skill tree; each purchase leaves at least $1 for another drop and waits for the board to clear. A new game resets cash to $5 and keeps upgrades. Progress is saved separately from the other modes.
- **Double or Nothing:** the first $10 ball each life is on the house. Your spendable balance starts at $0; only the proceeds can buy upgrades. Subsequent drops wager your entire balance. Wait for all split children to land before dropping or buying again. Forced cash out is the greater of 10% of starting money and 5% of your highest balance this life: $1 initially, rising to $100 after reaching $2,000. It never falls until a new life. Falling below it ends the life after all balls settle; exactly the threshold is playable. The threshold appears beneath your balance. Upgrade purchases are blocked if they would leave less than this amount.
- **Bouncy Peg:** adds one randomly placed purple peg per life. Any first contact, including a graze, gives a fixed tangential kick aligned with the ball's travel (bounded by the simulation speed limit), then it becomes ordinary.
- **Split Peg:** adds one randomly placed blue peg per life. Its first hit splits a ball into two balls, each worth half the original. Stacked charges add more balls that share the same total value. Bouncy and Split can occupy the same peg and both activate on that hit.
- **Golden Bucket:** adds one randomly placed gold bucket per life. The first ball pays twice the base multiplier (0.3× → 0.6×, 110× → 220×), then the bucket returns to its base payout. Only one split child can consume its charge.
- **More Starting Money:** upgrades future house balls from $10 → $20 → $50 → $100 → $150 → $250 → $500 → $1,000 → $1,500 → $2,500 → $5,000… with no gameplay level cap. The 1 / 1.5 / 2.5 / 5 pattern repeats at each larger scale. Prices remain ten times the new starting amount ($200 for $20, $500 for $50, $1,000 for $100, $1,500 for $150, and so on). Applies next life and never grants spendable cash directly.

In Double or Nothing, Bouncy Peg, Split Peg, and Golden Bucket each cost $10 initially, then $20, $40, $80… independently. Purchases add one new charge immediately; spent charges stay spent. Unlock counts survive death, and every new life refills charges at fresh random positions. Special pegs use binomial weights for an ideal 50/50 left-right ball path, with equal total weight per row and no outer-edge pegs. Golden Buckets use the same binomial distribution after all rows, choosing among unassigned buckets. Actual physics and special effects can change the ball's path. A roll onto an occupied special peg rerolls exactly once; if the reroll is occupied too, the upgrades stack there. Every purchased charge is placed. Stacked Bouncy charges add their kicks, while stacked Split charges divide the ball's value among the resulting balls. Spent assignments stay reserved until the next life. Rows lock after the first drop; changing risk preserves assignments and spent charges.

Risk options are Low, Medium, High, and Extreme. Extreme keeps the original High payouts. High copies Medium, with the agreed 16-row changes: the center drops from 0.3× to 0.1× and both 1× buckets become 1.2×. Other row counts currently match Medium. The 16-row High base table returns about 99.95% under ideal binomial odds, before upgrades; actual physics can differ. Old High preferences migrate to Extreme. Double or Nothing uses these base payouts without percentage bonuses. The old Bucket Return, Pity, and Lucky Peg skills have been removed. Existing charge unlocks migrate automatically; purchased $150/$250/$500 starts keep their value. Previous save data is left untouched. Normal mode keeps its own settings and Luck control.

History reports the net result of the entire drop, including all children. The house ball costs you nothing, so its proceeds are a net gain. Paid drops show actual profit or loss. In Double or Nothing, split children divide the original wager's value and cost, so their combined value is unchanged before bucket payouts. In 1 Ball, children retain the parent's payout value while sharing its purchase cost. Fractional cents accumulate before rounding.

Progress is stored in your browser for the current site address; localhost, Cloudflare tunnels, and GitHub Pages have separate saves.

The default ball size is 1.8× the peg radius. Under **Tuning → Development**, **Reset all progress** clears all modes' upgrades, settings, and legacy saves in this browser, then reloads a fresh game. Tap twice within five seconds to confirm.

## 1 Ball upgrades

| Upgrade | Effect per level | First price | Price growth |
| --- | --- | --- | --- |
| Max Balls | +1 simultaneous ball, up to 50 | $5 | ×1.6 |
| Ball Value | +5% payout value, compounded; purchase cost stays $1 | $2 | ×1.35 |
| Bouncy Peg | +1 charged peg with a sideways kick | $4 | ×1.8 |
| Split Peg | +1 charge that creates a free ball with the parent's full payout value | $8 | ×1.8 |
| Golden Bucket | +1 bucket that doubles its first landing | $6 | ×1.8 |
| Cashback | +5¢ returned per purchased ball, up to $1 | $3 | ×1.5 |

Prices grow independently and round up to the next cent. Special charges refresh at fresh positions whenever all balls land. Split balls use capacity; if no slot is free, the charge remains ready. Splits share the original $1 cost for profit tracking, while each child keeps the original payout value. Cashback is paid once after the entire purchased drop settles, including all its children. Bucket multipliers use the base risk table; Ball Value and Cashback provide the incremental earnings bonuses. Unlike Double or Nothing, upgrades may be bought using the initial $5.

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
