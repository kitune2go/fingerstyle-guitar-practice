// Shared by index.html, phrase.html and rhythm.html.
//
// This used to live at the end of each page's async bootstrap() and was wrapped
// in a window "load" listener. bootstrap() awaits network I/O, so "load" had
// almost always fired by the time the listener was attached and the service
// worker was never registered at all. Register straight away instead: these are
// deferred scripts, so the document is already parsed.
(() => {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("[app] service worker registration failed:", error);
  });
})();
