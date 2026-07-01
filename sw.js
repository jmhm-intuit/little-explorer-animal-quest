const CACHE_NAME = 'animal-quest-v3';
const BASE = new URL('./', self.location).pathname;
const CORE_ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "src/app.js",
  BASE + "src/styles.css",
  BASE + "manifest.webmanifest",
  BASE + "data/animals.json",
  BASE + "icons/icon-192.svg",
  BASE + "icons/icon-512.svg",
  BASE + "assets/animals/Animals-pets/dog.webp",
  BASE + "assets/animals/Animals-pets/cat.webp",
  BASE + "assets/animals/Animals-pets/rabbit.webp",
  BASE + "assets/animals/Animals-pets/hamster.webp",
  BASE + "assets/animals/Animals-pets/guinea-pig.webp",
  BASE + "assets/animals/Animals-pets/goldfish.webp",
  BASE + "assets/animals/Animals-pets/turtle.webp",
  BASE + "assets/animals/Animals-pets/parakeet.webp",
  BASE + "assets/animals/Animals-farm/cow.webp",
  BASE + "assets/animals/Animals-farm/horse.webp",
  BASE + "assets/animals/Animals-farm/pig.webp",
  BASE + "assets/animals/Animals-farm/sheep.webp",
  BASE + "assets/animals/Animals-farm/goat.webp",
  BASE + "assets/animals/Animals-farm/chicken.webp",
  BASE + "assets/animals/Animals-farm/duck.webp",
  BASE + "assets/animals/Animals-farm/donkey.webp",
  BASE + "assets/animals/Animals-bugs/ant.webp",
  BASE + "assets/animals/Animals-bugs/bee.webp",
  BASE + "assets/animals/Animals-bugs/butterfly.webp",
  BASE + "assets/animals/Animals-bugs/ladybug.webp",
  BASE + "assets/animals/Animals-bugs/worm.webp",
  BASE + "assets/animals/Animals-bugs/spider.webp",
  BASE + "assets/animals/Animals-bugs/snail.webp",
  BASE + "assets/animals/Animals-bugs/cricket.webp",
  BASE + "assets/animals/Animals-bugs/pill-bug.webp",
  BASE + "assets/animals/Animals-city/squirrel.webp",
  BASE + "assets/animals/Animals-city/pigeon.webp",
  BASE + "assets/animals/Animals-city/hummingbird.webp",
  BASE + "assets/animals/Animals-city/small-lizard.webp",
  BASE + "assets/animals/Animals-city/frog.webp",
  BASE + "assets/animals/Animals-city/wild-rabbit.webp",
  BASE + "assets/animals/Animals-city/crow.webp",
  BASE + "assets/animals/Animals-wild/deer.webp",
  BASE + "assets/animals/Animals-wild/raccoon.webp",
  BASE + "assets/animals/Animals-wild/capybara.webp",
  BASE + "assets/animals/Animals-wild/coyote.webp",
  BASE + "assets/animals/Animals-zoo/lion.webp",
  BASE + "assets/animals/Animals-zoo/elephant.webp",
  BASE + "assets/animals/Animals-zoo/giraffe.webp",
  BASE + "assets/animals/Animals-zoo/penguin.webp",
  BASE + "assets/animals/Animals-zoo/monkey.webp",
  BASE + "assets/animals/Animals-zoo/polar-bear.webp",
  BASE + "assets/animals/Animals-zoo/tiger.webp",
  BASE + "assets/animals/Animals-zoo/panda-bear.webp",
  BASE + "assets/animals/Animals-zoo/zebra.webp",
  BASE + "assets/animals/Animals-zoo/crocodile.webp"
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
    }).catch(() => caches.match(BASE + 'index.html'));
  }));
});
