# Studio Chat — Perchance tools

A lightweight installable web app that brings three Perchance.org tools into one responsive interface:

1. **Character generator** — embeds `https://perchance.org/ai-character-generator`
2. **Character chat** — embeds `https://perchance.org/ai-character-chat`
3. **Standalone image generator** — uses the Perchance image iframe + `postMessage` integration described at `https://perchance.org/perchance-ai-api`

This is a frontend wrapper, not an unofficial Perchance REST API. It does not scrape pages, bypass bot checks, or extract private API keys.

## Deployment

This repository is configured to deploy automatically to GitHub Pages using the workflow in `.github/workflows/deploy.yml`.

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open the **Actions** tab and wait for **Deploy Studio Chat to GitHub Pages** to finish.
4. Your site will be published at **https://lamekmalik1-creator.github.io/Studio-Chat/**.

Every push to `main` automatically republishes the site.

## Install on Android

1. Open the published GitHub Pages URL in Chrome on Android.
2. Open Chrome's three-dot menu.
3. Choose **Install app** or **Add to Home screen**.
4. Launch Studio Chat from the new home-screen icon.

The PWA shell is cached for repeat visits. AI generators require internet and may not work offline.

## Notes about embeds

- Perchance may change its pages, require browser verification, or disallow a particular embedded context. If an iframe is blank, use its **Open directly** link.
- Character creation and chat are provided by Perchance's own pages, not reimplemented here.
- The image integration listens only for `postMessage` events from `https://perchance.org` and checks the request ID. This integration may change or be blocked by browser or Perchance security settings.
- Generated images and chat history are subject to Perchance's own storage, privacy, and usage behavior.
- This independent project is not affiliated with Perchance.
