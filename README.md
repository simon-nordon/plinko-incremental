[**Play Plinko Incremental on GitHub Pages**](https://simon-nordon.github.io/plinko-incremental/)

# Plinko Incremental

A browser-based Plinko game built with TypeScript, Vite, and Matter.js.

- **Normal:** start with $5, drop balls from $1, and unlock larger stakes as your balance grows.
- **Double or Nothing:** the first $100 ball each life is on the house. Your spendable balance starts at $0; only the proceeds can buy upgrades. Subsequent drops wager your entire balance. Wait for all split children to land before dropping or buying again. Below $10 ends the life after all balls settle.
- **Bouncy Peg:** adds one randomly placed purple peg per life. Its first hit gives 4× the normal rebound, subject to the speed limit, then it becomes ordinary.
- **Split Peg:** adds one randomly placed blue peg per life. Its first hit creates two half-value balls, then it becomes ordinary. Bouncy and Split can occupy the same peg and both activate on that hit.
- **Lucky Bucket:** adds one randomly placed gold bucket per life. The first ball pays the next whole multiplier (0.4× → 1×, 0.7× → 1×, 1.2× → 2×, 2× → 3×), then the bucket returns to its base payout. Only one split child can consume its charge.
- **More Starting Money:** upgrades future house balls from $100 → $150 → $250 → $500. Prices are ten times the new starting amount: $1,500, $2,500, and $5,000. Applies next life and never grants spendable cash directly.

Bouncy Peg, Split Peg, and Lucky Bucket each cost $25 initially, then $50, $100, $200… independently. Purchases add one new charge immediately; spent charges stay spent. Unlock counts survive death, and every new life refills charges at fresh random positions. Rows lock after the first drop; changing risk preserves assignments and spent charges.

Double or Nothing uses the reference payout tables without percentage bonuses. The old Bucket Return, Pity, and Lucky Peg skills have been removed. This ruleset starts a fresh skill save; the previous experimental save is left untouched. Normal mode keeps its own settings and Luck control.

History reports the net result of the entire drop, including all children. The house ball costs you nothing, so its proceeds are a net gain. Paid drops show actual profit or loss. Fractional cents accumulate before rounding to prevent splits creating money.

Progress is stored in your browser for the current site address; localhost, Cloudflare tunnels, and GitHub Pages have separate saves.

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
