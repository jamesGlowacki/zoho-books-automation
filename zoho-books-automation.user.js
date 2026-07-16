// ==UserScript==
// @name         Zoho Books Field Automation
// @namespace    https://github.com/jamesGlowacki/zoho-books-automation
// @version      0.2.0
// @description  Pre-save client-side field population for Zoho Books. Engine + feature registry, built to grow across pages.
// @author       James
// @match        https://books.zoho.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jamesGlowacki/zoho-books-automation/main/zoho-books-automation.user.js
// @downloadURL  https://raw.githubusercontent.com/jamesGlowacki/zoho-books-automation/main/zoho-books-automation.user.js
// ==/UserScript==

// NOTE on @grant none: this runs the script in the PAGE's JS context, not a sandbox.
// That's deliberate and required — the native-setter trick below only makes the page's
// framework register a value change if we're operating on the real page objects.

(function () {
  'use strict';

  const LOG_PREFIX = '[ZB-Auto]';
  const log  = (...a) => console.log(LOG_PREFIX, ...a);
  const warn = (...a) => console.warn(LOG_PREFIX, ...a);

  // ===========================================================================
  // CORE ENGINE  — reusable primitives. You should rarely need to touch this.
  // ===========================================================================

  const Core = {
    /**
     * Set an input's value in a way the page's framework (React/Ember/Zoho's own)
     * actually records. Assigning el.value directly updates the DOM but NOT the
     * framework's internal model, so the save payload would go out WITHOUT it.
     * This is the whole ballgame for pre-save population.
     */
    setNativeValue(el, value) {
      const proto = Object.getPrototypeOf(el);
      const ownSetter   = Object.getOwnPropertyDescriptor(el, 'value')?.set;
      const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const setter = (protoSetter && protoSetter !== ownSetter) ? protoSetter : ownSetter;

      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value; // fallback; shouldn't normally hit this for <input>
      }
      // Fire the events the framework listens for so it treats this as real input.
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },

    /**
     * Resolve once `selector` exists in the DOM (Zoho renders async, so elements
     * won't be there on first run). Rejects after `timeout` ms.
     */
    waitForElement(selector, { timeout = 10000, root = document } = {}) {
      return new Promise((resolve, reject) => {
        const existing = root.querySelector(selector);
        if (existing) return resolve(existing);

        const obs = new MutationObserver(() => {
          const el = root.querySelector(selector);
          if (el) {
            obs.disconnect();
            resolve(el);
          }
        });
        obs.observe(root.documentElement || root, { childList: true, subtree: true });

        if (timeout) {
          setTimeout(() => {
            obs.disconnect();
            reject(new Error(`waitForElement timed out: ${selector}`));
          }, timeout);
        }
      });
    },

    /**
     * Attach a listener to an element exactly once, guarded by a dataset flag so
     * repeated init() calls (route changes, re-renders) don't stack duplicate handlers.
     */
    bindOnce(el, key, event, handler) {
      const flag = `zbfBound_${key}`;
      if (el.dataset[flag]) return;
      el.dataset[flag] = '1';
      el.addEventListener(event, handler);
    },
  };

  // ===========================================================================
  // ROUTER  — matches the current URL against registered features and runs them.
  // Handles Zoho's client-side routing (the trap: your script loads ONCE; SPA
  // navigation never reloads it, so page-two features silently never fire).
  // ===========================================================================

  const Router = {
    features: [],

    /** Register a feature module: { name, match(url) => bool, init() }. */
    register(feature) {
      this.features.push(feature);
      log('registered feature:', feature.name);
    },

    /** Run init() for every feature whose match() accepts the current URL. */
    runMatching() {
      const url = location.href;
      for (const f of this.features) {
        let matches = false;
        try { matches = f.match(url); } catch (e) { warn(`${f.name} match() threw`, e); }
        if (!matches) continue;
        try {
          f.init();
        } catch (e) {
          warn(`${f.name} init() threw`, e);
        }
      }
    },

    /** Patch history + listen for navigations, re-running features on URL change. */
    start() {
      const fire = () => {
        // Defer a tick so the SPA has begun rendering the new view.
        setTimeout(() => this.runMatching(), 0);
      };

      // Patch pushState/replaceState to emit a detectable event.
      for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function (...args) {
          const ret = original.apply(this, args);
          window.dispatchEvent(new Event('zbf:navigation'));
          return ret;
        };
      }
      window.addEventListener('zbf:navigation', fire);
      window.addEventListener('popstate', fire);
      window.addEventListener('hashchange', fire); // Zoho often uses hash routing

      // Safety net: some SPAs mutate the route without any of the above firing.
      let lastHref = location.href;
      setInterval(() => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          fire();
        }
      }, 750);

      // Initial run for the page we loaded on.
      this.runMatching();
      log('router started');
    },
  };

  // ===========================================================================
  // FEATURE: shipping markup
  // Populates the shipping-charge field live as cost/markup are entered, so the
  // value is present in the INITIAL save payload (which server-side automation
  // fundamentally can't do — it always writes after the record already exists).
  //
  //   >>> EDIT THE CONFIG BLOCK BELOW. This is the only part that needs your input. <<<
  // ===========================================================================

  const ShippingMarkup = (() => {
    const CONFIG = {
      // --- 1. URL pattern for the invoice create/edit page -------------------
      // Return true when we're on the page that has these fields.
      // Real URL is hash-routed: https://books.zoho.com/app/<orgId>#/invoices/new
      matchesPage: (url) => /\/invoices\/(new|\d+\/edit)/.test(url),

      // --- 2. Selectors — grab from devtools (Inspect each field) ------------
      // Prefer a stable [name="..."] or #id over Zoho's dynamic class chains.
      // NOTE: do NOT use the ember#### ids — Ember regenerates them every render.
      // aria-label is stable and human-meaningful.
      SELECTORS: {
        shippingCost:   'input[aria-label="Shipping Cost"]',
        markup:         'input[aria-label="Shipping Markup"]',
        // Anchor on the data-model binding key: distinctive and language-independent.
        // (cost/markup both bind the generic "value", so we can't key on that for them.)
        shippingCharge: 'input[data-auto-gen-binding-key="shipping_charge"]',
      },

      // --- 3. The math -------------------------------------------------------
      // charge = cost / (1 - markup% / 100).  100 @ 30% -> 142.86
      compute: (cost, markupPercent) => cost / (1 - markupPercent / 100),

      // Decimal places to write into the charge field.
      decimals: 2,
    };

    // Parse "30%", " 30 ", "30.5" -> number; NaN-safe -> 0.
    const num = (raw) => {
      if (raw == null) return 0;
      const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    };

    async function init() {
      const { SELECTORS } = CONFIG;

      // Wait for the source fields to render. If they never appear, we're likely
      // not really on the target page (or selectors are wrong) — bail quietly.
      let costEl, markupEl, chargeEl;
      try {
        [costEl, markupEl, chargeEl] = await Promise.all([
          Core.waitForElement(SELECTORS.shippingCost),
          Core.waitForElement(SELECTORS.markup),
          Core.waitForElement(SELECTORS.shippingCharge),
        ]);
      } catch (e) {
        warn('shipping-markup: fields not found —', e.message);
        return;
      }

      // Write to the charge field only when the value actually changes. This keeps
      // us from re-dispatching input/change (and marking the form dirty) on every
      // recompute that lands on the same result — e.g. priming an existing invoice
      // on load, or clearing an already-blank field.
      const writeCharge = (value) => {
        if (String(chargeEl.value).trim() === String(value).trim()) return;
        Core.setNativeValue(chargeEl, value);
      };

      const recompute = () => {
        const costRaw   = String(costEl.value).trim();
        const markupRaw = String(markupEl.value).trim();

        // If EITHER source is fully erased, the charge is undefined — blank it out.
        // writeCharge's equality check means a genuinely untouched form (charge
        // already empty) stays untouched, so we never dirty it on load.
        if (costRaw === '' || markupRaw === '') {
          writeCharge('');
          log(`source cleared (cost="${costRaw}" markup="${markupRaw}") -> charge blanked`);
          return;
        }

        const cost   = num(costRaw);
        const markup = num(markupRaw);
        const charge = CONFIG.compute(cost, markup).toFixed(CONFIG.decimals);
        writeCharge(charge);
        log(`recompute: cost=${cost} markup=${markup}% -> charge=${charge}`);
      };

      // Live sync on every edit to either source field. bindOnce guards against
      // duplicate handlers if init() runs again on re-render/navigation.
      Core.bindOnce(costEl,   'shipCost',   'input',  recompute);
      Core.bindOnce(markupEl, 'shipMarkup', 'input',  recompute);
      // 'change' too, in case Zoho updates values via non-typing interactions.
      Core.bindOnce(costEl,   'shipCostC',   'change', recompute);
      Core.bindOnce(markupEl, 'shipMarkupC', 'change', recompute);

      // Prime once on load (handles edit of an existing invoice with values present).
      recompute();
      log('shipping-markup feature active');
    }

    return {
      name: 'shipping-markup',
      match: (url) => CONFIG.matchesPage(url),
      init,
    };
  })();

  // ===========================================================================
  // BOOTSTRAP  — register features, then start the router.
  // To add a page later: build another module in the ShippingMarkup shape and
  // Router.register(it) here. The engine + route-watcher handle the rest.
  // ===========================================================================

  Router.register(ShippingMarkup);
  // Router.register(SomeOtherPageFeature);  // <- future features slot in here

  Router.start();
  log('userscript loaded');
})();
