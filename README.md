# Zoho Books Field Automation

A [Violentmonkey](https://violentmonkey.github.io/) userscript that fills computed
fields in Zoho Books **live, before the initial save** — starting with the
shipping-charge field (`cost × (1 + markup% / 100)`).

## Install

1. Install the Violentmonkey browser extension.
2. Open the install link:
   **https://raw.githubusercontent.com/jamesGlowacki/zoho-books-automation/main/zoho-books-automation.user.js**
3. Violentmonkey shows an install dialog — confirm.

Updates are automatic: Violentmonkey re-checks that URL about once a day and
installs any release with a higher `@version`.

## Notes

- Runs only on `https://books.zoho.com/*`.
- This repo is the **distribution channel**; development happens in a private
  repo and releases are pushed here with a version bump.
