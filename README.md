# Brawl Stars daily gift

A small Bun CLI that attempts to claim the known daily free offer from the Supercell **web store**. It does not log in or claim in-game shop rewards. There are no runtime dependencies; TypeScript and Bun type definitions are development dependencies.

## Setup

1. Install Bun and run `bun install --frozen-lockfile`.
2. Sign in to the [Supercell Store](https://store.supercell.com/fr/brawlstars). In browser developer tools, use the Network tab to inspect a store request's Cookie header.
3. Copy `.env.example` to `.env` and set `SESSION_COOKIE`, `SC_STORE_Q` (the cookie named `sc-store-q`), and `SCSO_SCID` (the cookie named `scsso_scid`). Set `NEXT_LOCALE` if needed. Bun loads `.env` locally.
4. Run `bun run status` to check discovery without claiming, then `bun run claim` to claim.

Cookies are credentials: don't share them, paste them into issues, or commit `.env`. They expire and must be refreshed manually.

## GitHub Actions

1. Create repository Actions secrets `SESSION_COOKIE`, `SC_STORE_Q`, and `SCSO_SCID` with the corresponding cookie **values**, not the entire Cookie header.
2. Edit `.github/workflows/claim.yml`: its `10 8 * * *` cron is an **example at 08:10 UTC**, not a verified reset time. Determine the store reset time and set the cron for 10 minutes afterwards.
3. The workflow runs on the `main` branch and can also be started manually from the Actions tab. If your default branch differs, change the job's branch condition.

Scheduled Actions can be delayed or dropped; exact timing is not guaranteed. The claim workflow doesn't upload artifacts or print request/response bodies. Use a private repository if run metadata and logs should not be public.

## Checks

Run `bun run typecheck` and `bun test`. CI uses synthetic fixtures and does not access the store or require secrets.

## Limitations

The offer SKU pattern and API are based on the original project's observed, reverse-engineered flow. It finds all distinct SKUs matching that one known daily-free pattern; it cannot guarantee discovery of other free offers or future formats. An empty successful claim response is treated as likely already claimed, but this is a heuristic, not confirmation. HTTP 400/409 responses remain ambiguous failures. The script still sends the claim request because it cannot reliably detect a previously claimed offer from the page. Bun's HTTP fingerprint differs from the original's browser impersonation, and live store compatibility has not been verified. Store-side changes, access restrictions, or expired cookies can break the script.
