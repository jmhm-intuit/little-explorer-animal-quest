const APP_VERSION = 'v2.01';
const APP_UPDATED_AT = '2026-07-02';
const DB_NAME = 'little-explorer-animal-quest-db';
const DATA_URL = './data/animals.json';
const STORE_NAME = 'kv';
const STATE_KEY = 'animalQuestState';
const DEFAULT_EXPLORER_IMAGE = './assets/default-explorer.webp';
const DEFAULT_EXPLORER_AVATAR = './assets/default-explorer-avatar.webp';


const CATEGORIES = [
  { id: 'Pets', label: 'Pets', emoji: '🐾', note: 'Animal friends near home.', color: 'pets' },
  { id: 'Farm', label: 'Farm', emoji: '🏡', note: 'Animals from farms and fields.', color: 'farm' },
  { id: 'Bugs', label: 'Bugs', emoji: '🐞', note: 'Tiny explorers and little creatures.', color: 'bugs' },
  { id: 'City', label: 'City', emoji: '🏙️', note: 'Animals in parks, yards, and neighborhoods.', color: 'city' },
  { id: 'Wild', label: 'Wild', emoji: '🌲', note: 'Animals from the wilder world.', color: 'wild' },
  { id: 'Zoo', label: 'Zoo', emoji: '🦁', note: 'Big world animals often seen at zoos.', color: 'zoo' },
  { id: 'Other', label: 'Special', emoji: '✨', note: 'Handmade discoveries.', color: 'other' }
];

const NAV_ASSETS = {
  home: './assets/nav/nav-map.webp',
  discover: './assets/nav/nav-camera.webp',
  journal: './assets/nav/nav-journal.webp',
  explorerClub: './assets/nav/nav-club.webp',
  parent: './assets/nav/nav-parent-lock.webp'
};


const DEFAULT_SETTINGS = {
  cameraEnabled: true,
  manualUnlockEnabled: false,
  soundsEnabled: false
};

const app = document.getElementById('app');
let db = null;
let deferredInstallPrompt = null;
let currentRoute = 'home';
let routeParams = {};
let pendingPhoto = null;
let handmadeImageDraft = null;
let quizDraft = null;
let parentUnlocked = false;
let parentChallenge = null;
let animals = [];
let appState = {
  profile: null,
  discoveries: {},
  customAnimals: [],
  mysteries: [],
  readyReveals: [],
  settings: { ...DEFAULT_SETTINGS }
};

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderRoute();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('Installed on this device.');
  renderRoute();
});

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value = '') {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animal';
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function categoryInfo(category) {
  return CATEGORIES.find(c => c.id === category) || CATEGORIES[CATEGORIES.length - 1];
}

function categoryClass(category) {
  return `theme-${categoryInfo(category).color}`;
}

function categorySlug(category) {
  return categoryInfo(category).color || slugify(category || 'other');
}

function worldIconPath(category) {
  const slug = categorySlug(category);
  if (slug === 'other') return './assets/nav/nav-parent-lock.webp';
  return `./assets/world-icons/icon-world-${slug}.webp`;
}

function worldBgPath(category) {
  const slug = categorySlug(category);
  if (slug === 'other') return './assets/worlds/bg-world-pets.webp';
  return `./assets/worlds/bg-world-${slug}.webp`;
}

function cardBgPath(category) {
  const slug = categorySlug(category);
  if (slug === 'other') return './assets/card-backgrounds/card-bg-pets.webp';
  return `./assets/card-backgrounds/card-bg-${slug}.webp`;
}

function lockedBgPath(category) {
  const slug = categorySlug(category);
  if (slug === 'other') return './assets/locked-backgrounds/locked-bg-pets.webp';
  return `./assets/locked-backgrounds/locked-bg-${slug}.webp`;
}

function cssBg(url) {
  return `background-image:url('${escapeHtml(url)}')`;
}

function firstValue(value, fallback = 'Unknown') {
  const list = asList(value);
  return list[0] || fallback;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function openDb() {
  return new Promise(resolve => {
    if (!('indexedDB' in window)) return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function dbGet(key) {
  if (!db) {
    try { return Promise.resolve(JSON.parse(localStorage.getItem(key) || 'null')); } catch (_) { return Promise.resolve(null); }
  }
  return new Promise(resolve => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ? request.result.value : null);
    request.onerror = () => resolve(null);
  });
}

function dbSet(key, value) {
  if (!db) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

async function loadAnimals() {
  if (window.location.protocol !== 'file:') {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (response.ok) return await response.json();
    } catch (error) {
      console.warn('Could not fetch animals.json. Using embedded animal data if available.', error);
    }
  }
  if (Array.isArray(window.ANIMALS_DATA)) return window.ANIMALS_DATA;
  throw new Error('Animal data could not be loaded. Use the local server or deploy the public folder.');
}

function normalizeLoadedState(raw) {
  const clean = raw && typeof raw === 'object' ? raw : {};
  return {
    profile: clean.profile || null,
    discoveries: clean.discoveries && typeof clean.discoveries === 'object' ? clean.discoveries : {},
    customAnimals: Array.isArray(clean.customAnimals) ? clean.customAnimals : [],
    mysteries: Array.isArray(clean.mysteries) ? clean.mysteries : [],
    readyReveals: Array.isArray(clean.readyReveals) ? clean.readyReveals : [],
    settings: { ...DEFAULT_SETTINGS, ...(clean.settings || {}) }
  };
}

async function saveState() {
  appState.updatedAt = new Date().toISOString();
  appState.appVersion = APP_VERSION;
  await dbSet(STATE_KEY, appState);
}

function allAnimals() {
  return [
    ...animals,
    ...appState.customAnimals.filter(a => a.published)
  ].sort((a, b) => {
    const ai = CATEGORIES.findIndex(c => c.id === a.category);
    const bi = CATEGORIES.findIndex(c => c.id === b.category);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}

function getAnimal(id) {
  return allAnimals().find(a => a.id === id) || appState.customAnimals.find(a => a.id === id) || animals.find(a => a.id === id) || null;
}

function discoveryFor(id) {
  return appState.discoveries[id] || null;
}

function isUnlocked(id) {
  return Boolean(discoveryFor(id));
}

function completion() {
  const total = allAnimals().length;
  const found = allAnimals().filter(a => isUnlocked(a.id)).length;
  return { total, found, pct: total ? Math.round(found / total * 100) : 0 };
}

function categoryCounts() {
  const list = allAnimals();
  return CATEGORIES.filter(c => list.some(a => a.category === c.id)).map(c => {
    const animalsInCategory = list.filter(a => a.category === c.id);
    const found = animalsInCategory.filter(a => isUnlocked(a.id)).length;
    return { ...c, total: animalsInCategory.length, found, animals: animalsInCategory };
  });
}

function firstAnimalsFor(category, count = 3) {
  const list = allAnimals().filter(a => a.category === category);
  const foundFirst = [...list].sort((a, b) => Number(isUnlocked(b.id)) - Number(isUnlocked(a.id)) || a.name.localeCompare(b.name));
  return foundFirst.slice(0, count);
}

function imgMarkup(animal, className = 'animal-img') {
  if (!animal) return '';
  const src = animal.image || animal.imageData || '';
  if (!src) return `<div class="image-placeholder">?</div>`;
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(animal.name)}" loading="lazy">`;
}

function activeNavRoute() {
  if (['picker', 'unlock', 'mysterySubmitted', 'reveal', 'confirmAnimal'].includes(currentRoute)) return 'discover';
  if (currentRoute === 'detail') return 'journal';
  if (['quiz', 'club', 'explorerClub'].includes(currentRoute)) return 'explorerClub';
  return currentRoute;
}

function navButton(route, label, icon) {
  const active = activeNavRoute() === route;
  const asset = NAV_ASSETS[route];
  return `<button type="button" class="nav-btn ${active ? 'active' : ''}" data-route="${route}" aria-label="${escapeHtml(label)}">
    <span class="nav-img">${asset ? `<img src="${asset}" alt="">` : icon}</span><strong>${escapeHtml(label)}</strong>
  </button>`;
}

function shell(content) {
  const c = completion();
  const avatarSrc = appState.profile?.avatar || DEFAULT_EXPLORER_AVATAR;
  const avatar = `<img src="${escapeHtml(avatarSrc)}" alt="Explorer avatar">`;
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <button type="button" class="brand" data-route="home" aria-label="Go home">
          <span class="brand-icon"><img src="./icons/app-icon-192.png" alt=""></span>
          <span><strong>Little Explorer: Animal Quest</strong><small>Discover real animals. Unlock your animal journal.</small></span>
        </button>
        <div class="top-actions">
          <div class="progress-pill"><span>${c.found}/${c.total}</span><small>${c.pct}% found</small></div>
          <button type="button" class="avatar-button" data-route="profile" aria-label="Explorer profile">${avatar}</button>
        </div>
      </header>
      <main class="view">${content}</main>
      <nav class="bottom-nav" aria-label="Main navigation">
        ${navButton('home', 'Home', '🏕️')}
        ${navButton('discover', 'Discover', '📷')}
        ${navButton('journal', 'Journal', '📖')}
        ${navButton('explorerClub', 'Club', '🏅')}
      </nav>
    </div>`;
}

function setRoute(route, params = {}) {
  currentRoute = route;
  routeParams = params;
  if (route !== 'picker') handmadeImageDraft = handmadeImageDraft;
  renderRoute();
}

function renderRoute() {
  switch (currentRoute) {
    case 'home': return renderHome();
    case 'discover': return renderDiscover();
    case 'picker': return renderPicker(routeParams);
    case 'confirmAnimal': return renderConfirmAnimal(routeParams);
    case 'unlock': return renderUnlock(routeParams);
    case 'journal': return renderJournal(routeParams.category || 'All');
    case 'detail': return renderDetail(routeParams.id);
    case 'quiz': return renderExplorerClub();
    case 'club': return renderExplorerClub();
    case 'explorerClub': return renderExplorerClub();
    case 'profile': return renderProfile();
    case 'parent': return renderParentGate();
    case 'parentArea': return renderParentArea(routeParams.tab || 'overview');
    case 'handmade': return renderHandmade(routeParams);
    case 'mysterySubmitted': return renderMysterySubmitted();
    case 'reveal': return renderReveal(routeParams.id);
    default: return renderHome();
  }
}

function progressBar(c = completion()) {
  return `<div class="progress-block">
    <div class="progress-label"><strong>${c.found} / ${c.total} animals discovered</strong><span>${c.pct}%</span></div>
    <div class="progress-track"><i style="width:${c.pct}%"></i></div>
  </div>`;
}

function installBlock() {
  if (isStandalone()) return '';
  return `<section class="install-strip">
    <div><strong>Install Animal Quest</strong><span>Deploy it once, then save it to a phone, tablet, or desktop and use it offline after it loads.</span></div>
    <button type="button" class="btn compact blue" data-action="install">${deferredInstallPrompt ? 'Install App' : 'How to Install'}</button>
  </section>`;
}

function renderHome() {
  const c = completion();
  const latest = Object.values(appState.discoveries).sort((a, b) => String(b.lastDiscoveredAt).localeCompare(String(a.lastDiscoveredAt))).slice(0, 4);
  const ready = appState.readyReveals[0];
  const readyAnimal = ready ? getAnimal(ready.animalId) : null;
  shell(`
    ${ready ? `<section class="reveal-banner"><div><strong>New animal discovery ready!</strong><span>A grown-up studied your mystery animal${readyAnimal ? `: ${escapeHtml(readyAnimal.name)}` : ''}.</span></div><button type="button" class="btn yellow" data-route="reveal" data-id="${ready.id}">Reveal Card</button></section>` : ''}
    <section class="visual-home-hero">
      <div class="hero-map-card">
        <img src="${DEFAULT_EXPLORER_IMAGE}" alt="Little explorers discovering animals">
        <div class="hero-map-overlay">
          <p class="eyebrow">Explorer Base Camp</p>
          <h1>Go outside. Find animals. Unlock your journal.</h1>
          <div class="big-progress-orb"><strong>${c.found}</strong><span>of ${c.total}</span><small>found</small></div>
        </div>
      </div>
      <div class="kid-action-grid">
        <button type="button" class="kid-action discover" data-route="discover"><img src="./assets/nav/nav-camera.webp" alt=""><strong>Discover</strong><span>Take a photo</span></button>
        <button type="button" class="kid-action journal" data-route="journal"><img src="./assets/nav/nav-journal.webp" alt=""><strong>Journal</strong><span>Sticker album</span></button>
        <button type="button" class="kid-action club" data-route="explorerClub"><img src="./assets/nav/nav-club.webp" alt=""><strong>Club</strong><span>Quiz + badges</span></button>
      </div>
    </section>

    ${installBlock()}

    <section class="section-head explorer-map-head"><h2>Explorer map</h2><span>${c.found}/${c.total} found</span></section>
    <div class="category-grid visual-category-grid">
      ${categoryCounts().map(categoryTile).join('')}
    </div>

    <section class="panel recent-panel">
      <div class="section-head compact"><h2>Recent discoveries</h2><button type="button" class="link-btn" data-route="journal">Open journal</button></div>
      ${latest.length ? `<div class="animal-grid small-grid">${latest.map(d => animalCard(getAnimal(d.animalId), { compact: true })).join('')}</div>` : `<div class="empty-state"><strong>No discoveries yet.</strong><p>Start with a pet, bug, bird, or animal nearby.</p><button type="button" class="btn green" data-route="discover">Start discovering</button></div>`}
    </section>

    <section class="panel grownup-home-section grownup-last">
      <img src="./assets/nav/nav-parent-lock.webp" alt="" class="grownup-lock-img">
      <div>
        <p class="eyebrow">Grown-up tools</p>
        <h2>Parent access</h2>
        <p class="helper">Create handmade animals, review mysteries, manage data, and reset discoveries.</p>
      </div>
      <button type="button" class="btn ghost" data-route="parent">Open Parent Area</button>
    </section>

    <footer class="home-release-footer" aria-label="App version">
      <span>Little Explorer: Animal Quest ${APP_VERSION}</span>
      <span>Updated ${APP_UPDATED_AT}</span>
    </footer>
  `);
}

function categoryTile(cat) {
  const pct = cat.total ? Math.round(cat.found / cat.total * 100) : 0;
  const halfTarget = Math.max(1, Math.ceil(cat.total / 2));
  const mapRevealed = cat.found >= halfTarget;
  const preview = allAnimals().filter(a => a.category === cat.id).slice(0, 4);
  return `<button type="button" class="category-tile visual-world-card ${categoryClass(cat.id)} ${mapRevealed ? 'map-revealed' : 'map-mystery'}" data-route="journal" data-category="${cat.id}" style="${cssBg(worldBgPath(cat.id))}">
    <div class="world-glass-top"><img src="${worldIconPath(cat.id)}" alt=""><div><strong>${cat.label}</strong><span>${cat.found}/${cat.total}</span></div></div>
    <div class="map-animal-peek">
      ${preview.map(a => `<span class="map-peek ${isUnlocked(a.id) && mapRevealed ? 'seen' : 'hidden'}">${imgMarkup(a)}</span>`).join('')}
      ${!mapRevealed ? `<b class="map-lock-note">?</b>` : ''}
    </div>
    <div class="mini-progress"><i style="width:${pct}%"></i></div>
    <small>${mapRevealed ? 'Map clues revealed!' : `Find ${halfTarget} to reveal map clues.`}</small>
  </button>`;
}

function earnedBadges() {
  const counts = Object.fromEntries(categoryCounts().map(c => [c.id, c.found]));
  const found = completion().found;
  const repeat = Object.values(appState.discoveries).some(d => d.timesFound >= 3);
  const handmade = appState.customAnimals.some(a => a.published);
  return [
    { name: 'First Discovery', icon: '🌟', earned: found >= 1, hint: 'Find your first animal.' },
    { name: 'Three Finds', icon: '🧭', earned: found >= 3, hint: 'Discover 3 animals.' },
    { name: 'Ten Finds', icon: '🏆', earned: found >= 10, hint: 'Discover 10 animals.' },
    { name: 'Pet Pal', icon: '🏡', earned: (counts.Pets || 0) >= 3, hint: 'Find 3 pets.' },
    { name: 'Farm Friend', icon: '🌿', earned: (counts.Farm || 0) >= 3, hint: 'Find 3 farm animals.' },
    { name: 'Bug Buddy', icon: '🔎', earned: (counts.Bugs || 0) >= 3, hint: 'Find 3 bugs.' },
    { name: 'City Explorer', icon: '🏙️', earned: (counts.City || 0) >= 3, hint: 'Find 3 city animals.' },
    { name: 'Wild Tracker', icon: '🌲', earned: (counts.Wild || 0) >= 2, hint: 'Find 2 wild animals.' },
    { name: 'Zoo Scout', icon: '🧭', earned: (counts.Zoo || 0) >= 3, hint: 'Find 3 zoo animals.' },
    { name: 'Found Again', icon: '🔁', earned: repeat, hint: 'Find the same animal 3 times.' },
    { name: 'Handmade Helper', icon: '🎨', earned: handmade, hint: 'Publish a handmade animal.' }
  ];
}

function renderProfile() {
  const profile = appState.profile || {};
  shell(`
    <section class="panel profile-panel">
      <div>
        <p class="eyebrow">Local explorer card</p>
        <h1>Explorer Profile</h1>
        <p class="helper">This stays only on this device. It can be one child or shared explorers like “Simon and Olivia.”</p>
      </div>
      <form class="form-card" data-submit="profile">
        <div class="avatar-preview"><img src="${escapeHtml(profile.avatar || DEFAULT_EXPLORER_AVATAR)}" alt="Explorer avatar"></div>
        <p class="helper full">The app uses the explorer scene as the default picture. Upload your own photo to personalize the local profile.</p>
        <label>Explorer name<input name="name" required value="${escapeHtml(profile.name || '')}" placeholder="Simon and Olivia"></label>
        <label>Favorite animal<input name="favoriteAnimal" value="${escapeHtml(profile.favoriteAnimal || '')}" placeholder="Rabbit, lion, butterfly..."></label>
        <label>Avatar image<input id="profileAvatarInput" type="file" accept="image/*"></label>
        <div class="actions"><button type="submit" class="btn green">Save Profile</button><button type="button" class="btn ghost" data-route="home">Back Home</button></div>
      </form>
    </section>
  `);
}

function renderDiscover() {
  shell(`
    <section class="discover-stage">
      <div class="discover-visual-card">
        <div class="discover-icon-orb"><img src="./assets/nav/nav-camera.webp" alt="Camera"></div>
        <div>
          <p class="eyebrow">Discover animal</p>
          <h1>Take a photo of what you found.</h1>
          <p class="helper">One small local photo is saved for the card. Then choose the animal with big visual buttons.</p>
        </div>
      </div>
      <div class="camera-card visual-camera-card">
        <label class="photo-drop visual-photo-drop">
          <input id="discoverPhotoInput" type="file" accept="image/*" capture="environment">
          ${pendingPhoto ? `<img src="${pendingPhoto}" alt="Selected discovery photo">` : `<span class="camera-icon"><img src="./assets/nav/nav-camera.webp" alt=""></span><strong>Tap to take or choose photo</strong><small>Phone camera or photo library</small>`}
        </label>
        <div class="actions center">
          <button type="button" class="btn green big-visual-btn" data-action="chooseAnimal" ${pendingPhoto ? '' : 'disabled'}>Choose Animal</button>
          <button type="button" class="btn yellow big-visual-btn" data-action="mystery" ${pendingPhoto ? '' : 'disabled'}>Mystery Animal</button>
          ${pendingPhoto ? '<button type="button" class="btn ghost" data-action="clearPhoto">Retake / Choose Again</button>' : ''}
        </div>
      </div>
    </section>
  `);
}

function renderPicker(params = {}) {
  const mode = params.mode || 'discover';
  const selectedCategory = params.category || 'All';
  const initialSearch = params.search || '';
  const sourceMystery = mode === 'linkMystery' ? appState.mysteries.find(m => m.id === params.mysteryId) : null;
  const list = allAnimals();
  shell(`
    <section class="panel visual-picker-panel">
      <div class="section-head"><div><p class="eyebrow">Animal picker</p><h1>${mode === 'linkMystery' ? 'Link mystery to an animal' : 'What did you find?'}</h1></div><button type="button" class="btn ghost" data-route="${mode === 'linkMystery' ? 'parentArea' : 'discover'}" data-tab="mysteries">Back</button></div>
      ${sourceMystery ? `<div class="mystery-preview"><img src="${sourceMystery.photo}" alt="Mystery photo"><div><strong>Mystery photo</strong><p class="helper">Pick an existing animal to unlock later for the child.</p></div></div>` : ''}
      <div class="visual-search-bar"><span>🔎</span><input id="animalSearch" class="search-input" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Search animal..." value="${escapeHtml(initialSearch)}"></div>
      <div class="visual-filter-row" aria-label="Animal category filters">
        <button type="button" class="picker-filter ${selectedCategory === 'All' ? 'active' : ''}" data-picker-category="All"><img src="./assets/nav/nav-map.webp" alt=""><strong>All</strong></button>
        ${categoryCounts().map(c => `<button type="button" class="picker-filter ${selectedCategory === c.id ? 'active' : ''}" data-picker-category="${c.id}"><img src="${worldIconPath(c.id)}" alt=""><strong>${c.label}</strong></button>`).join('')}
      </div>
      <p id="pickerHint" class="picker-hint">Type freely or tap a picture filter. Tap an animal, then confirm before unlocking.</p>
      <div class="animal-grid picker-grid visual-picker-grid">${list.map(animal => animalCard(animal, { action: 'selectAnimal', compact: true })).join('')}</div>
      <div id="pickerNoResults" class="empty-state picker-empty" hidden><strong>No matching animals.</strong><p>Try another word or choose Mystery Animal.</p></div>
      ${mode === 'discover' ? '<div class="actions center"><button type="button" class="btn yellow" data-action="mystery">I can’t find it</button></div>' : ''}
    </section>
  `);
  attachPickerFilters();
}

function attachPickerFilters() {
  const searchInput = document.getElementById('animalSearch');
  const filterButtons = [...document.querySelectorAll('.picker-filter')];
  const noResults = document.getElementById('pickerNoResults');
  const cards = [...document.querySelectorAll('.picker-grid .animal-card')];
  const activeCategory = () => document.querySelector('.picker-filter.active')?.dataset.pickerCategory || 'All';
  const update = () => {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const cat = activeCategory();
    let visible = 0;
    cards.forEach(card => {
      const matchesCategory = cat === 'All' || card.dataset.category === cat;
      const haystack = card.dataset.search || '';
      const animalName = card.dataset.name || '';
      const matchesSearch = !q || animalName.startsWith(q) || haystack.includes(q);
      const show = matchesCategory && matchesSearch;
      card.hidden = !show;
      card.classList.toggle('is-hidden', !show);
      if (show) visible += 1;
    });
    if (noResults) noResults.hidden = visible > 0;
    const hint = document.getElementById('pickerHint');
    if (hint) hint.textContent = visible ? `${visible} animal${visible === 1 ? '' : 's'} match. Tap one to confirm.` : 'No animals match yet. Try another word or choose Mystery Animal.';
  };
  filterButtons.forEach(btn => btn.addEventListener('click', () => {
    filterButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    update();
  }));
  searchInput?.addEventListener('input', update);
  searchInput?.addEventListener('keyup', update);
  update();
}

function categoryMysteryIcon(category) {
  const icons = { Pets: '🐾', Farm: '🌿', Bugs: '🔎', City: '🏙️', Wild: '🌲', Zoo: '🧭', Other: '✨' };
  return icons[category] || '?';
}

function animalCard(animal, options = {}) {
  if (!animal) return '';
  const unlocked = isUnlocked(animal.id);
  const discovery = discoveryFor(animal.id);
  const action = options.action || 'detail';
  const compact = options.compact ? 'compact' : '';
  const album = options.album ? 'album-card' : '';
  const revealLockedImage = Boolean(options.revealLockedImage) || action === 'selectAnimal' || action === 'quizSelect';
  const cardState = unlocked ? 'unlocked' : (revealLockedImage ? 'locked picker-visible' : 'locked mystery-locked');
  const metaLine = (unlocked || revealLockedImage) ? `${escapeHtml(animal.category)} • ${escapeHtml(animal.size || 'Unknown')}` : '';
  const stateLine = unlocked ? `Found ${discovery.timesFound || 1}x` : (revealLockedImage ? 'Tap to choose' : 'Find me');
  const searchable = [animal.name, animal.category, animal.size, animal.animalClass, animal.familyGroup, animal.explorerSkill, ...asList(animal.eats), ...asList(animal.livesIn)].join(' ').toLowerCase();
  const nameSearch = String(animal.name || '').toLowerCase();
  const artBg = unlocked || revealLockedImage ? cardBgPath(animal.category) : lockedBgPath(animal.category);
  return `<button type="button" class="animal-card ${categoryClass(animal.category)} ${cardState} ${compact} ${album}" data-action="${action}" data-id="${animal.id}" data-category="${escapeHtml(animal.category)}" data-name="${escapeHtml(nameSearch)}" data-search="${escapeHtml(searchable)}">
    <div class="card-art" style="${cssBg(artBg)}">${imgMarkup(animal)}<span class="lock-mark">?</span></div>
    <div class="card-meta">
      <strong>${escapeHtml(animal.name)}</strong>
      ${metaLine ? `<span>${metaLine}</span>` : ''}
      <em>${stateLine}</em>
    </div>
  </button>`;
}

function renderJournal(category = 'All') {
  const c = completion();
  const cats = categoryCounts();
  const filtered = allAnimals().filter(animal => category === 'All' || animal.category === category);
  const title = category === 'All' ? 'Animal Journal' : `${categoryInfo(category).label} Album`;
  shell(`
    <section class="journal-hero panel sticker-hero visual-journal-hero">
      <div><p class="eyebrow">Sticker album</p><h1>${escapeHtml(title)}</h1><p class="helper">Open a world. Color stickers are found. Grey animal shapes are waiting to be revealed.</p></div>
      ${progressBar(c)}
    </section>
    <div class="journal-categories visual-world-tabs">
      <button type="button" class="journal-cat visual-world-tab ${category === 'All' ? 'active' : ''}" data-route="journal" data-category="All"><img src="./assets/nav/nav-journal.webp" alt=""><strong>All</strong><em>${c.found}/${c.total}</em></button>
      ${cats.map(cat => `<button type="button" class="journal-cat visual-world-tab ${category === cat.id ? 'active' : ''} ${categoryClass(cat.id)}" data-route="journal" data-category="${cat.id}">
        <img src="${worldIconPath(cat.id)}" alt=""><strong>${cat.label}</strong><em>${cat.found}/${cat.total}</em>
      </button>`).join('')}
    </div>
    <section class="panel album-panel panini-panel">
      <div class="section-head compact"><h2>${escapeHtml(title)}</h2><span>${filtered.filter(a => isUnlocked(a.id)).length}/${filtered.length}</span></div>
      <div class="animal-grid album-grid panini-grid">${filtered.map(animal => animalCard(animal, { album: true })).join('')}</div>
    </section>
  `);
}

function iconForValue(kind, value) {
  const v = String(value || '').toLowerCase();
  if (kind === 'size') {
    if (v.includes('tiny')) return '🔍';
    if (v.includes('small')) return '🐾';
    if (v.includes('medium')) return '🧭';
    if (v.includes('large')) return '🌟';
    if (v.includes('huge')) return '🗿';
    return '📏';
  }
  if (kind === 'skill') {
    if (v.includes('sky') || v.includes('air') || v.includes('flight')) return '🪽';
    if (v.includes('water')) return '💧';
    if (v.includes('tree') || v.includes('climb')) return '🌳';
    if (v.includes('soil') || v.includes('dig')) return '🪱';
    if (v.includes('jump')) return '↗️';
    return '👣';
  }
  if (kind === 'eats') {
    if (/nectar|flower/.test(v)) return '🌸';
    if (/seed|nut|acorn|grain/.test(v)) return '🌰';
    if (/grass|plant|leaf|leaves|hay|fruit/.test(v)) return '🌿';
    if (/insect|bug/.test(v)) return '🐞';
    if (/fish/.test(v)) return '🐟';
    if (/meat|animal/.test(v)) return '🍖';
    return '🥣';
  }
  if (kind === 'lives') {
    if (/home|house/.test(v)) return '🏠';
    if (/farm|field|barn/.test(v)) return '🌾';
    if (/city|park|yard|neighborhood/.test(v)) return '🏙️';
    if (/forest|wild|woods|jungle/.test(v)) return '🌲';
    if (/water|pond|river|ocean|aquarium/.test(v)) return '💧';
    if (/zoo/.test(v)) return '🧭';
    return '📍';
  }
  if (kind === 'class') {
    if (/mammal|canine|feline|rodent|bovine|equine|primate|bear/.test(v)) return '🐾';
    if (/bird/.test(v)) return '🪶';
    if (/reptile|crocodile|lizard|turtle/.test(v)) return '🦎';
    if (/fish/.test(v)) return '🐟';
    if (/insect/.test(v)) return '🐞';
    if (/amphibian/.test(v)) return '🐸';
    if (/arachnid|spider/.test(v)) return '🕷️';
    if (/mollusk|snail/.test(v)) return '🐚';
    return '🔬';
  }
  return '✨';
}

function attributeBadge(label, value, kind) {
  const clean = Array.isArray(value) ? value.join(', ') : String(value || 'Unknown');
  return `<div class="attribute-badge ${kind}"><span class="attribute-icon">${iconForValue(kind, clean)}</span><small>${escapeHtml(label)}</small><strong>${escapeHtml(clean)}</strong></div>`;
}

function imageAttributeBadge(label, value, kind, imagePath = '') {
  const clean = Array.isArray(value) ? value.join(', ') : String(value || 'Unknown');
  const media = imagePath ? `<img src="${escapeHtml(imagePath)}" alt="">` : `<span>${iconForValue(kind, clean)}</span>`;
  return `<div class="image-attribute-badge ${kind}">${media}<small>${escapeHtml(label)}</small><strong>${escapeHtml(clean)}</strong></div>`;
}

function visualBadgeWall(animal) {
  const food = firstValue(animal.eats);
  const home = firstValue(animal.livesIn);
  return `<div class="visual-badge-wall">
    ${imageAttributeBadge('World', animal.category || 'Animal', 'lives', worldIconPath(animal.category))}
    ${imageAttributeBadge('Kind', animal.animalClass || 'Animal', 'class')}
    ${imageAttributeBadge('Eats', food, 'eats')}
    ${imageAttributeBadge('Home', home, 'lives')}
    ${imageAttributeBadge('Skill', animal.explorerSkill || 'Explorer', 'skill')}
    ${imageAttributeBadge('Size', animal.size || 'Unknown', 'size')}
  </div>`;
}

function lockedBadgeWall() {
  return `<div class="visual-badge-wall locked-badges">
    ${['World','Kind','Eats','Home','Skill','Size'].map(label => `<div class="image-attribute-badge mystery"><span>?</span><small>${label}</small><strong>Unlock</strong></div>`).join('')}
  </div>`;
}

function visualFactGrid(animal) {
  return `<div class="attribute-grid">
    ${attributeBadge('Size', animal.size || 'Unknown', 'size')}
    ${attributeBadge('Explorer Skill', animal.explorerSkill || 'Explorer', 'skill')}
    ${attributeBadge('Eats', asList(animal.eats).join(', ') || 'Unknown', 'eats')}
    ${attributeBadge('Lives In', asList(animal.livesIn).join(', ') || 'Unknown', 'lives')}
    ${attributeBadge('Animal Type', animal.animalClass || 'Animal', 'class')}
    ${attributeBadge('Family', animal.familyGroup || animal.animalClass || 'Animal', 'class')}
  </div>`;
}

function lockedFactGrid() {
  return `<div class="attribute-grid locked-attributes">
    ${['Size', 'Explorer Skill', 'Eats', 'Lives In', 'Animal Type', 'Family'].map(label => `<div class="attribute-badge mystery"><span class="attribute-icon">?</span><small>${label}</small><strong>Unlock to learn</strong></div>`).join('')}
  </div>`;
}

function renderDetail(id) {
  const animal = getAnimal(id);
  if (!animal) return setRoute('journal');
  const unlocked = isUnlocked(animal.id);
  const discovery = discoveryFor(animal.id);
  const latestPhoto = unlocked && discovery?.latestPhoto ? discovery.latestPhoto : null;
  const sceneBg = unlocked ? cardBgPath(animal.category) : lockedBgPath(animal.category);
  shell(`
    <section class="storybook-detail-wrap visual-detail-wrap">
      <article class="storybook-animal-card visual-animal-card ${categoryClass(animal.category)} ${unlocked ? 'unlocked' : 'locked-detail'}">
        <div class="storybook-topbar visual-card-topbar">
          <button type="button" class="round-back" data-route="journal" data-category="${animal.category}" aria-label="Back to journal">←</button>
          <h1>${escapeHtml(animal.name)}</h1>
          <span class="heart-stamp">${unlocked ? '★' : '?'}</span>
        </div>
        <div class="storybook-scene visual-card-scene ${unlocked ? '' : 'scene-mystery'}" style="${cssBg(sceneBg)}">
          ${imgMarkup(animal, unlocked ? 'storybook-animal-img' : 'storybook-animal-img locked-detail-shape')}
          ${unlocked ? '<span class="discovered-stamp">Discovered!</span>' : '<span class="locked-question">?</span>'}
        </div>
        ${unlocked ? visualBadgeWall(animal) : lockedBadgeWall()}
        <div class="story-bottom-grid visual-story-grid">
          <div class="fun-fact-card"><span>💡</span><div><strong>Fun Fact</strong><p>${unlocked ? escapeHtml(animal.funFact || 'A new animal friend for your journal.') : 'Discover this animal to unlock the fact.'}</p></div></div>
          <div class="my-photo-card"><strong>My Photo</strong>${latestPhoto ? `<img src="${latestPhoto}" alt="Latest discovery photo">` : '<div class="photo-placeholder">📷</div>'}</div>
        </div>
        ${unlocked ? `<p class="found-note">Found ${discovery.timesFound || 1} time${(discovery.timesFound || 1) === 1 ? '' : 's'} • Last found ${formatDate(discovery.lastDiscoveredAt)}</p>` : '<p class="found-note">Find this animal in the real world to reveal the card.</p>'}
        <div class="actions center"><button type="button" class="btn green" data-route="discover">${unlocked ? 'Find Again' : 'Discover This Animal'}</button>${unlocked ? `<button type="button" class="btn danger" data-action="deleteDiscovery" data-id="${animal.id}">Delete Discovery</button>` : ''}</div>
      </article>
    </section>
  `);
}

function learningRows(animal) {
  return `<div class="learning-rows">
    ${learningRow('🏠', 'Lives', asList(animal.livesIn).join(', ') || 'Unknown')}
    ${learningRow('🥣', 'Eats', asList(animal.eats).join(', ') || 'Unknown')}
    ${learningRow('🧭', 'Explorer Skill', animal.explorerSkill || 'Explorer')}
    ${learningRow('🐾', 'Category', animal.category || 'Animal')}
  </div>`;
}

function lockedLearningRows() {
  return `<div class="learning-rows locked-learning">
    ${learningRow('?', 'Lives', 'Unlock to learn')}
    ${learningRow('?', 'Eats', 'Unlock to learn')}
    ${learningRow('?', 'Explorer Skill', 'Unlock to learn')}
    ${learningRow('?', 'Category', 'Unlock to learn')}
  </div>`;
}

function learningRow(icon, label, value) {
  return `<div class="learning-row"><span>${escapeHtml(icon)}</span><strong>${escapeHtml(label)}</strong><em>${escapeHtml(value)}</em></div>`;
}

function formatDate(value) {
  if (!value) return 'Today';
  try { return new Date(value).toLocaleDateString(); } catch (_) { return String(value); }
}

async function unlockAnimal(animalId, photo = pendingPhoto, source = 'photo') {
  const animal = getAnimal(animalId);
  if (!animal) return;
  const now = new Date().toISOString();
  const existing = appState.discoveries[animalId];
  appState.discoveries[animalId] = {
    animalId,
    timesFound: existing ? (existing.timesFound || 1) + 1 : 1,
    firstDiscoveredAt: existing?.firstDiscoveredAt || now,
    lastDiscoveredAt: now,
    latestPhoto: photo || existing?.latestPhoto || null,
    source
  };
  pendingPhoto = null;
  await saveState();
  setRoute('unlock', { id: animalId, already: Boolean(existing) });
}

function renderConfirmAnimal(params = {}) {
  const animal = getAnimal(params.selectedId || params.animalId || params.id);
  if (!animal) return setRoute('picker', params);
  const mode = params.mode || 'discover';
  const sourceMystery = mode === 'linkMystery' ? appState.mysteries.find(m => m.id === params.mysteryId) : null;
  const photo = sourceMystery?.photo || pendingPhoto;
  const backParams = { mode, category: params.category || 'All', search: params.search || '', mysteryId: params.mysteryId };
  shell(`
    <section class="confirm-card ${categoryClass(animal.category)}">
      <button type="button" class="back-btn" data-route="picker" data-mode="${escapeHtml(mode)}" data-category="${escapeHtml(backParams.category)}" data-search="${escapeHtml(backParams.search)}" data-mystery-id="${escapeHtml(params.mysteryId || '')}">← Back to choices</button>
      <div class="confirm-layout">
        <div class="confirm-photo">${photo ? `<img src="${photo}" alt="Discovery photo">` : '<span>Manual discovery</span>'}</div>
        <div class="confirm-animal">
          <p class="eyebrow">Confirm discovery</p>
          <h1>Is this a ${escapeHtml(animal.name)}?</h1>
          <div class="confirm-art">${imgMarkup(animal)}</div>
          <p class="helper">Confirm before unlocking so accidental taps do not change the journal.</p>
          <div class="actions center">
            <button type="button" class="btn green" data-action="confirmSelectedAnimal" data-id="${animal.id}">${mode === 'linkMystery' ? 'Yes, link mystery' : 'Yes, unlock card'}</button>
            <button type="button" class="btn ghost" data-route="picker" data-mode="${escapeHtml(mode)}" data-category="${escapeHtml(backParams.category)}" data-search="${escapeHtml(backParams.search)}" data-mystery-id="${escapeHtml(params.mysteryId || '')}">Choose another</button>
          </div>
        </div>
      </div>
    </section>
  `);
}

function renderUnlock(params) {
  const animal = getAnimal(params.id);
  if (!animal) return setRoute('journal');
  shell(`
    <section class="unlock-card ${categoryClass(animal.category)}">
      <div class="sparkles">✦ ✨ ✦</div>
      <p class="eyebrow">${params.already ? 'Found again' : 'New card unlocked'}</p>
      <h1>${params.already ? `You found ${escapeHtml(animal.name)} again!` : `You discovered ${escapeHtml(animal.name)}!`}</h1>
      <div class="unlock-art">${imgMarkup(animal)}</div>
      <p class="helper">${escapeHtml(animal.funFact || 'A new animal friend joined your journal.')}</p>
      <div class="actions center"><button type="button" class="btn green" data-route="detail" data-id="${animal.id}">Open Card</button><button type="button" class="btn yellow" data-route="journal">Go to Journal</button></div>
    </section>
  `);
}

async function saveMystery() {
  if (!pendingPhoto) return toast('Take or choose a photo first.');
  const mystery = { id: uid('mystery'), photo: pendingPhoto, createdAt: new Date().toISOString(), status: 'pending' };
  appState.mysteries.unshift(mystery);
  pendingPhoto = null;
  await saveState();
  setRoute('mysterySubmitted');
}

function renderMysterySubmitted() {
  shell(`
    <section class="unlock-card mystery-card">
      <div class="sparkles">🔎 ✨ 🧭</div>
      <p class="eyebrow">Mystery discovery</p>
      <h1>This animal is not in the journal yet.</h1>
      <p class="helper">A grown-up can study the discovery, link it to an existing animal, or create a handmade card.</p>
      <div class="actions center"><button type="button" class="btn green" data-route="home">Back Home</button><button type="button" class="btn ghost" data-route="parent">Grown-up Review</button></div>
    </section>
  `);
}

function renderExplorerClub() {
  const badges = earnedBadges();
  const discovered = allAnimals().filter(a => isUnlocked(a.id));
  const tab = routeParams.tab || 'quiz';

  if (discovered.length < 3) {
    shell(`
      <section class="panel club-hero compact-club-hero">
        <p class="eyebrow">Explorer Club</p>
        <h1>Badges and quiz</h1>
        <p class="helper">Discover 3 animals to unlock quiz play. Badges reveal as you explore.</p>
        <div class="club-switch">
          <button type="button" class="tab active" data-route="explorerClub" data-tab="badges">🏅 Badges</button>
          <button type="button" class="tab" data-route="discover">📷 Discover Animals</button>
        </div>
      </section>
      <section class="panel"><div class="badge-album">${badges.map(badgeCard).join('')}</div></section>
    `);
    return;
  }

  if (tab === 'badges') {
    shell(`
      <section class="panel club-hero compact-club-hero">
        <p class="eyebrow">Explorer Club</p>
        <h1>Explorer badges</h1>
        <p class="helper">Earn medals by discovering animals, finding categories, and adding handmade discoveries.</p>
        <div class="club-switch">
          <button type="button" class="tab" data-route="explorerClub" data-tab="quiz">🧠 Quiz</button>
          <button type="button" class="tab active" data-route="explorerClub" data-tab="badges">🏅 Badges</button>
        </div>
      </section>
      <section class="panel"><div class="badge-album">${badges.map(badgeCard).join('')}</div></section>
    `);
    return;
  }

  quizDraft = quizDraft && quizDraft.options.every(id => discovered.some(a => a.id === id)) ? quizDraft : createQuiz(discovered);
  const options = quizDraft.options.map(id => getAnimal(id)).filter(Boolean);
  shell(`
    <section class="panel club-hero compact-club-hero">
      <p class="eyebrow">Explorer Club</p>
      <h1>Animal quiz</h1>
      <p class="helper">Tap every card that matches. Questions use only animals already discovered.</p>
      <div class="club-switch">
        <button type="button" class="tab active" data-route="explorerClub" data-tab="quiz">🧠 Quiz</button>
        <button type="button" class="tab" data-route="explorerClub" data-tab="badges">🏅 Badges</button>
      </div>
    </section>
    <section class="panel quiz-panel quiz-fit-panel">
      <div class="quiz-question-card visual-quiz-question">
        <span class="quiz-icon">${quizDraft.icon || '🔎'}</span>
        <div><p class="eyebrow">Explorer quiz</p><h2>${escapeHtml(quizDraft.question)}</h2></div>
      </div>
      <div class="quiz-instructions">Choose all that match. Everything should fit on the screen without hunting around.</div>
      <div class="animal-grid quiz-grid quiz-fit-grid">${options.map(animal => animalCard(animal, { action: 'quizSelect', compact: true })).join('')}</div>
      <div id="quizFeedback" class="quiz-feedback strong"></div>
      <div class="actions center quiz-actions"><button type="button" class="btn green" data-action="checkQuiz">Check Answer</button><button type="button" class="btn ghost" data-action="newQuiz">New Quiz</button></div>
    </section>
  `);
  quizDraft.selected.forEach(id => document.querySelector(`[data-action="quizSelect"][data-id="${CSS.escape(id)}"]`)?.classList.add('selected'));
}

function badgeCard(badge) {
  return `<div class="badge-card ${badge.earned ? 'earned' : 'locked'}"><div class="badge-medal"><span>${badge.earned ? badge.icon : '?'}</span></div><strong>${escapeHtml(badge.name)}</strong><span>${badge.earned ? 'Earned!' : 'Keep exploring'}</span></div>`;
}

function createQuiz(discovered) {
  const types = [];
  const categories = [...new Set(discovered.map(a => a.category))]
    .filter(cat => discovered.some(a => a.category === cat) && discovered.some(a => a.category !== cat));
  categories.forEach(cat => types.push({ question: `Find the ${cat} animals`, icon: `<img src="${worldIconPath(cat)}" alt="">`, match: a => a.category === cat }));

  const classes = [...new Set(discovered.map(a => a.animalClass).filter(Boolean))]
    .filter(cls => discovered.some(a => a.animalClass === cls) && discovered.some(a => a.animalClass !== cls));
  classes.forEach(cls => types.push({ question: `Find the ${cls}s`, icon: iconForValue('class', cls), match: a => a.animalClass === cls }));

  const familyGroups = [...new Set(discovered.map(a => a.familyGroup).filter(Boolean))]
    .filter(family => discovered.some(a => a.familyGroup === family) && discovered.some(a => a.familyGroup !== family));
  familyGroups.slice(0, 5).forEach(family => types.push({ question: `Find the ${family} family`, icon: iconForValue('class', family), match: a => a.familyGroup === family }));

  const plantRegex = /plant|grass|leaf|leaves|nectar|seed|fruit|hay|grain|vegetable|bamboo/i;
  const eatsPlants = discovered.some(a => asList(a.eats).some(e => plantRegex.test(e))) && discovered.some(a => !asList(a.eats).some(e => plantRegex.test(e)));
  if (eatsPlants) types.push({ question: 'Find animals that eat plants', icon: iconForValue('eats', 'plants'), match: a => asList(a.eats).some(e => plantRegex.test(e)) });

  const waterAnimals = discovered.some(a => /water|pond|river|aquarium|ocean|fish bowl/i.test(asList(a.livesIn).join(' ') + ' ' + (a.explorerSkill || ''))) && discovered.some(a => !/water|pond|river|aquarium|ocean|fish bowl/i.test(asList(a.livesIn).join(' ') + ' ' + (a.explorerSkill || '')));
  if (waterAnimals) types.push({ question: 'Find water explorers', icon: iconForValue('skill', 'water'), match: a => /water|pond|river|aquarium|ocean|fish bowl/i.test(asList(a.livesIn).join(' ') + ' ' + (a.explorerSkill || '')) });

  const target = types[Math.floor(Math.random() * types.length)] || { question: 'Find discovered animals', icon: '🔎', match: () => true };
  const matches = shuffle(discovered.filter(target.match));
  const nonMatches = shuffle(discovered.filter(a => !target.match(a)));
  const answerCount = Math.min(3, Math.max(1, matches.length));
  const chosenAnswers = matches.slice(0, answerCount);
  const chosenOthers = nonMatches.slice(0, Math.max(0, 6 - chosenAnswers.length));
  let chosen = shuffle([...chosenAnswers, ...chosenOthers]);
  if (chosen.length < Math.min(6, discovered.length)) {
    const used = new Set(chosen.map(a => a.id));
    chosen = [...chosen, ...shuffle(discovered.filter(a => !used.has(a.id))).slice(0, Math.min(6, discovered.length) - chosen.length)];
  }
  chosen = chosen.slice(0, Math.min(6, discovered.length));
  return { question: target.question, icon: target.icon, answers: chosen.filter(target.match).map(a => a.id), options: chosen.map(a => a.id), selected: [], checked: false };
}

function shuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

function renderParentGate() {
  if (parentUnlocked) return renderParentArea(routeParams.tab || 'overview');
  const a = Math.floor(Math.random() * 7) + 8;
  const b = Math.floor(Math.random() * 7) + 6;
  parentChallenge = { a, b, answer: a + b };
  shell(`
    <section class="panel gate-panel">
      <p class="eyebrow">Grown-up area</p>
      <h1>Grown-up check</h1>
      <p class="helper">Solve this to manage animal data, handmade cards, reset options, and exports.</p>
      <form class="form-card narrow" data-submit="parentGate">
        <label>What is ${a} + ${b}?<input name="answer" inputmode="numeric" autocomplete="off" required></label>
        <button type="submit" class="btn green">Enter Parent Area</button>
      </form>
    </section>
  `);
}

function renderParentArea(tab = 'overview') {
  const pending = appState.mysteries.filter(m => m.status === 'pending');
  const c = completion();
  shell(`
    <section class="panel">
      <div class="section-head"><div><p class="eyebrow">Parent area</p><h1>Manage the local animal journal</h1></div><span class="version-pill">${APP_VERSION}</span></div>
      <div class="tabs">
        ${['overview','mysteries','handmade','settings','data'].map(t => `<button type="button" class="tab ${tab === t ? 'active' : ''}" data-route="parentArea" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      ${tab === 'overview' ? `<div class="dashboard-grid">
        <div class="dash-card"><strong>${c.found}/${c.total}</strong><span>Journal progress</span></div>
        <div class="dash-card"><strong>${pending.length}</strong><span>Pending mysteries</span></div>
        <div class="dash-card"><strong>${appState.customAnimals.length}</strong><span>Handmade animals</span></div>
        <div class="dash-card"><strong>${Object.keys(appState.discoveries).length}</strong><span>Discovered cards</span></div>
      </div>
      <div class="actions"><button type="button" class="btn yellow" data-route="parentArea" data-tab="mysteries">Review Mysteries</button><button type="button" class="btn purple" data-route="handmade">Create Handmade Animal</button><button type="button" class="btn ghost" data-action="manualUnlock">Manual Unlock</button></div>` : ''}
      ${tab === 'mysteries' ? mysteryListMarkup() : ''}
      ${tab === 'handmade' ? handmadeListMarkup() : ''}
      ${tab === 'settings' ? settingsMarkup() : ''}
      ${tab === 'data' ? dataCheckMarkup() : ''}
    </section>
  `);
}

function mysteryListMarkup() {
  const mysteries = appState.mysteries;
  if (!mysteries.length) return `<div class="empty-state"><strong>No mystery discoveries yet.</strong><p>When a child finds an animal not in the list, it appears here.</p></div>`;
  return `<div class="list">${mysteries.map(m => `<article class="mystery-row"><img src="${m.photo}" alt="Mystery photo"><div><strong>Mystery discovery</strong><p class="helper">${formatDate(m.createdAt)} • ${m.status}</p><div class="actions"><button type="button" class="btn green" data-action="linkMystery" data-id="${m.id}">Link to Existing</button><button type="button" class="btn purple" data-route="handmade" data-mystery="${m.id}">Create Handmade</button><button type="button" class="btn danger" data-action="deleteMystery" data-id="${m.id}">Delete</button></div></div></article>`).join('')}</div>`;
}

function handmadeListMarkup() {
  const custom = appState.customAnimals;
  return `<div class="actions"><button type="button" class="btn purple" data-route="handmade">Create Handmade Animal</button></div>${custom.length ? `<div class="animal-grid small-grid">${custom.map(a => animalCard(a, { compact: true })).join('')}</div>` : `<div class="empty-state"><strong>No handmade animals yet.</strong><p>Parents can create a custom card when the official list does not include the animal.</p></div>`}`;
}

function settingsMarkup() {
  return `<div class="settings-list">
    <div class="setting-row"><div><strong>Install App</strong><p>Add this deployed PWA to a device.</p></div><button type="button" class="btn blue" data-action="install">${isStandalone() ? 'Installed' : 'Install / Instructions'}</button></div>
    <div class="setting-row"><div><strong>Export metadata</strong><p>Exports profile, discoveries, handmade animal records, and settings as JSON. Photos are excluded from export.</p></div><button type="button" class="btn green" data-action="export">Export JSON</button></div>
    <div class="setting-row"><div><strong>Delete saved app photos</strong><p>Removes low-resolution discovery and mystery photos stored by this app.</p></div><button type="button" class="btn danger" data-action="deletePhotos">Delete Photos</button></div>
    <div class="setting-row"><div><strong>Reset discoveries</strong><p>Keeps animal data and handmade animals but locks all cards again.</p></div><button type="button" class="btn danger" data-action="resetDiscoveries">Reset</button></div>
  </div>`;
}

function dataCheckMarkup() {
  const cats = categoryCounts();
  return `<div class="dashboard-grid">${cats.map(c => `<div class="dash-card"><strong>${c.total}</strong><span>${c.label} animals</span></div>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Animal</th><th>Category</th><th>Image</th><th>Status</th></tr></thead><tbody>${allAnimals().map(a => `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.category)}</td><td>${escapeHtml(a.image || 'custom image')}</td><td>${isUnlocked(a.id) ? 'Unlocked' : 'Locked'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderHandmade(params = {}) {
  const sourceMystery = params.mystery ? appState.mysteries.find(m => m.id === params.mystery) : null;
  shell(`
    <section class="panel handmade-panel">
      <div class="section-head"><div><p class="eyebrow">Handmade animal</p><h1>Create a new animal card</h1><p class="helper">The card is published only when required details and a cartoon image are ready.</p></div><button type="button" class="btn ghost" data-route="parentArea" data-tab="handmade">Cancel</button></div>
      ${sourceMystery ? `<div class="mystery-preview"><img src="${sourceMystery.photo}" alt="Mystery photo"><div><strong>Creating from mystery</strong><p class="helper">The child will see a reveal when this card is ready.</p></div></div>` : ''}
      <form class="form-card" data-submit="handmade" data-mystery="${params.mystery || ''}">
        <label>Name<input name="name" required placeholder="Example: Blue Backyard Bird"></label>
        <label>Category<select name="category" required>${CATEGORIES.filter(c => c.id !== 'Other').map(c => `<option value="${c.id}">${c.label}</option>`).join('')}<option value="Other">Special</option></select></label>
        <label>Animal type<input name="animalClass" required placeholder="Bird, Mammal, Reptile..."></label>
        <label>Family group<input name="familyGroup" placeholder="Feline, Canine, Rodent..."></label>
        <label>Size<select name="size" required><option>Tiny</option><option>Small</option><option>Medium</option><option>Large</option><option>Huge</option></select></label>
        <label>Explorer skill<input name="explorerSkill" required placeholder="Sky Explorer, Ground Explorer..."></label>
        <label>Eats<input name="eats" required placeholder="Seeds, insects, berries"></label>
        <label>Lives in<input name="livesIn" required placeholder="Trees, gardens, ponds"></label>
        <label class="full">Fun fact<textarea name="funFact" placeholder="They love to sing in the morning!"></textarea></label>
        <label class="full">Cartoon image<input id="handmadeImageInput" type="file" accept="image/*" required></label>
        <div id="handmadePreview" class="handmade-preview">${handmadeImageDraft ? `<img src="${handmadeImageDraft}" alt="Handmade animal preview">` : '<span>Upload a cartoon image before publishing.</span>'}</div>
        <button type="submit" class="btn green full">Publish Handmade Animal</button>
      </form>
    </section>
  `);
}

function renderReveal(id) {
  const reveal = appState.readyReveals.find(r => r.id === id) || appState.readyReveals[0];
  if (!reveal) return setRoute('home');
  const animal = getAnimal(reveal.animalId);
  if (!animal) return setRoute('home');
  shell(`
    <section class="unlock-card reveal-card ${categoryClass(animal.category)}">
      <div class="sparkles">✨ 🔎 ✨</div>
      <p class="eyebrow">New animal discovery</p>
      <h1>Your mystery animal has been studied!</h1>
      <div class="unlock-art">${imgMarkup(animal)}</div>
      <h2>${escapeHtml(animal.name)}</h2>
      <p class="helper">With your help, this animal can join the Animal Journal.</p>
      <div class="actions center"><button type="button" class="btn green" data-action="openReveal" data-id="${reveal.id}">Unlock Card</button><button type="button" class="btn ghost" data-route="home">Later</button></div>
    </section>
  `);
}

async function handleRoute(el) {
  const route = el.dataset.route;
  if (!route) return false;
  const params = {};
  if (el.dataset.id) params.id = el.dataset.id;
  if (el.dataset.category) params.category = el.dataset.category;
  if (el.dataset.tab) params.tab = el.dataset.tab;
  if (el.dataset.mystery) params.mystery = el.dataset.mystery;
  if (el.dataset.mode) params.mode = el.dataset.mode;
  if (el.dataset.search) params.search = el.dataset.search;
  if (el.dataset.mysteryId) params.mysteryId = el.dataset.mysteryId;
  setRoute(route, params);
  return true;
}

document.addEventListener('click', async event => {
  const routeEl = event.target.closest('[data-route]');
  if (routeEl) {
    event.preventDefault();
    if (await handleRoute(routeEl)) return;
  }
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  event.preventDefault();
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  if (action === 'install') return installApp();
  if (action === 'chooseAnimal') return setRoute('picker', { mode: 'discover' });
  if (action === 'clearPhoto') { pendingPhoto = null; return renderRoute(); }
  if (action === 'mystery') return saveMystery();
  if (action === 'detail') return setRoute('detail', { id });
  if (action === 'selectAnimal') return selectAnimal(id);
  if (action === 'confirmAnimal') return confirmAnimalSelection(id);
  if (action === 'confirmSelectedAnimal') return confirmSelectedAnimal(id);
  if (action === 'quizSelect') return toggleQuizCard(actionEl, id);
  if (action === 'checkQuiz') return checkQuiz();
  if (action === 'newQuiz') { quizDraft = null; return renderExplorerClub(); }
  if (action === 'manualUnlock') return setRoute('picker', { mode: 'manual' });
  if (action === 'linkMystery') return setRoute('picker', { mode: 'linkMystery', mysteryId: id });
  if (action === 'deleteMystery') return deleteMystery(id);
  if (action === 'deleteDiscovery') return deleteDiscovery(id);
  if (action === 'export') return exportData();
  if (action === 'deletePhotos') return deletePhotos();
  if (action === 'resetDiscoveries') return resetDiscoveries();
  if (action === 'openReveal') return openReveal(id);
});

async function selectAnimal(id) {
  const searchInput = document.getElementById('animalSearch');
  const activeFilter = document.querySelector('.picker-filter.active');
  setRoute('confirmAnimal', {
    animalId: id,
    mode: routeParams.mode || 'discover',
    mysteryId: routeParams.mysteryId || '',
    category: activeFilter?.dataset.pickerCategory || routeParams.category || 'All',
    search: searchInput?.value || routeParams.search || ''
  });
}

async function confirmSelectedAnimal(id) {
  return confirmAnimalSelection(id);
}

async function confirmAnimalSelection(id) {
  if (routeParams.mode === 'linkMystery') {
    const mystery = appState.mysteries.find(m => m.id === routeParams.mysteryId);
    if (!mystery) return toast('Mystery not found.');
    mystery.status = 'ready_to_reveal';
    appState.readyReveals.unshift({ id: uid('reveal'), animalId: id, photo: mystery.photo, createdAt: new Date().toISOString(), source: 'mystery-link' });
    await saveState();
    toast('Reveal is ready for the child.');
    setRoute('parentArea', { tab: 'mysteries' });
    return;
  }
  await unlockAnimal(id, pendingPhoto, routeParams.mode === 'manual' ? 'manual' : 'photo');
}

function clearQuizResultStyles() {
  document.querySelectorAll('.quiz-grid .animal-card').forEach(card => card.classList.remove('quiz-correct', 'quiz-wrong', 'quiz-missed'));
  const feedback = document.getElementById('quizFeedback');
  if (feedback) {
    feedback.className = 'quiz-feedback strong';
    feedback.textContent = '';
  }
}

function toggleQuizCard(card, id) {
  if (!quizDraft) return;
  if (quizDraft.checked) {
    quizDraft.checked = false;
    clearQuizResultStyles();
  }
  const set = new Set(quizDraft.selected);
  if (set.has(id)) set.delete(id); else set.add(id);
  quizDraft.selected = [...set];
  card.classList.toggle('selected');
}

function checkQuiz() {
  if (!quizDraft) return;
  const selectedSet = new Set(quizDraft.selected);
  const answerSet = new Set(quizDraft.answers);
  const feedback = document.getElementById('quizFeedback');
  if (!feedback) return;
  quizDraft.checked = true;
  document.querySelectorAll('.quiz-grid .animal-card').forEach(card => {
    const id = card.dataset.id;
    card.classList.remove('quiz-correct', 'quiz-wrong', 'quiz-missed');
    if (answerSet.has(id) && selectedSet.has(id)) card.classList.add('quiz-correct');
    else if (answerSet.has(id)) card.classList.add('quiz-missed');
    else if (selectedSet.has(id)) card.classList.add('quiz-wrong');
  });
  const selected = [...selectedSet].sort().join('|');
  const answers = [...answerSet].sort().join('|');
  if (selected === answers) {
    feedback.className = 'quiz-feedback strong good';
    feedback.textContent = 'Correct! Great exploring.';
  } else {
    const names = quizDraft.answers.map(id => getAnimal(id)?.name).filter(Boolean).join(', ');
    feedback.className = 'quiz-feedback strong try';
    feedback.textContent = `Not yet. Green cards are correct. Red cards are not a match. Answer: ${names}.`;
  }
}

document.addEventListener('change', async event => {
  if (event.target.id === 'discoverPhotoInput') {
    const file = event.target.files?.[0];
    if (!file) return;
    pendingPhoto = await compressImage(file, 640, 0.64);
    renderRoute();
  }
  if (event.target.id === 'profileAvatarInput') {
    const file = event.target.files?.[0];
    if (!file) return;
    const avatar = await compressImage(file, 480, 0.72);
    appState.profile = { ...(appState.profile || {}), avatar };
    await saveState();
    renderRoute();
  }
  if (event.target.id === 'handmadeImageInput') {
    const file = event.target.files?.[0];
    if (!file) return;
    handmadeImageDraft = await compressImage(file, 900, 0.78);
    document.getElementById('handmadePreview').innerHTML = `<img src="${handmadeImageDraft}" alt="Handmade animal preview">`;
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  const submitType = form.dataset.submit;
  if (!submitType) return;
  event.preventDefault();
  const formData = new FormData(form);
  if (submitType === 'profile') {
    appState.profile = {
      ...(appState.profile || {}),
      name: String(formData.get('name') || '').trim(),
      favoriteAnimal: String(formData.get('favoriteAnimal') || '').trim()
    };
    await saveState();
    toast('Profile saved.');
    setRoute('home');
  }
  if (submitType === 'parentGate') {
    const answer = Number(formData.get('answer'));
    if (answer === parentChallenge?.answer) {
      parentUnlocked = true;
      setRoute('parentArea');
    } else {
      toast('That answer did not work. Try again.');
      renderParentGate();
    }
  }
  if (submitType === 'handmade') {
    await submitHandmade(form, formData);
  }
});

async function submitHandmade(form, formData) {
  if (!handmadeImageDraft) return toast('Upload a cartoon image before publishing.');
  const mysteryId = form.dataset.mystery || '';
  const mystery = mysteryId ? appState.mysteries.find(m => m.id === mysteryId) : null;
  const name = String(formData.get('name') || '').trim();
  const animal = {
    id: `custom-${slugify(name)}-${Date.now().toString(36).slice(-4)}`,
    name,
    category: String(formData.get('category') || 'Other'),
    image: handmadeImageDraft,
    size: String(formData.get('size') || 'Small'),
    animalClass: String(formData.get('animalClass') || 'Animal'),
    familyGroup: String(formData.get('familyGroup') || ''),
    explorerSkill: String(formData.get('explorerSkill') || 'Explorer'),
    eats: asList(formData.get('eats')),
    livesIn: asList(formData.get('livesIn')),
    funFact: String(formData.get('funFact') || 'A special animal discovered by your family.'),
    isBaseline: false,
    isCustom: true,
    published: true,
    createdAt: new Date().toISOString()
  };
  appState.customAnimals.unshift(animal);
  appState.readyReveals.unshift({ id: uid('reveal'), animalId: animal.id, photo: mystery?.photo || null, createdAt: new Date().toISOString(), source: 'custom' });
  if (mystery) mystery.status = 'ready_to_reveal';
  handmadeImageDraft = null;
  await saveState();
  toast('Handmade card is ready to reveal.');
  setRoute('parentArea', { tab: 'handmade' });
}

async function openReveal(revealId) {
  const index = appState.readyReveals.findIndex(r => r.id === revealId);
  if (index < 0) return setRoute('home');
  const [reveal] = appState.readyReveals.splice(index, 1);
  await unlockAnimal(reveal.animalId, reveal.photo, reveal.source || 'reveal');
}

async function deleteDiscovery(id) {
  const animal = getAnimal(id);
  if (!animal || !appState.discoveries[id]) return toast('Discovery not found.');
  if (!confirm(`Delete the ${animal.name} discovery?\n\nThis removes the saved photo and locks this animal again.`)) return;
  delete appState.discoveries[id];
  await saveState();
  toast(`${animal.name} is locked again.`);
  setRoute('journal', { category: animal.category });
}

async function deleteMystery(id) {
  if (!confirm('Delete this mystery discovery?')) return;
  appState.mysteries = appState.mysteries.filter(m => m.id !== id);
  await saveState();
  renderRoute();
}

async function exportData() {
  const c = completion();
  const exportObject = {
    app: 'Little Explorer: Animal Quest',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: appState.profile ? { ...appState.profile, avatar: appState.profile.avatar ? '[not exported]' : null } : null,
    settings: appState.settings,
    completion: c,
    discoveries: Object.values(appState.discoveries).map(d => ({ ...d, latestPhoto: d.latestPhoto ? '[not exported]' : null })),
    customAnimals: appState.customAnimals.map(a => ({ ...a, image: a.image ? '[not exported]' : null })),
    mysteries: appState.mysteries.map(m => ({ ...m, photo: m.photo ? '[not exported]' : null }))
  };
  const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `animal-quest-export-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function deletePhotos() {
  if (!confirm('Delete saved app photos? Animal cards and counts will remain.')) return;
  Object.values(appState.discoveries).forEach(d => { d.latestPhoto = null; });
  appState.mysteries.forEach(m => { m.photo = null; });
  appState.readyReveals.forEach(r => { r.photo = null; });
  await saveState();
  toast('Saved app photos deleted.');
  renderRoute();
}

async function resetDiscoveries() {
  if (!confirm('Reset all discovered animals? This locks the journal again.')) return;
  appState.discoveries = {};
  appState.readyReveals = [];
  await saveState();
  toast('Discoveries reset.');
  setRoute('home');
}

async function installApp() {
  if (isStandalone()) return toast('Already installed.');
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    promptEvent.prompt();
    try { await promptEvent.userChoice; } catch (_) {}
    renderRoute();
    return;
  }
  alert('Install instructions:\n\nAndroid Chrome: open the browser menu and choose Install app or Add to Home screen.\n\niPhone/iPad Safari: tap Share, then Add to Home Screen.\n\nDesktop Chrome/Edge: use the install icon in the address bar.\n\nInstall works after deployment over HTTPS, or while testing on localhost.');
}

async function compressImage(file, maxSize = 640, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let dataUrl;
        try { dataUrl = canvas.toDataURL('image/webp', quality); }
        catch (_) { dataUrl = canvas.toDataURL('image/jpeg', quality); }
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function toast(message) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function init() {
  try {
    app.innerHTML = '<div class="loading"><div class="loader"></div><h1>Loading Animal Quest...</h1></div>';
    db = await openDb();
    animals = await loadAnimals();
    appState = normalizeLoadedState(await dbGet(STATE_KEY));
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed', error));
    }
    renderRoute();
  } catch (error) {
    app.innerHTML = `<div class="fatal"><h1>Animal Quest could not start.</h1><p>${escapeHtml(error.message)}</p><p>Try opening with START-HERE-MAC.command or serving the public folder with a local server.</p></div>`;
  }
}

init();
