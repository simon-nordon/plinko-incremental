[**Play Plinko Incremental on GitHub Pages**](https://simon-nordon.github.io/plinko-incremental/)

# Plinko Incremental

A browser-based Plinko game built with TypeScript, Vite, and Matter.js.

- **Normal:** start with $5, drop balls from $1, and unlock larger stakes as your balance grows.
- **Double or Nothing:** start with $100 and wager your entire balance on one ball. A balance below $10 ends the run.
- **Permanent skills:** Double or Nothing has its own skill tree. Bouncy Peg turns a random peg purple with twice the normal rebound. It costs $50 initially and doubles in price with each purchase.

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
