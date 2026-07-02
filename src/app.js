const APP_VERSION = 'v2.03';
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
  settings: { ...DEFAULT_SETTINGS },
  quizWins: 0
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
    settings: { ...DEFAULT_SETTINGS, ...(clean.settings || {}) },
    quizWins: Number(clean.quizWins || 0)
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
  const totalSegments = 10;
  const filledSegments = Math.round((c.pct / 100) * totalSegments);
  const segments = Array.from({ length: totalSegments }, (_, i) => `<span class="${i < filledSegments ? 'filled' : ''}">🐾</span>`).join('');
  return `<div class="progress-block visual-progress-block" aria-label="${c.found} of ${c.total} animals discovered">
    <div class="progress-label"><strong>Animal Journal</strong><span>${c.found}/${c.total}</span></div>
    <div class="progress-track visual-progress-track"><i style="width:${c.pct}%"></i></div>
    <div class="paw-progress" aria-hidden="true">${segments}</div>
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

    <section class="home-progress-panel panel">
      ${progressBar(c)}
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
  return `<button type="button" class="category-tile visual-world-card progress-only-world ${categoryClass(cat.id)} ${mapRevealed ? 'map-revealed' : 'map-mystery'}" data-route="journal" data-category="${cat.id}" style="${cssBg(worldBgPath(cat.id))}" aria-label="${escapeHtml(cat.label)} ${cat.found} of ${cat.total} discovered">
    <div class="world-image-focus"><img src="${worldIconPath(cat.id)}" alt="${escapeHtml(cat.label)}"></div>
    <div class="map-animal-peek">
      ${preview.map(a => `<span class="map-peek ${isUnlocked(a.id) && mapRevealed ? 'seen' : 'hidden'}">${imgMarkup(a)}</span>`).join('')}
      ${!mapRevealed ? `<b class="map-lock-note">?</b>` : ''}
    </div>
    <div class="mini-progress category-bar-only" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <span class="sr-only">${cat.label}: ${cat.found} of ${cat.total} discovered.</span>
  </button>`;
}



function earnedBadges() {
  const counts = Object.fromEntries(categoryCounts().map(c => [c.id, c.found]));
  const found = completion().found;
  const repeat = Object.values(appState.discoveries).some(d => d.timesFound >= 3);
  const handmade = appState.customAnimals.some(a => a.published);
  return [
    { name: 'First Discovery', icon: '🐾', earned: found >= 1, hint: 'Find your first animal.', tone: 'gold' },
    { name: 'Three Finds', icon: '🧭', earned: found >= 3, hint: 'Discover 3 animals.', tone: 'map' },
    { name: 'Ten Finds', icon: '🏆', earned: found >= 10, hint: 'Discover 10 animals.', tone: 'trophy' },
    { name: 'Pet Pal', icon: '🏠', earned: (counts.Pets || 0) >= 3, hint: 'Find 3 pets.', tone: 'pets' },
    { name: 'Farm Friend', icon: '🚜', earned: (counts.Farm || 0) >= 3, hint: 'Find 3 farm animals.', tone: 'farm' },
    { name: 'Bug Buddy', icon: '🐞', earned: (counts.Bugs || 0) >= 3, hint: 'Find 3 bugs.', tone: 'bugs' },
    { name: 'City Explorer', icon: '🌆', earned: (counts.City || 0) >= 3, hint: 'Find 3 city animals.', tone: 'city' },
    { name: 'Wild Tracker', icon: '🐾', earned: (counts.Wild || 0) >= 2, hint: 'Find 2 wild animals.', tone: 'wild' },
    { name: 'Zoo Scout', icon: '🦁', earned: (counts.Zoo || 0) >= 3, hint: 'Find 3 zoo animals.', tone: 'zoo' },
    { name: 'Found Again', icon: '🔁', earned: repeat, hint: 'Find the same animal 3 times.', tone: 'loop' },
    { name: 'Handmade Helper', icon: '🎨', earned: handmade, hint: 'Publish a handmade animal.', tone: 'paint' },
    { name: 'Quiz Star', icon: '⭐', earned: found >= 3, hint: 'Unlock quiz play.', tone: 'star' }
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
          <p class="helper">Then tap the big animal picture that matches. A grown-up can help only when the animal is not in the journal.</p>
        </div>
      </div>
      <div class="camera-card visual-camera-card">
        <label class="photo-drop visual-photo-drop">
          <input id="discoverPhotoInput" type="file" accept="image/*" capture="environment">
          ${pendingPhoto ? `<img src="${pendingPhoto}" alt="Selected discovery photo">` : `<span class="camera-icon"><img src="./assets/nav/nav-camera.webp" alt=""></span><strong>Tap to take or choose photo</strong><small>Phone camera or photo library</small>`}
        </label>
        <div class="actions center visual-discover-actions">
          <button type="button" class="choose-animal-card" data-action="chooseAnimal" ${pendingPhoto ? '' : 'disabled'} aria-label="Choose animal">
            <span class="choose-icon"><img src="./assets/nav/nav-journal.webp" alt=""></span>
            <strong>Choose Animal</strong>
            <small>Match your photo</small>
          </button>
          ${pendingPhoto ? '<button type="button" class="retake-card" data-action="clearPhoto" aria-label="Retake or choose another photo"><span>↺</span><strong>Retake</strong></button>' : ''}
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
      <div class="animal-grid picker-grid visual-picker-grid">${list.map(animal => animalCard(animal, { action: 'selectAnimal', compact: true })).join('')}${mode === 'discover' ? unknownAnimalCard() : ''}</div>
      <div id="pickerNoResults" class="empty-state picker-empty" hidden><strong>No matching animals.</strong><p>Tap the big question-mark card if the animal is not in the journal.</p></div>
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
      if (card.classList.contains('unknown-animal-card')) {
        card.hidden = false;
        card.classList.remove('is-hidden');
        return;
      }
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
    if (hint) hint.textContent = visible ? `${visible} animal${visible === 1 ? '' : 's'} match. Tap one to confirm.` : 'No animals match yet. Tap the question-mark card if it is not in the journal.';
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


function unknownAnimalCard() {
  return `<button type="button" class="animal-card unknown-animal-card compact picker-visible" data-action="mystery" data-category="All" data-name="" data-search="unknown mystery not found question animal">
    <div class="card-art unknown-art"><span class="unknown-big-question">?</span><span class="unknown-paw">🐾</span></div>
    <div class="card-meta"><strong>Not here?</strong><em>Ask grown-up</em></div>
  </button>`;
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
      <div><p class="eyebrow">Sticker album</p><h1>${escapeHtml(title)}</h1><p class="helper">Color stickers are found. Grey shapes are waiting to be revealed.</p></div>
      ${progressBar(c)}
    </section>
    <div class="journal-categories visual-world-tabs visual-world-tabs-v203">
      <button type="button" class="journal-cat visual-world-tab progress-only-tab ${category === 'All' ? 'active' : ''}" data-route="journal" data-category="All" aria-label="All animals ${c.found} of ${c.total}">
        <img src="./assets/nav/nav-journal.webp" alt=""><div class="mini-progress"><i style="width:${c.pct}%"></i></div><span class="sr-only">All</span>
      </button>
      ${cats.map(cat => {
        const pct = cat.total ? Math.round(cat.found / cat.total * 100) : 0;
        return `<button type="button" class="journal-cat visual-world-tab progress-only-tab ${category === cat.id ? 'active' : ''} ${categoryClass(cat.id)}" data-route="journal" data-category="${cat.id}" aria-label="${escapeHtml(cat.label)} ${cat.found} of ${cat.total}">
          <img src="${worldIconPath(cat.id)}" alt=""><div class="mini-progress"><i style="width:${pct}%"></i></div><span class="sr-only">${escapeHtml(cat.label)}</span>
        </button>`;
      }).join('')}
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


function funFactsFor(animal) {
  const facts = Array.isArray(animal.funFacts) ? animal.funFacts : asList(animal.funFacts);
  const fallback = animal.funFact ? [animal.funFact] : [];
  const list = [...facts, ...fallback].filter(Boolean);
  const unique = [];
  list.forEach(f => { if (!unique.includes(f)) unique.push(f); });
  return unique.slice(0, 2);
}

function foodEmoji(food) {
  const f = String(food || '').toLowerCase();
  if (/bamboo/.test(f)) return '🎍';
  if (/nectar|flower/.test(f)) return '🌸';
  if (/seed|grain/.test(f)) return '🌾';
  if (/nut|acorn/.test(f)) return '🌰';
  if (/fruit|berry|berries/.test(f)) return '🍎';
  if (/grass|hay/.test(f)) return '🌱';
  if (/plant|leaf|leaves|veggie|vegetable/.test(f)) return '🌿';
  if (/insect|bug|tiny animals/.test(f)) return '🐞';
  if (/fish/.test(f)) return '🐟';
  if (/meat|animal/.test(f)) return '🍖';
  if (/soil/.test(f)) return '🍂';
  return '🥣';
}

function sizePaws(size) {
  const s = String(size || '').toLowerCase();
  const count = s.includes('tiny') ? 1 : s.includes('small') ? 2 : s.includes('medium') ? 3 : s.includes('large') ? 4 : s.includes('huge') ? 5 : 3;
  return Array.from({ length: 5 }, (_, i) => `<span class="${i < count ? 'on' : ''}">●</span>`).join('');
}

function familyIcon(value) {
  const v = String(value || '').toLowerCase();
  if (/feline|cat|lion|tiger/.test(v)) return '🐱';
  if (/canine|dog|coyote/.test(v)) return '🐶';
  if (/rodent|capybara/.test(v)) return '🐹';
  if (/equine|horse|donkey|zebra/.test(v)) return '🐴';
  if (/bird/.test(v)) return '🪶';
  if (/bear/.test(v)) return '🐻';
  if (/reptile|lizard|crocodilian|turtle/.test(v)) return '🦎';
  if (/insect|bug/.test(v)) return '🐞';
  if (/frog|amphibian/.test(v)) return '🐸';
  if (/fish/.test(v)) return '🐟';
  if (/mollusk|snail/.test(v)) return '🐚';
  return '🐾';
}

function visualFactCards(animal, unlocked) {
  if (!unlocked) return `<div class="fun-facts-stack locked"><div class="fun-fact-card"><span>?</span><div><strong>Fun Facts</strong><p>Discover this animal to reveal two facts.</p></div></div></div>`;
  const facts = funFactsFor(animal);
  return `<div class="fun-facts-stack">
    ${facts.map((fact, index) => `<div class="fun-fact-card"><span>${index === 0 ? '💡' : '🔎'}</span><div><strong>Fun Fact ${index + 1}</strong><p>${escapeHtml(fact)}</p></div></div>`).join('')}
  </div>`;
}

function visualBadgeWall(animal) {
  const foods = asList(animal.eats);
  const homes = asList(animal.livesIn);
  const foodTokens = foods.length ? foods.map(food => `<span title="${escapeHtml(food)}">${foodEmoji(food)}</span>`).join('') : '<span>🥣</span>';
  const homeIcon = iconForValue('lives', homes.join(' '));
  const kindIcon = iconForValue('class', animal.animalClass || animal.familyGroup || 'Animal');
  const skillIcon = iconForValue('skill', animal.explorerSkill || 'Explorer');
  return `<div class="visual-badge-wall v202-badge-wall">
    <div class="image-attribute-badge world"><img src="${worldIconPath(animal.category)}" alt=""><small>World</small><strong>${escapeHtml(animal.category || 'Animal')}</strong></div>
    <div class="image-attribute-badge food-symbol-badge eats"><div class="food-symbol-row">${foodTokens}</div><small>Eats</small><strong>${escapeHtml(foods.join(' + ') || 'Food')}</strong></div>
    <div class="image-attribute-badge kind"><span>${kindIcon}</span><small>Kind</small><strong>${escapeHtml(animal.animalClass || 'Animal')}</strong></div>
    <div class="image-attribute-badge family"><span>${familyIcon(animal.familyGroup || animal.animalClass)}</span><small>Family</small><strong>${escapeHtml(animal.familyGroup || animal.animalClass || 'Animal')}</strong></div>
    <div class="image-attribute-badge home"><span>${homeIcon}</span><small>Home</small><strong>${escapeHtml(homes[0] || 'Place')}</strong></div>
    <div class="image-attribute-badge skill"><span>${skillIcon}</span><small>Skill</small><strong>${escapeHtml(animal.explorerSkill || 'Explorer')}</strong></div>
    <div class="image-attribute-badge size"><div class="size-paw-scale">${sizePaws(animal.size)}</div><small>Size</small><strong>${escapeHtml(animal.size || 'Unknown')}</strong></div>
  </div>`;
}

function lockedBadgeWall() {
  return `<div class="visual-badge-wall locked-badges v202-badge-wall">
    ${['World','Eats','Kind','Family','Home','Skill','Size'].map(label => `<div class="image-attribute-badge mystery"><span>?</span><small>${label}</small><strong>Unlock</strong></div>`).join('')}
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
        <div class="story-bottom-grid visual-story-grid v202-story-grid">
          ${visualFactCards(animal, unlocked)}
          <div class="my-photo-card"><strong>My Photo</strong>${latestPhoto ? `<img src="${latestPhoto}" alt="Latest discovery photo">` : '<div class="photo-placeholder">📷</div>'}</div>
        </div>
        ${unlocked ? `<p class="found-note">Found ${discovery.timesFound || 1} time${(discovery.timesFound || 1) === 1 ? '' : 's'} • Last found ${formatDate(discovery.lastDiscoveredAt)}</p>` : '<p class="found-note">Find this animal in the real world to reveal the card.</p>'}
        <div class="actions center"><button type="button" class="btn green icon-btn" data-route="discover"><span class="btn-icon">📷</span><strong>${unlocked ? 'Find Again' : 'Discover'}</strong></button>${unlocked ? `<button type="button" class="btn danger icon-btn trash-btn" data-action="deleteDiscovery" data-id="${animal.id}" aria-label="Delete discovery"><span class="btn-icon">🗑️</span><strong>Delete</strong></button>` : ''}</div>
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
          <div class="confirm-choice-actions" aria-label="Confirm animal selection">
            <button type="button" class="choice-btn yes" data-action="confirmSelectedAnimal" data-id="${animal.id}" aria-label="Confirm and unlock"><span>✓</span><small>${mode === 'linkMystery' ? 'Link' : 'Unlock'}</small></button>
            <button type="button" class="choice-btn no" data-route="picker" data-mode="${escapeHtml(mode)}" data-category="${escapeHtml(backParams.category)}" data-search="${escapeHtml(backParams.search)}" data-mystery-id="${escapeHtml(params.mysteryId || '')}" aria-label="Go back and choose another"><span>×</span><small>Back</small></button>
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
          <button type="button" class="tab active icon-tab" data-route="explorerClub" data-tab="badges"><span>🏅</span><strong>Badges</strong></button>
          <button type="button" class="tab icon-tab" data-route="discover"><span>📷</span><strong>Discover</strong></button>
        </div>
      </section>
      <section class="panel"><div class="badge-album badge-album-v203">${badges.map(badgeCard).join('')}</div></section>
    `);
    return;
  }

  if (tab === 'badges') {
    shell(`
      <section class="panel club-hero compact-club-hero">
        <p class="eyebrow">Explorer Club</p>
        <h1>Explorer badges</h1>
        <p class="helper">Collect medals by discovering animals, completing worlds, and creating special animals.</p>
        <div class="club-switch">
          <button type="button" class="tab icon-tab" data-route="explorerClub" data-tab="quiz"><span>❓</span><strong>Quiz</strong></button>
          <button type="button" class="tab active icon-tab" data-route="explorerClub" data-tab="badges"><span>🏅</span><strong>Badges</strong></button>
        </div>
      </section>
      <section class="panel"><div class="badge-album badge-album-v203">${badges.map(badgeCard).join('')}</div></section>
    `);
    return;
  }

  quizDraft = quizDraft && quizDraft.options.every(id => discovered.some(a => a.id === id)) ? quizDraft : createQuiz(discovered);
  const options = quizDraft.options.map(id => getAnimal(id)).filter(Boolean);
  const attempts = quizDraft.attempts || 0;
  const answerTotal = quizDraft.answers.length;
  shell(`
    <section class="panel club-hero compact-club-hero">
      <p class="eyebrow">Explorer Club</p>
      <h1>Animal quiz</h1>
      <p class="helper">Tap every card that matches. You get two tries before the answer is revealed.</p>
      <div class="club-switch">
        <button type="button" class="tab active icon-tab" data-route="explorerClub" data-tab="quiz"><span>❓</span><strong>Quiz</strong></button>
        <button type="button" class="tab icon-tab" data-route="explorerClub" data-tab="badges"><span>🏅</span><strong>Badges</strong></button>
      </div>
    </section>
    <section class="panel quiz-panel quiz-fit-panel quiz-v203-panel">
      <div class="quiz-question-card visual-quiz-question">
        <span class="quiz-icon">${quizDraft.icon || '🔎'}</span>
        <div><p class="eyebrow">Explorer quiz</p><h2>${escapeHtml(quizDraft.question)}</h2></div>
      </div>
      <div class="quiz-paw-status" aria-label="Quiz answer progress">${quizPawMeter(0, answerTotal)}<span class="try-dots"><i class="${attempts >= 1 ? 'used' : ''}"></i><i class="${attempts >= 2 ? 'used' : ''}"></i></span></div>
      <div class="animal-grid quiz-grid quiz-fit-grid">${options.map(animal => animalCard(animal, { action: 'quizSelect', compact: true })).join('')}</div>
      <div id="quizFeedback" class="quiz-feedback strong visual-quiz-feedback"></div>
      <div class="actions center quiz-actions v203-quiz-actions">
        <button type="button" class="btn green icon-btn quiz-check-btn" data-action="checkQuiz" aria-label="Check answer"><span class="btn-icon">✅</span><span>Check</span></button>
        <button type="button" class="btn ghost icon-btn quiz-new-btn" data-action="newQuiz" aria-label="New quiz"><span class="btn-icon">🔄</span><span>New</span></button>
      </div>
    </section>
  `);
  quizDraft.selected.forEach(id => document.querySelector(`[data-action="quizSelect"][data-id="${CSS.escape(id)}"]`)?.classList.add('selected'));
  applyQuizVisualState();
}



function badgeCard(badge) {
  return `<div class="badge-card explorer-medal-card ${badge.earned ? 'earned' : 'locked'} badge-tone-${escapeHtml(badge.tone || 'gold')}">
    <div class="badge-medal"><span>${badge.earned ? badge.icon : '?'}</span><i></i></div>
    <strong>${escapeHtml(badge.name)}</strong>
    <span>${badge.earned ? 'Earned!' : badge.hint || 'Keep exploring'}</span>
  </div>`;
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
  return { question: target.question, icon: target.icon, answers: chosen.filter(target.match).map(a => a.id), options: chosen.map(a => a.id), selected: [], checked: false, attempts: 0, revealed: false, complete: false };
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
  const tabs = ['overview','guide','mysteries','handmade','settings','data'];
  shell(`
    <section class="panel parent-panel-v203">
      <div class="section-head"><div><p class="eyebrow">Parent area</p><h1>Manage the local animal journal</h1></div><span class="version-pill">${APP_VERSION}</span></div>
      <div class="tabs parent-tabs-v203">
        ${tabs.map(t => `<button type="button" class="tab ${tab === t ? 'active' : ''}" data-route="parentArea" data-tab="${t}">${t === 'guide' ? 'Guide' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      ${tab === 'overview' ? `<div class="dashboard-grid">
        <div class="dash-card"><strong>${c.found}/${c.total}</strong><span>Journal progress</span></div>
        <div class="dash-card"><strong>${pending.length}</strong><span>Pending mysteries</span></div>
        <div class="dash-card"><strong>${appState.customAnimals.length}</strong><span>Handmade animals</span></div>
        <div class="dash-card"><strong>${Object.keys(appState.discoveries).length}</strong><span>Discovered cards</span></div>
      </div>
      <div class="actions"><button type="button" class="btn yellow icon-btn" data-route="parentArea" data-tab="guide"><span class="btn-icon">📘</span><span>How it Works</span></button><button type="button" class="btn yellow icon-btn" data-route="parentArea" data-tab="mysteries"><span class="btn-icon">❓</span><span>Review Mysteries</span></button><button type="button" class="btn purple icon-btn" data-route="handmade"><span class="btn-icon">🎨</span><span>Create Animal</span></button><button type="button" class="btn ghost icon-btn" data-action="manualUnlock"><span class="btn-icon">🔓</span><span>Manual Unlock</span></button></div>` : ''}
      ${tab === 'guide' ? parentGuideMarkup() : ''}
      ${tab === 'mysteries' ? mysteryListMarkup() : ''}
      ${tab === 'handmade' ? handmadeListMarkup() : ''}
      ${tab === 'settings' ? settingsMarkup() : ''}
      ${tab === 'data' ? dataCheckMarkup() : ''}
    </section>
  `);
}



function parentGuideMarkup() {
  const mailSubject = encodeURIComponent('[Little Explorer:Animal Quest App Feedback]');
  const mailBody = encodeURIComponent(`Hi Jose Maria,\n\nChild experience:\n- What did the child enjoy?\n- What confused them?\n- Did they want to explore outside?\n\nParent experience:\n- Was the purpose clear?\n- Was the app easy to use?\n- Any bugs or ideas?\n\nDevice/browser:\nApp version: ${APP_VERSION}\n`);
  return `<div class="parent-guide">
    <section class="guide-card purpose-card">
      <span class="guide-icon">🧭</span>
      <div><h2>Purpose</h2><p>I created this adventure as a father to help kids stay curious in the real world. The goal is not more screen time. The screen is only a tool: children notice an animal, take a photo, unlock a journal card, and learn from something they actually discovered.</p></div>
    </section>
    <section class="guide-card"><span class="guide-icon">📷</span><div><h2>How to use it</h2><p>Start with Discover. Let the child take or choose a photo. Then help them match the picture to an animal. The animal becomes a colorful sticker in the journal, while missing animals stay grey until found.</p></div></section>
    <section class="guide-card"><span class="guide-icon">❓</span><div><h2>When the animal is not listed</h2><p>Tap the big question-mark card. The photo becomes a mystery for a grown-up to review. You can link it to an existing animal or create a new handmade creature.</p></div></section>
    <section class="guide-card"><span class="guide-icon">🎨</span><div><h2>Create new creatures</h2><p>In Handmade Animal, add the animal name, category, kind, food, habitat, and cartoon image. The card is not shown to the child until it is ready, so the reveal still feels special.</p></div></section>
    <section class="guide-card"><span class="guide-icon">🔒</span><div><h2>Local and private</h2><p>The MVP works locally. Photos and progress stay on the device. There are no accounts, no social sharing, no online database, and no external API calls in this version.</p></div></section>
    <a class="btn blue icon-btn feedback-mail" href="mailto:josemariaherranmarco@gmail.com?subject=${mailSubject}&body=${mailBody}"><span class="btn-icon">✉️</span><span>Send Feedback</span></a>
  </div>`;
}

function mysteryListMarkup() {
  const mysteries = appState.mysteries;
  if (!mysteries.length) return `<div class="empty-state"><strong>No mystery discoveries yet.</strong><p>When a child finds an animal not in the list, it appears here.</p></div>`;
  return `<div class="list">${mysteries.map(m => `<article class="mystery-row"><img src="${m.photo}" alt="Mystery photo"><div><strong>Mystery discovery</strong><p class="helper">${formatDate(m.createdAt)} • ${m.status}</p><div class="actions"><button type="button" class="btn green icon-btn" data-action="linkMystery" data-id="${m.id}"><span class="btn-icon">🔗</span><span>Link Existing</span></button><button type="button" class="btn purple icon-btn" data-route="handmade" data-mystery="${m.id}"><span class="btn-icon">🎨</span><span>Create</span></button><button type="button" class="btn danger icon-btn" data-action="deleteMystery" data-id="${m.id}"><span class="btn-icon">🗑️</span><span>Delete</span></button></div></div></article>`).join('')}</div>`;
}



function handmadeListMarkup() {
  const custom = appState.customAnimals;
  return `<div class="actions"><button type="button" class="btn purple icon-btn" data-route="handmade"><span class="btn-icon">🎨</span><strong>Create Handmade</strong></button></div>${custom.length ? `<div class="animal-grid small-grid">${custom.map(a => animalCard(a, { compact: true })).join('')}</div>` : `<div class="empty-state"><strong>No handmade animals yet.</strong><p>Parents can create a custom card when the official list does not include the animal.</p></div>`}`;
}

function settingsMarkup() {
  return `<div class="settings-list">
    <div class="setting-row"><div><strong>Install App</strong><p>Add this deployed PWA to a device.</p></div><button type="button" class="btn blue icon-btn" data-action="install"><span class="btn-icon">⬇️</span><span>${isStandalone() ? 'Installed' : 'Install'}</span></button></div>
    <div class="setting-row"><div><strong>Export metadata</strong><p>Exports profile, discoveries, handmade animal records, and settings as JSON. Photos are excluded from export.</p></div><button type="button" class="btn green icon-btn" data-action="export"><span class="btn-icon">📦</span><span>Export</span></button></div>
    <div class="setting-row"><div><strong>Delete saved app photos</strong><p>Removes low-resolution discovery and mystery photos stored by this app.</p></div><button type="button" class="btn danger icon-btn" data-action="deletePhotos"><span class="btn-icon">🗑️</span><span>Photos</span></button></div>
    <div class="setting-row"><div><strong>Reset discoveries</strong><p>Keeps animal data and handmade animals but locks all cards again.</p></div><button type="button" class="btn danger icon-btn" data-action="resetDiscoveries"><span class="btn-icon">🔄</span><span>Reset</span></button></div>
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
      <div class="section-head"><div><p class="eyebrow">Handmade animal</p><h1>Create a new animal card</h1><p class="helper">The card is published only when required details and a cartoon image are ready.</p></div><button type="button" class="btn ghost icon-btn" data-route="parentArea" data-tab="handmade"><span class="btn-icon">×</span><span>Cancel</span></button></div>
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
        <div class="ai-prompt-helper full"><div><strong>Need a cartoon?</strong><p class="helper">Fill in the details, then copy a prompt for an external AI image tool.</p></div><button type="button" class="btn blue icon-btn" data-action="copyAiPrompt"><span class="btn-icon">📋</span><span>Copy AI Prompt</span></button></div>
        <label class="full">Cartoon image<input id="handmadeImageInput" type="file" accept="image/*" required></label>
        <div id="handmadePreview" class="handmade-preview">${handmadeImageDraft ? `<img src="${handmadeImageDraft}" alt="Handmade animal preview">` : '<span>Upload a cartoon image before publishing.</span>'}</div>
        <button type="submit" class="btn green full icon-btn"><span class="btn-icon">✅</span><span>Publish Handmade Animal</span></button>
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
  if (action === 'copyAiPrompt') return copyAiPrompt(actionEl);
  if (action === 'newQuiz') { quizDraft = null; return renderExplorerClub(); }
  if (action === 'manualUnlock') return setRoute('picker', { mode: 'manual' });
  if (action === 'linkMystery') return setRoute('picker', { mode: 'linkMystery', mysteryId: id });
  if (action === 'deleteMystery') return deleteMystery(id);
  if (action === 'deleteDiscovery') return deleteDiscovery(id);
  if (action === 'export') return exportData();
  if (action === 'deletePhotos') return deletePhotos();
  if (action === 'resetDiscoveries') return resetDiscoveries();
  if (action === 'openReveal') return openReveal(id);
  if (action === 'feedbackEmail') return openFeedbackEmail();
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


function quizPawMeter(correct = 0, total = 1) {
  const safeTotal = Math.max(1, total || 1);
  return `<div class="quiz-paw-meter" aria-hidden="true">${Array.from({ length: safeTotal }, (_, i) => `<span class="${i < correct ? 'filled' : ''}">🐾</span>`).join('')}</div>`;
}

function updateQuizPawStatus(correctOverride = null, totalOverride = null) {
  if (!quizDraft) return;
  const answerSet = new Set(quizDraft.answers);
  const selectedSet = new Set(quizDraft.selected);
  const correct = correctOverride ?? [...selectedSet].filter(id => answerSet.has(id)).length;
  const total = totalOverride ?? answerSet.size;
  const holder = document.querySelector('.quiz-paw-status');
  if (holder) {
    const attempts = quizDraft.attempts || 0;
    holder.innerHTML = `${quizPawMeter(correct, total)}<span class="try-dots"><i class="${attempts >= 1 ? 'used' : ''}"></i><i class="${attempts >= 2 ? 'used' : ''}"></i></span>`;
  }
}

function applyQuizVisualState() {
  if (!quizDraft) return;
  const selectedSet = new Set(quizDraft.selected);
  const answerSet = new Set(quizDraft.answers);
  document.querySelectorAll('.quiz-grid .animal-card').forEach(card => {
    const id = card.dataset.id;
    card.classList.toggle('selected', selectedSet.has(id));
    card.classList.remove('quiz-correct', 'quiz-wrong', 'quiz-missed');
    if (quizDraft.checked || quizDraft.revealed || quizDraft.complete) {
      if (answerSet.has(id) && selectedSet.has(id)) card.classList.add('quiz-correct');
      else if (selectedSet.has(id)) card.classList.add('quiz-wrong');
      else if (quizDraft.revealed && answerSet.has(id)) card.classList.add('quiz-missed');
    }
  });
  updateQuizPawStatus();
}

function clearQuizResultStyles() {
  document.querySelectorAll('.quiz-grid .animal-card').forEach(card => card.classList.remove('quiz-correct', 'quiz-wrong', 'quiz-missed'));
  const feedback = document.getElementById('quizFeedback');
  if (feedback) {
    feedback.className = 'quiz-feedback strong visual-quiz-feedback';
    feedback.innerHTML = '';
  }
}



function toggleQuizCard(card, id) {
  if (!quizDraft || quizDraft.revealed || quizDraft.complete) return;
  if (quizDraft.checked) {
    quizDraft.checked = false;
    clearQuizResultStyles();
  }
  const set = new Set(quizDraft.selected);
  if (set.has(id)) set.delete(id); else set.add(id);
  quizDraft.selected = [...set];
  card.classList.toggle('selected');
  updateQuizPawStatus();
}




async function checkQuiz() {
  if (!quizDraft || quizDraft.revealed || quizDraft.complete) return;
  quizDraft.attempts = Math.min(2, (quizDraft.attempts || 0) + 1);
  quizDraft.checked = true;
  const selectedSet = new Set(quizDraft.selected);
  const answerSet = new Set(quizDraft.answers);
  const selected = [...selectedSet].sort().join('|');
  const answers = [...answerSet].sort().join('|');
  const correctSelected = [...selectedSet].filter(id => answerSet.has(id)).length;
  const wrongSelected = [...selectedSet].filter(id => !answerSet.has(id)).length;
  const isExact = selected === answers;
  const reveal = !isExact && quizDraft.attempts >= 2;
  quizDraft.revealed = reveal;
  quizDraft.complete = isExact;

  document.querySelectorAll('.quiz-grid .animal-card').forEach(card => {
    const id = card.dataset.id;
    card.classList.remove('quiz-correct', 'quiz-wrong', 'quiz-missed');
    if (answerSet.has(id) && selectedSet.has(id)) card.classList.add('quiz-correct');
    else if (selectedSet.has(id)) card.classList.add('quiz-wrong');
    else if (reveal && answerSet.has(id)) card.classList.add('quiz-missed');
  });

  const feedback = document.getElementById('quizFeedback');
  if (!feedback) return;
  if (isExact) {
    feedback.className = 'quiz-feedback strong good visual-quiz-feedback';
    feedback.innerHTML = `<div class="result-face">🎉</div><div class="quiz-paws-result">${quizPawMeter(answerSet.size, answerSet.size)}</div>`;
  } else if (!reveal) {
    feedback.className = 'quiz-feedback strong almost visual-quiz-feedback';
    const wrongPart = wrongSelected ? '<span class="mini-wrong">✕</span>' : '';
    feedback.innerHTML = `<div class="result-face">${wrongSelected ? '🔄' : '🐾'}</div><div class="quiz-paws-result">${quizPawMeter(correctSelected, answerSet.size)}</div>${wrongPart}<div class="try-visual"><span class="try-dot used"></span><span class="try-dot"></span></div>`;
  } else {
    feedback.className = 'quiz-feedback strong reveal visual-quiz-feedback';
    feedback.innerHTML = `<div class="result-face">👀</div><div class="quiz-paws-result">${quizPawMeter(answerSet.size, answerSet.size)}</div><small>The answer is glowing.</small>`;
  }
  updateQuizPawStatus(correctSelected, answerSet.size);
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

function openFeedbackEmail() {
  const subject = '[Little Explorer:Animal Quest App Feedback]';
  const body = [
    'Hi Jose,',
    '',
    'Here is feedback on Little Explorer: Animal Quest.',
    '',
    'Child experience:',
    '- What did the child enjoy?',
    '- What confused the child?',
    '- Could the child navigate without reading?',
    '',
    'Parent experience:',
    '- Was the purpose clear?',
    '- Was the app easy to use?',
    '- What would make it more useful for real-world exploration?',
    '',
    `App version: ${APP_VERSION}`,
    `Device/browser: ${navigator.userAgent}`
  ].join('\n');
  window.location.href = `mailto:josemariaherranmarco@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function aiImagePromptFromForm(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim() || '[ANIMAL NAME PLACEHOLDER]';
  const category = String(data.get('category') || '').trim() || '[CATEGORY PLACEHOLDER]';
  const kind = String(data.get('animalClass') || '').trim() || '[ANIMAL KIND PLACEHOLDER]';
  const family = String(data.get('familyGroup') || '').trim() || '[FAMILY PLACEHOLDER]';
  const size = String(data.get('size') || '').trim() || '[SIZE PLACEHOLDER]';
  const skill = String(data.get('explorerSkill') || '').trim() || '[EXPLORER SKILL PLACEHOLDER]';
  const eats = String(data.get('eats') || '').trim() || '[FOOD DETAILS PLACEHOLDER]';
  const lives = String(data.get('livesIn') || '').trim() || '[HABITAT DETAILS PLACEHOLDER]';
  const fact1 = String(data.get('funFact') || '').trim();
  const fact2 = String(data.get('funFact2') || '').trim();
  return `Create a cartoon animal image for a children's app called Little Explorer: Animal Quest.\n\nAnimal name: ${name}\nCategory/world: ${category}\nAnimal kind: ${kind}\nAnimal family: ${family}\nSize: ${size}\nExplorer skill: ${skill}\nWhat it eats: ${eats}\nWhere it lives: ${lives}\nFun fact 1: ${fact1 || '[FUN FACT PLACEHOLDER]'}\nFun fact 2: ${fact2 || '[SECOND FUN FACT PLACEHOLDER]'}\n\nIf I provide a reference photo, use it only to understand the animal's shape, colors, and identifying traits. Do not copy any background or text from the reference image.\n\nStyle requirements: kawaii chibi animal character, cozy exploration field-journal style, full body centered, transparent background, 1024 x 1024 square canvas, friendly expressive eyes, soft rounded shapes, simplified anatomy, warm watercolor-like shading, slightly imperfect hand-inked outline, soft desaturated colors, top-left light source, non-threatening expression, collectible animal card style for kids ages 4 to 9.\n\nComposition requirements: one animal only, no scenery, no text, no logo, no hard shadow, no scary expression, no neon colors, enough padding around the animal, recognizable at small size. Export as PNG or WebP with transparent background.`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

async function copyAiImagePrompt(button) {
  const form = button.closest('form') || document.querySelector('form[data-submit="handmade"]');
  if (!form) return toast('Open the handmade animal form first.');
  const prompt = aiImagePromptFromForm(form);
  try {
    await copyTextToClipboard(prompt);
    toast('AI image prompt copied.');
  } catch (_) {
    alert(prompt);
  }
}


function buildAiImagePrompt(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim() || '[ANIMAL NAME PLACEHOLDER]';
  const category = String(fd.get('category') || '').trim() || '[CATEGORY PLACEHOLDER]';
  const animalClass = String(fd.get('animalClass') || '').trim() || '[ANIMAL KIND PLACEHOLDER]';
  const familyGroup = String(fd.get('familyGroup') || '').trim() || '[ANIMAL FAMILY PLACEHOLDER]';
  const size = String(fd.get('size') || '').trim() || '[SIZE PLACEHOLDER]';
  const skill = String(fd.get('explorerSkill') || '').trim() || '[EXPLORER SKILL PLACEHOLDER]';
  const eats = String(fd.get('eats') || '').trim() || '[FOOD PLACEHOLDER]';
  const livesIn = String(fd.get('livesIn') || '').trim() || '[HABITAT PLACEHOLDER]';
  const fact = String(fd.get('funFact') || '').trim() || '[FUN FACT PLACEHOLDER]';
  return `Create a kid-friendly animal card illustration and suggest missing card details for Little Explorer: Animal Quest.\n\nAnimal name: ${name}\nCategory/world: ${category}\nAnimal kind: ${animalClass}\nAnimal family: ${familyGroup}\nSize: ${size}\nExplorer skill: ${skill}\nEats: ${eats}\nLives in: ${livesIn}\nKnown fun fact: ${fact}\n\nImage request: create a full-body kawaii chibi animal character for a cozy children's real-world animal discovery app. Use soft rounded shapes, big friendly expressive eyes, simplified anatomy, gentle watercolor-style shading, slightly desaturated colors, subtle hand-inked linework, and a clear top-left light source. The animal should be warm, non-threatening, recognizable at small size, and feel like a collectible sticker/journal card. Use a transparent background, 1024 x 1024 square canvas, full body centered, 10-15% padding, no text, no scenery, no harsh shadows, no neon colors.\n\nAlso provide two short fun facts for ages 4-9 and suggest: animal kind, family group, foods, habitat, explorer skill, and size. If I provide a reference photo, use it only to identify the animal and key visual traits, not as a realistic photo style.`;
}

async function copyAiPrompt(button) {
  const form = button.closest('form');
  if (!form) return toast('Open the handmade form first.');
  const prompt = buildAiImagePrompt(form);
  try {
    await navigator.clipboard.writeText(prompt);
    toast('AI image prompt copied.');
  } catch (_) {
    const box = document.createElement('textarea');
    box.value = prompt;
    document.body.appendChild(box);
    box.select();
    try { document.execCommand('copy'); toast('AI image prompt copied.'); }
    catch (error) { alert(prompt); }
    box.remove();
  }
}

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
    funFacts: [String(formData.get('funFact') || 'A special animal discovered by your family.'), 'This animal became part of your family journal because you discovered it.'],
    funFacts: [String(formData.get('funFact') || '').trim(), String(formData.get('funFact2') || '').trim()].filter(Boolean),
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
    quizWins: Number(appState.quizWins || 0),
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
