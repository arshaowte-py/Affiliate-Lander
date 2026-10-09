# Frido Creator lander

A single-page, self-contained launch page for the Frido Creator programme.

## Files
- `index.html` — the page. All CSS, JS, the official Frido logo and the Pattern-Basic glyph are inline.
- `assets/ugc/*.mp4` — the six creator videos, re-encoded for web (540×960, H.264, faststart).
- `assets/ugc/posters/*.jpg` — poster frames shown before each video loads.
- `apps-script/Code.gs` — Google Sheets backend for applications and analytics.

## Live site
Netlify project `fridoxcreators` → https://fridoxcreators.netlify.app/ (currently deployed by manual drag-and-drop). To deploy from this repo instead, link it in Netlify: Site configuration → Build & deploy → Link repository; `netlify.toml` already publishes the repo root with no build step.

## Backend status
Not connected yet. `CONFIG.submitEndpoint` and `CONFIG.analyticsEndpoint` are empty, so applications are **not** being saved anywhere and the form shows an error on the last step. Events only reach `window.dataLayer`. Follow "Go live" below, then redeploy.

Quick check once connected: open the Apps Script `/exec` URL in a browser — it should return `{"ok":true,"service":"frido-creator-lander"}` — then submit one test application and confirm a row lands in the `Applications` tab.

## Go live
1. Set up the backend (about 3 minutes, needs the Google account that should own the data):
   1. Create a Google Sheet → Extensions → Apps Script → replace `Code.gs` with `apps-script/Code.gs` → Save.
   2. Choose `setup` in the function dropdown → Run → approve permissions. The log should say "Setup OK".
   3. Deploy → New deployment → Web app · Execute as **Me** · Who has access **Anyone** → Deploy → copy the `/exec` URL.
2. In `index.html`, fill the `CONFIG` block: `submitEndpoint`, `analyticsEndpoint`, `referralBaseUrl`, `privacyUrl`, `termsUrl` (and `supportUrl` if approved).
   After pasting a new version of `Code.gs`, use Deploy → Manage deployments → edit → **New version**, or the live URL keeps running the old code.
3. Host the folder as-is (Netlify, or a Shopify page with the assets on the Shopify CDN — then update the paths in `CREATORS`).

Without `submitEndpoint` the form shows an error instead of success. It never fakes a confirmation.

## Adding creators
Add a line to the `CREATORS` array. Leave `name` and `handle` blank until the creator has approved being credited. `label` shows on the video card; `product` puts the video in the product section; `packshot` (optional) swaps the video frame for an official product cut-out.

## Placeholders to replace
- Tier names in `TIERS` ("Start / Grow / Lead") are working names.
- Step 4 product cut-outs are inlined in `index.html` (from the official myfrido.com images). To change them, swap the files in the build and rebuild, or edit `PRODUCT_IMAGES`.
- Gilroy: the page falls back to Outfit. To use Gilroy, add licensed `@font-face` files; the font stack already lists Gilroy first.

## Analytics
Events go to `window.dataLayer` (as `frido_creator_<event>`) and, if set, to `analyticsEndpoint`:
page_view, hero_cta_click, cta_click, creator_reel_play, creator_reel_complete, application_start, application_step_1–4, application_submit, application_success, founding_pass_view, pass_save, pass_share, whatsapp_share, referral_link_copy, referral_invite_click, faq_open.

`?ref=` and UTM parameters are kept for the session and sent with the application.

## Before launch
- [ ] `submitEndpoint` / `analyticsEndpoint` set to the deployed Apps Script URL (the form will not show success without it).
- [ ] `referralBaseUrl`, `privacyUrl`, `termsUrl` (and `supportUrl` if used) filled in.
- [x] `og:image`, `og:url` and `referralBaseUrl` point at `https://fridoxcreators.netlify.app/` (change all three if the page moves to another domain).
- [ ] Commission and discount terms confirmed with the offer owner (the page deliberately shows no numbers).
- [ ] Tier names (Start / Grow / Lead) confirmed or replaced in `TIERS`.
- [ ] Test on a real iPhone (Safari) and Android (Chrome): video autoplay, the full-screen player, and the form.
