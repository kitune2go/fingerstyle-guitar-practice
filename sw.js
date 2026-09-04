const CACHE_NAME = "fingerstyle-practice-v11";
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
  "./rhythm.css",
  "./rhythm.js",
  "./rhythm/pattern-model.js",
  "./rhythm/core/audio-engine.js",
  "./rhythm/core/scheduler.js",
  "./rhythm/core/visual-clock.js",
  "./rhythm/modes/ghost-mode.js",
  "./rhythm/views/grid-view.js",
  "./rhythm/views/orbit-view.js",
  "./audio-credits.html",
  "./core/sample-player.js",
  "./assets/audio/guitar-nylon/b1.mp3",
  "./assets/audio/guitar-nylon/d2.mp3",
  "./assets/audio/guitar-nylon/e2.mp3",
  "./assets/audio/guitar-nylon/fs2.mp3",
  "./assets/audio/guitar-nylon/gs2.mp3",
  "./assets/audio/guitar-nylon/a2.mp3",
  "./assets/audio/guitar-nylon/b2.mp3",
  "./assets/audio/guitar-nylon/cs3.mp3",
  "./assets/audio/guitar-nylon/d3.mp3",
  "./assets/audio/guitar-nylon/e3.mp3",
  "./assets/audio/guitar-nylon/fs3.mp3",
  "./assets/audio/guitar-nylon/g3.mp3",
  "./assets/audio/guitar-nylon/a3.mp3",
  "./assets/audio/guitar-nylon/b3.mp3",
  "./assets/audio/guitar-nylon/cs4.mp3",
  "./assets/audio/guitar-nylon/ds4.mp3",
  "./assets/audio/guitar-nylon/e4.mp3",
  "./assets/audio/guitar-nylon/fs4.mp3",
  "./assets/audio/guitar-nylon/gs4.mp3",
  "./assets/audio/guitar-nylon/a4.mp3",
  "./assets/audio/guitar-nylon/b4.mp3",
  "./assets/audio/guitar-nylon/cs5.mp3",
  "./assets/audio/guitar-nylon/d5.mp3",
  "./assets/audio/guitar-nylon/e5.mp3",
  "./assets/audio/guitar-nylon/fs5.mp3",
  "./assets/audio/guitar-nylon/g5.mp3",
  "./assets/audio/guitar-nylon/gs5.mp3",
  "./assets/audio/guitar-nylon/a5.mp3",
  "./assets/audio/guitar-nylon/as5.mp3",
  "./assets/audio/bass-electric/cs2.mp3",
  "./assets/audio/bass-electric/e2.mp3",
  "./assets/audio/bass-electric/g2.mp3",
  "./assets/audio/bass-electric/as2.mp3",
  "./assets/audio/bass-electric/e3.mp3",
  "./assets/audio/drums/kick.wav",
  "./assets/audio/drums/snare.wav",
  "./assets/audio/drums/snare-2.wav",
  "./assets/audio/drums/snare-3.wav",
  "./assets/audio/drums/hihat-closed.wav",
  "./assets/audio/drums/hihat-open.wav",
  "./assets/audio/drums/tom.wav",
  "./assets/audio/drums/tom-2.wav",
  "./assets/audio/drums/tom-3.wav",
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

function lessonAssetPaths(lesson) {
  return Object.values(lesson.assets ?? {})
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) =>
      typeof value === "string" &&
      !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)
    )
    .map((value) => `./${value.replace(/^\.\//, "")}`);
}

async function precacheLesson(cache, path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const lesson = await response.clone().json();
  await cache.put(path, response);

  const assets = lessonAssetPaths(lesson);
  if (assets.length) await addAllReporting(cache, assets, `assets declared by ${path}`);
}

// Lesson files and their declared local assets are discovered from the index,
// so adding a score never requires a second hand-maintained cache list.
async function precacheLessons(cache) {
  try {
    const response = await fetch("./data/lessons-index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const index = await response.json();
    const paths = (index.lessons || []).map((lesson) => `./data/${lesson.path}`);
    const results = await Promise.allSettled(paths.map((path) => precacheLesson(cache, path)));
    const failed = paths.filter((_, index) => results[index].status === "rejected");
    if (failed.length) console.warn("[sw] lesson data could not be cached:", failed);
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
