# Frido Creator lander

A single-page, self-contained launch page for the Frido Creator programme.

## Files
- `index.html` — the lander. Every "Join" / "Become a Frido Creator" / "Start your application" CTA (any `href="#apply"`) opens the application popup. The old inline 4-step form is still in the markup but hidden, so its script keeps running untouched.
- `apply.html` — the application form (3 steps) shown inside the popup. Also works on its own.
- `assets/ugc/*` — creator videos and posters.
- `apps-script/Code.gs` — backend: saves each application to a Google Sheet, then syncs it to Bigin (Contact + "Creator Onboarding" pipeline record + full note).

## How a submission flows
1. Creator fills `apply.html` → POST to the Apps Script `/exec` URL.
2. Apps Script writes a row to **Creator Applications** (the backup) and answers `{ok:true, id}`. Only then does the form show "Application sent".
3. Same request: Bigin Contact is matched by mobile (then email) and updated, or created. A record is created in **Creator Onboarding** at stage **New Application**, linked to the Contact, tagged **Creator Lander**, with every answer in a note. If that Contact already has a Creator Onboarding record, the new application is added to it as a note instead of a duplicate.
4. If Bigin fails, the row shows `bigin_status = Error` and the 10-minute retry trigger tries again (up to 6 times).

`?ref=` and UTM parameters on the lander are passed into the popup and saved on the application (Outreach Ref / UTM Campaign in Bigin).

## Bigin fields to create
The "Creator Onboarding" pipeline exists (stage "New Application" is where applications land), but as of 19 Oct 2026 it has **none** of the custom fields below. Until they exist, every answer still goes into the record's note, so nothing is lost; the fields make the answers filterable and give the dashboard something to count.

Bigin → Settings → Customization → Pipelines → Creator Onboarding → add these. Labels must match exactly (`checkBigin` maps label → API name). Picklist values must match exactly too, or Bigin rejects the value and the record is saved without the custom fields (the note says which).

| Label | Type | Values |
|---|---|---|
| Application ID | Single line | |
| Instagram Handle | Single line | |
| Instagram URL | URL | |
| Followers Range | Pick list | Under 10k · 10k–50k · 50k–100k · 100k–500k · 500k+ |
| Avg Reel Views | Pick list | Under 5k · 5k–25k · 25k–100k · 100k+ |
| Other Accounts | Multi line | |
| Niche | Multi-select | WFH / desk · Lifestyle · Health / physio · Fitness · Parenting · Travel · Tech · Fashion · Comedy · Other |
| Open To | Multi-select | Affiliate money · Barter collab · Paid content / UGC · Partnership ads |
| Partnership Ads OK | Pick list | Yes · Open to discuss · No |
| Fee per Reel | Currency | |
| Products Interested | Multi-select | Posture & back · Sleep & pillows · Cushions & seating · Hot & cold therapy · Feet & walking · Workspace & chairs |
| Content Language | Pick list | English · Hindi · Hinglish · Marathi · Tamil · Telugu · Kannada · Malayalam · Bengali · Gujarati · Punjabi · Other |
| Heard From | Pick list | Instagram DM from Frido · Email from Frido · Frido influencer marketing team · Frido employee · Another creator · Frido website · Frido store · Other |
| Heard From Person | Single line | |
| In Touch With Frido | Pick list | Yes · No |
| Frido Contact Name | Single line | |
| Frido Contact Team | Pick list | Not sure · Influencer marketing · Marketing / brand · Sales · Retail store · Other |
| Outreach Ref | Single line | |
| UTM Campaign | Single line | |
| Existing Affiliate Code | Single line | |

The ranges use an en dash (–), not a hyphen. Copy the values from this table.

## Go live
1. **Bigin** — pipeline "Creator Onboarding" with stage "New Application", plus the fields above.
2. **Apps Script** — new Google Sheet → Extensions → Apps Script → paste `apps-script/Code.gs`, then run in order: `setup`, `connectBigin` (see the steps at the top of the file — never commit the code/secret), `checkBigin`, `installRetryTrigger`.
   Self Client scope (exactly): `ZohoBigin.modules.ALL,ZohoBigin.modules.notes.ALL,ZohoBigin.settings.layouts.READ,ZohoBigin.settings.tags.ALL,ZohoBigin.users.READ,ZohoSearch.securesearch.READ`. Search needs `ZohoSearch.securesearch.READ`, and the tag is created on first use, so it needs `settings.tags`.
3. **Deploy** → New deployment → Web app · Execute as **Me** · Access **Anyone** → copy the `/exec` URL.
4. **index.html** → paste that URL into `CONFIG.submitEndpoint` and `CONFIG.analyticsEndpoint`. That's the only place it goes; the lander passes it to the popup.
5. Deploy the folder (Netlify).
6. Test: open the `/exec` URL (should return `{"ok":true,...,"bigin":true}`), submit one application, check the Sheet row says `Synced` and the record is in Bigin.

The form never shows success without a confirmed save, and it only ever posts to a `script.google.com` web app.

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
- [ ] `CONFIG.submitEndpoint` / `analyticsEndpoint` set to the deployed Apps Script URL.
- [ ] One test application shows `Synced` in the Sheet and appears in Bigin → Creator Onboarding.
- [ ] `termsUrl` (and `supportUrl` if used) filled in. `privacyUrl` is set to myfrido.com's privacy policy; links with no URL are hidden.
- [x] `og:image`, `og:url` and `referralBaseUrl` point at `https://fridoxcreators.netlify.app/` (change all three if the page moves to another domain).
- [ ] Commission and discount terms confirmed with the offer owner (the page deliberately shows no numbers).
- [ ] Tier names (Start / Grow / Lead) confirmed or replaced in `TIERS`.
- [ ] Test on a real iPhone (Safari) and Android (Chrome): video autoplay, the full-screen player, and the form.
