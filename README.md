# Zoho Books Field Automation

A browser userscript that fills computed fields in Zoho Books **live, before the
initial save** — starting with the shipping-charge field
(`cost × (1 + markup% / 100)`).

## Install

1. Install a userscript manager:
   - **Chrome / Edge:** [Tampermonkey](https://www.tampermonkey.net/)
     (Violentmonkey was removed from the Chrome Web Store)
   - **Firefox:** [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey
   - **Safari:** [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)
     (App Store), then enable it in Safari → Settings → Extensions
2. **Chrome only:** go to `chrome://extensions`, open the extension's details
   page, and enable **"Allow user scripts"** (on older Chrome, enable
   **Developer mode** on the extensions page instead). Without this, scripts
   silently never run.
3. Open the install link:
   **https://raw.githubusercontent.com/jamesGlowacki/zoho-books-automation/main/zoho-books-automation.user.js**
   The manager shows an install prompt — confirm. (Safari: tap the Userscripts
   toolbar icon on that page and choose install.)

Updates: Tampermonkey/Violentmonkey re-check about daily and install any release
with a higher `@version` automatically. Safari's Userscripts also checks
periodically but shows the update in its popup — click it there to apply.

## Notes

- Runs only on `https://books.zoho.com/*`.
- This repo is the **distribution channel**; development happens in a private
  repo and releases are pushed here with a version bump.
