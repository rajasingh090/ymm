/* GymPulse AI - lightweight service worker (static asset cache only) */
const CACHE = "gympulse-v1";
const ASSETS = [
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/js/workout.js",
  "/static/js/charts.js",
  "/static/icons/icon.svg",
  "/static/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API responses or pages - workout data must always be fresh.
  if (event.request.method !== "GET" || !url.pathname.startsWith("/static/")) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(event.request, copy));
      return res;
    }).catch(() => hit))
  );
});
