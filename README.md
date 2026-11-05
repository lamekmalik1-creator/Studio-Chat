# Studio Chat

A mobile-first installable character roleplay app. The frontend is hosted on GitHub Pages; chat requests are sent through a Cloudflare Worker to OpenRouter so the API key is never exposed in browser JavaScript.

## Phase 1: OpenRouter chat

- Character profile and conversation are saved in the current browser.
- Chat replies stream into the conversation as they are generated.
- The model picker loads currently available free OpenRouter models.
- `openrouter/free` is the default router; there is no paid-model fallback.
- The image studio remains a separate Perchance link for now. Manual, storyline-aware Pollinations generation is planned for a later phase.

## Deploy the frontend

The repository's GitHub Actions workflow deploys the site to GitHub Pages when changes are pushed to `main`.

To preview this work, open the branch `feature/openrouter-worker-phase1` and create a pull request into `main` after reviewing it. Once merged, GitHub Pages will publish the updated frontend.

## Deploy the Cloudflare Worker

The Worker source and Wrangler config are in `worker/`.

Prerequisites:
- Cloudflare account with Workers enabled
- OpenRouter API key
- Node.js and Wrangler CLI

From the repository root:

```sh
cd worker
npm install --global wrangler
wrangler login
wrangler secret put OPENROUTER_API_KEY
wrangler deploy
```

Enter the OpenRouter key only at the Wrangler secret prompt. Never put it in frontend files, a public GitHub secret, or a URL.

After deployment, Wrangler prints a URL similar to:

```
https://studio-chat-api.<your-subdomain>.workers.dev
```

Open Studio Chat, go to **Chat**, paste that URL into **Cloudflare Worker URL**, and tap **Connect**.

## Worker configuration

Edit `worker/wrangler.toml` and set `ALLOWED_ORIGINS` to the exact origin serving your frontend. The current GitHub Pages origin is:

```
https://lamekmalik1-creator.github.io
```

For local development, add the exact local origin as a comma-separated value. Do not use a wildcard.

The Worker routes are:
- `GET /api/health`
- `GET /api/models`
- `POST /api/chat` (Server-Sent Events stream)

The Worker validates request sizes, message roles/counts, and restricts selected model IDs to free variants. It reads `OPENROUTER_API_KEY` from a Cloudflare secret.

**Security note:** CORS restricts browser origins; it is not authentication and does not stop direct scripts or other servers from calling a public Worker URL. Before widely sharing the app, add Cloudflare rate limiting and abuse protection. Do not treat the Worker URL as a private credential.

## Free model limits

OpenRouter's free models are rate-limited and availability can change. Its current published limits for free variants are 20 requests per minute and 50 requests per day; the daily allowance can increase after purchasing credits. The `openrouter/free` router selects from eligible free models automatically. Check OpenRouter's live [free models page](https://openrouter.ai/collections/free-models) before planning sustained use.

## Privacy and storage

Character profiles and chat history are stored in the browser's local storage on this device. Clearing site data can erase them. Export/backup and richer IndexedDB storage are planned for a later phase. Messages are sent to OpenRouter through your Worker; review the privacy policies and data handling of the selected provider/model. Avoid sending passwords or sensitive personal information.

## Existing project

This project is independent and is not affiliated with OpenRouter, Cloudflare, or Perchance.
