/*!
 * Pressgram browser compatibility helper for Element Web.
 *
 * Silences the soft "unsupported browser" toast by pre-setting the
 * localStorage flag that Element Web uses to remember "user already
 * dismissed this warning". Loaded from index.html before bundle.js.
 *
 * The hard-block UnsupportedBrowserView is not touched here — its
 * content is customized via i18n/ru.*.json (incompatible_browser.*)
 * and logo/colors via the standard Element Web theming.
 */
(function () {
  "use strict";
  try {
    localStorage.setItem("mx_accepts_unsupported_browser", "true");
  } catch (_) {}

  // Hook invoked from the patched UnsupportedBrowserView in init.js
  // (see scripts/patch_element_compat.py). Redirects to the Pressgram-branded
  // unsupported-browser screen. Bypass once the user clicks "continue anyway".
  window.pressgramShowUnsupported = function () {
    try {
      if (localStorage.getItem("pressgram_bypass_unsupported") === "true") return;
    } catch (_) {}
    if (location.pathname !== "/unsupported_browser.html") {
      location.replace("/unsupported_browser.html");
    }
  };
})();
