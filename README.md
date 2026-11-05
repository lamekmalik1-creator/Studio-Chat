# Perchance Studio — GitHub Pages PWA

A lightweight installable web app that brings three Perchance.org tools into one responsive interface:

1. **Character generator** — embeds `https://perchance.org/ai-character-generator`
2. **Character chat** — embeds `https://perchance.org/ai-character-chat`
3. **Standalone image generator** — uses the Perchance image iframe + `postMessage` integration documented at `https://perchance.org/perchance-ai-api`

This is a frontend wrapper, not an unofficial Perchance REST API. It does not scrape pages, bypass bot checks, or extract private API keys.

## Deploy with GitHub Pages

1. Create a new public GitHub repository, for example `perchance-studio`.
2. Upload all files and folders in this project to the repository root. Keep the `.github/workflows/deploy.yml` file.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **GitHub Actions** as the source.
5. Open the **Actions** tab and wait for **Deploy Perchance Studio to GitHub Pages** to finish.
6. Your site will be published at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

Every push to `main` automatically republishes the site.

## Install on Android

1. Open the published GitHub Pages URL in Chrome on Android.
2. Open Chrome's three-dot menu.
3. Choose **Install app** or **Add to Home screen**.
4. Launch Perchance Studio from the new home-screen icon.

The PWA shell is cached for repeat visits. AI generators require internet and may not work offline.

## Notes about embeds

- Perchance may change its pages, require browser verification, or disallow a particular embedded context. If an iframe is blank, use its **Open directly** link. The app intentionally provides this fallback.
- Character creation and chat are provided by Perchance's own pages, not reimplemented here.
- The image integration listens only for `postMessage` events from `https://perchance.org` and checks the request ID.
- Generated images and chat history are subject to Perchance's own storage, privacy, and usage behavior.
- This independent project is not affiliated with Perchance.

## Customization

Edit `index.html` to change generator URLs or labels. Edit `styles.css` for appearance. The app uses relative asset paths so it can run from a GitHub Pages repository subpath.
