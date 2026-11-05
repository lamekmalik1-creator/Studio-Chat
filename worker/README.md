# Studio Chat API (Cloudflare Worker)

This Worker keeps the OpenRouter API key off the public GitHub Pages frontend. The current Phase 1 API provides health checks, a free-model list, and streamed character-chat completions.

## Prerequisites

- A Cloudflare account with Workers enabled
- An OpenRouter API key
- Node.js and Wrangler CLI

## Deploy

From this directory:

```sh
npm install --global wrangler
wrangler login
wrangler secret put OPENROUTER_API_KEY
wrangler deploy
```

Paste the OpenRouter key only into the Wrangler secret prompt. Do not put it in GitHub, frontend JavaScript, or a URL.

The deployed Worker URL will look like `https://studio-chat-api.<your-subdomain>.workers.dev`. Enter that URL in Studio Chat's API connection field.

## Configuration

Edit `wrangler.toml` and set `ALLOWED_ORIGINS` to the exact origin hosting the frontend. For the current GitHub Pages project this is:

```
https://lamekmalik1-creator.github.io
```

For local development, add the exact local origin (for example `http://localhost:8788`) as a comma-separated value. Do not use a wildcard origin.

## Routes

- `GET /api/health` — Worker health and provider status
- `GET /api/models` — OpenRouter models currently marked free, plus the `openrouter/free` router
- `POST /api/chat` — streamed OpenAI-compatible chat completion; only free model IDs are accepted

The Worker validates request size, message count, roles, and model IDs. CORS is an origin policy, **not authentication**: a public Worker URL can still be called outside a browser. Before sharing the app widely, add Cloudflare rate limiting and abuse protection appropriate to your deployment.

## Free-model notes

OpenRouter's free model availability and rate limits can change. This app starts with `openrouter/free`; selecting a specific free model is optional. There is no paid-model fallback in this build.
