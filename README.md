[**Play Plinko Incremental on GitHub Pages**](https://simon-nordon.github.io/plinko-incremental/)

# Plinko Incremental

A browser-based Plinko game built with TypeScript, Vite, and Matter.js.

- **Normal:** start with $5, drop balls from $1, and unlock larger stakes as your balance grows.
- **Double or Nothing:** start with $100 and wager your entire balance on one drop. Wait for all split children to land before dropping again. A balance below $10 ends the run once all balls settle.
- **Permanent skills:** Double or Nothing has its own skill tree. Bouncy Peg turns a random peg purple with four times the normal rebound, subject to the simulation's speed limit. It costs $50 initially and doubles in price with each purchase.
- **Bucket Return:** permanently improves every Double or Nothing bucket by 5% per level (+5%, +10%, +15%…). This bonus multiplies the Luck-adjusted payouts. Its separate cost starts at $50 and doubles per purchase.
- **Pity:** every level adds another 5% to returns when your original balance before the drop is below $100 (+5%, +10%, +15%…). Costs start at $50 and double. Existing one-time unlocks become level one. Eligibility stays fixed for the entire drop, including split children and Lucky Peg rewards.
- **Lucky Peg:** turns a random ordinary peg gold. Each collision immediately awards 10% of that ball's current value, without reducing its stake. Split children earn rewards on their own half/quarter/etc. value.
- **Duplicate Peg:** turns a random ordinary peg blue. Each hit creates two balls worth half the hitting ball's value. Children can split on other duplicate pegs; the same peg cannot split the same lineage again. The board allows at most 256 simultaneous balls to keep mobile play responsive.

Lucky and Duplicate upgrades each start at $50 and double independently. Peg types occupy different pegs. The history reports the net result of the entire drop, including all children and Lucky Peg rewards. Fractional cents are accumulated before rounding to avoid creating money through splits.

Upgrades survive losing and restarting. Progress is stored in your browser for the current site address; localhost, Cloudflare tunnels, and GitHub Pages have separate saves.

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
