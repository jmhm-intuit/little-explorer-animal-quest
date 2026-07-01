const CACHE_NAME = 'animal-quest-v2';
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/src/app.js",
  "/src/styles.css",
  "/manifest.webmanifest",
  "/data/animals.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/assets/animals/Animals-pets/dog.webp",
  "/assets/animals/Animals-pets/cat.webp",
  "/assets/animals/Animals-pets/rabbit.webp",
  "/assets/animals/Animals-pets/hamster.webp",
  "/assets/animals/Animals-pets/guinea-pig.webp",
  "/assets/animals/Animals-pets/goldfish.webp",
  "/assets/animals/Animals-pets/turtle.webp",
  "/assets/animals/Animals-pets/parakeet.webp",
  "/assets/animals/Animals-farm/cow.webp",
  "/assets/animals/Animals-farm/horse.webp",
  "/assets/animals/Animals-farm/pig.webp",
  "/assets/animals/Animals-farm/sheep.webp",
  "/assets/animals/Animals-farm/goat.webp",
  "/assets/animals/Animals-farm/chicken.webp",
  "/assets/animals/Animals-farm/duck.webp",
  "/assets/animals/Animals-farm/donkey.webp",
  "/assets/animals/Animals-bugs/ant.webp",
  "/assets/animals/Animals-bugs/bee.webp",
  "/assets/animals/Animals-bugs/butterfly.webp",
  "/assets/animals/Animals-bugs/ladybug.webp",
  "/assets/animals/Animals-bugs/worm.webp",
  "/assets/animals/Animals-bugs/spider.webp",
  "/assets/animals/Animals-bugs/snail.webp",
  "/assets/animals/Animals-bugs/cricket.webp",
  "/assets/animals/Animals-bugs/pill-bug.webp",
  "/assets/animals/Animals-city/squirrel.webp",
  "/assets/animals/Animals-city/pigeon.webp",
  "/assets/animals/Animals-city/hummingbird.webp",
  "/assets/animals/Animals-city/small-lizard.webp",
  "/assets/animals/Animals-city/frog.webp",
  "/assets/animals/Animals-city/wild-rabbit.webp",
  "/assets/animals/Animals-city/crow.webp",
  "/assets/animals/Animals-wild/deer.webp",
  "/assets/animals/Animals-wild/raccoon.webp",
  "/assets/animals/Animals-wild/capybara.webp",
  "/assets/animals/Animals-wild/coyote.webp",
  "/assets/animals/Animals-zoo/lion.webp",
  "/assets/animals/Animals-zoo/elephant.webp",
  "/assets/animals/Animals-zoo/giraffe.webp",
  "/assets/animals/Animals-zoo/penguin.webp",
  "/assets/animals/Animals-zoo/monkey.webp",
  "/assets/animals/Animals-zoo/polar-bear.webp",
  "/assets/animals/Animals-zoo/tiger.webp",
  "/assets/animals/Animals-zoo/panda-bear.webp",
  "/assets/animals/Animals-zoo/zebra.webp",
  "/assets/animals/Animals-zoo/crocodile.webp"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => {
    if (cached) return cached;
    return fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('/index.html'));
  }));
});
