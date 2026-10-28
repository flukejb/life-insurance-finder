# Life Insurance Finder

A modern single-page app to research and compare life insurance carriers. It loads live rate-environment
data on every visit, with a **Refresh** button, and estimates premiums for your profile.

**Hosting:** Cloudflare Workers with static assets (free: 100k requests/day, no credit card).

## What is live vs. modeled

| Data | Source | Freshness |
| --- | --- | --- |
| 10-yr Treasury yield, curve, 30-day trend | U.S. Treasury (FRED as fallback), fetched by `functions/api/market.js` | Live on load and on Refresh |
| Premium estimates | Rate model in `public/js/engine.js` | Computed instantly in the browser |
| Carrier ratings and features | `public/data/insurers.json` | Curated; update the file and redeploy |

No free public API returns real life insurance quotes, so premiums are **estimates**, not quotes.
Always confirm with a licensed broker and check AM Best and NAIC before buying.

## Features

- Compare 19 carriers by estimated price, AM Best rating, no-exam, convertibility and a value score
- Term (10-30 yr) and whole-life estimates; shortlist side by side; CSV export and print
- Price by term length and a laddering simulator
- Cost-of-waiting analysis and a birthday/age-nearest tip
- DIME coverage calculator, buying checklist, agent questions, glossary, methodology
- Light/dark theme; settings saved in your browser

## Run locally

```bash
npm install
npm run dev     # http://localhost:8788
```

## Deploy free on Cloudflare

Command line:

```bash
npx wrangler login
npm run deploy      # runs `wrangler deploy`
```

Auto-deploy on push: in the Cloudflare dashboard open **Workers & Pages** > **Create** > **Import a repository**,
pick this repo, leave the build command empty, and keep the deploy command as `npx wrangler deploy`.

## Updating carrier data

Edit `public/data/insurers.json` (ratings, price factors, features) and push. Adjust the rate
shape in `public/js/engine.js` if you want to calibrate to quotes you have gathered.
