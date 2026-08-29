const CACHE_NAME = "fingerstyle-practice-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./guitar.css",
  "./guitar.js",
  "./register-sw.js",
  "./phrase.html",
  "./phrase.css",
  "./phrase.js",
  "./rhythm.html",
  "./data/phrases.json",
  "./data/lessons-index.json",
  "./manifest.json",
  "./icon-192.svg",
  "./icon-512.svg"
];

// cache.addAll() rejects the whole batch when a single entry 404s, which used to
// leave the cache empty and silent. Add entries one by one and report the gaps.
async function addAllReporting(cache, urls, label) {
  const results = await Promise.allSettled(urls.map((url) => cache.add(url)));
  const failed = urls.filter((_, index) => results[index].status === "rejected");
  if (failed.length) console.warn(`[sw] ${label} could not be cached:`, failed);
  return failed.length === 0;
}

// Lesson files are listed in the index, so discover them instead of hardcoding
// a list that silently rots every time a lesson is added.
async function precacheLessons(cache) {
  try {
    const response = await fetch("./data/lessons-index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const index = await response.json();
    const paths = (index.lessons || []).map((lesson) => `./data/${lesson.path}`);
    await addAllReporting(cache, paths, "lesson data");
  } catch (error) {
    console.warn("[sw] lesson precache skipped:", error);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // The app shell is all-or-nothing: a worker that activates with part of
      // the shell missing serves a half-broken app offline, and it replaces a
      // previous worker that was serving a complete one. Rejecting here fails
      // the install, so the older working worker stays in charge.
      const complete = await addAllReporting(cache, APP_SHELL, "app shell");
      if (!complete) throw new Error("[sw] app shell incomplete, keeping the previous worker");

      // Lesson data is discovered from the index rather than declared, and a
      // single missing lesson only costs that lesson offline. Warn and carry on.
      await precacheLessons(cache);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const networkSensitive =
    event.request.mode === "navigate" ||
    event.request.destination === "script" ||
    event.request.destination === "style" ||
    url.pathname.includes("/data/");

  if (networkSensitive) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || networkFirst(event.request))
  );
});
