const APP_VERSION = 'v1.05';
const DB_NAME = 'little-explorer-animal-quest-db';
const DATA_URL = './data/animals.json';
const STORE_NAME = 'kv';
const STATE_KEY = 'animalQuestState';
const DEFAULT_EXPLORER_IMAGE = './assets/default-explorer.webp';
const DEFAULT_EXPLORER_AVATAR = './assets/default-explorer-avatar.webp';

const CATEGORIES = [
  { id: 'Pets', label: 'Pets', icon: '🏡', note: 'Animal friends near home.', color: 'pets' },
  { id: 'Farm', label: 'Farm', icon: '🌿', note: 'Animals from farms and fields.', color: 'farm' },
  { id: 'Bugs', label: 'Bugs', icon: '🔎', note: 'Tiny explorers and little creatures.', color: 'bugs' },
  { id: 'City', label: 'City', icon: '🏙️', note: 'Animals in parks, yards, and neighborhoods.', color: 'city' },
  { id: 'Wild', label: 'Wild', icon: '🌲', note: 'Animals from the wilder world.', color: 'wild' },
  { id: 'Zoo', label: 'Zoo', icon: '🧭', note: 'Big world animals often seen at zoos.', color: 'zoo' },
  { id: 'Other', label: 'Special', icon: '✨', note: 'Handmade discoveries.', color: 'other' }
];

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
  if (['parentArea', 'handmade'].includes(currentRoute)) return 'parent';
  if (['picker', 'unlock', 'mysterySubmitted', 'reveal'].includes(currentRoute)) return 'discover';
  if (currentRoute === 'detail') return 'journal';
  return currentRoute;
}

function navButton(route, label, icon) {
  const active = activeNavRoute() === route;
  return `<button type="button" class="nav-btn ${active ? 'active' : ''}" data-route="${route}"><span>${icon}</span><strong>${label}</strong></button>`;
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
        ${navButton('quiz', 'Quiz', '⭐')}
        ${navButton('parent', 'Grown-up', '🔒')}
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
    case 'unlock': return renderUnlock(routeParams);
    case 'journal': return renderJournal(routeParams.category || 'All');
    case 'detail': return renderDetail(routeParams.id);
    case 'quiz': return renderQuiz();
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
  const featured = getAnimal('squirrel') || allAnimals()[0];
  const latest = Object.values(appState.discoveries).sort((a, b) => String(b.lastDiscoveredAt).localeCompare(String(a.lastDiscoveredAt))).slice(0, 4);
  const ready = appState.readyReveals[0];
  const readyAnimal = ready ? getAnimal(ready.animalId) : null;
  shell(`
    ${ready ? `<section class="reveal-banner"><div><strong>New animal discovery ready!</strong><span>A grown-up studied your mystery animal${readyAnimal ? `: ${escapeHtml(readyAnimal.name)}` : ''}.</span></div><button type="button" class="btn yellow" data-route="reveal" data-id="${ready.id}">Reveal Card</button></section>` : ''}
    <section class="hero-card">
      <div class="hero-copy">
        <p class="eyebrow">Real-world animal adventure</p>
        <h1>Go outside. Find animals. Unlock your journal.</h1>
        <p>Take a photo, choose what you found, and turn each discovery into a friendly animal card.</p>
        ${progressBar(c)}
        <div class="hero-actions">
          <button type="button" class="quest-button primary" data-route="discover"><span>📷</span><strong>Discover Animal</strong><small>Take or choose a photo</small></button>
          <button type="button" class="quest-button journal" data-route="journal"><span>📖</span><strong>Animal Journal</strong><small>See unlocked and missing cards</small></button>
        </div>
      </div>
      <div class="hero-scene">
        <img src="${DEFAULT_EXPLORER_IMAGE}" alt="Little explorers discovering an animal temple">
        <div class="hero-bubble">Explorer base camp</div>
      </div>
    </section>

    ${installBlock()}

    <section class="section-head"><h2>Explorer map</h2><span>${c.found}/${c.total} found</span></section>
    <div class="category-grid">
      ${categoryCounts().map(categoryTile).join('')}
    </div>

    <section class="panel">
      <div class="section-head compact"><h2>Badges</h2><span>${earnedBadges().filter(b => b.earned).length}/${earnedBadges().length}</span></div>
      <div class="badge-strip">${earnedBadges().map(b => `<span class="badge ${b.earned ? 'earned' : ''}">${b.icon} ${escapeHtml(b.name)}</span>`).join('')}</div>
    </section>

    <section class="panel">
      <div class="section-head compact"><h2>Recent discoveries</h2><button type="button" class="link-btn" data-route="journal">Open journal</button></div>
      ${latest.length ? `<div class="animal-grid small-grid">${latest.map(d => animalCard(getAnimal(d.animalId), { compact: true })).join('')}</div>` : `<div class="empty-state"><strong>No discoveries yet.</strong><p>Start with a pet, bug, bird, or animal nearby.</p><button type="button" class="btn green" data-route="discover">Start discovering</button></div>`}
    </section>
  `);
}

function categoryTile(cat) {
  const pct = cat.total ? Math.round(cat.found / cat.total * 100) : 0;
  const halfTarget = Math.max(1, Math.ceil(cat.total / 2));
  const mapRevealed = cat.found >= halfTarget;
  const thumbs = firstAnimalsFor(cat.id, 3);
  return `<button type="button" class="category-tile ${categoryClass(cat.id)} ${mapRevealed ? 'map-revealed' : 'map-mystery'}" data-route="journal" data-category="${cat.id}">
    <div class="tile-top"><span class="cat-icon">${cat.icon}</span><strong>${cat.label}</strong><em>${cat.found}/${cat.total}</em></div>
    <div class="thumb-stack">${thumbs.map((a, i) => `<span style="--i:${i}">${imgMarkup(a)}</span>`).join('')}<b class="map-question">?</b></div>
    <div class="mini-progress"><i style="width:${pct}%"></i></div>
    <small>${mapRevealed ? escapeHtml(cat.note) : `Find ${halfTarget} ${cat.label.toLowerCase()} animals to reveal this map clue.`}</small>
  </button>`;
}

function earnedBadges() {
  const counts = Object.fromEntries(categoryCounts().map(c => [c.id, c.found]));
  const found = completion().found;
  const repeat = Object.values(appState.discoveries).some(d => d.timesFound >= 3);
  const handmade = appState.customAnimals.some(a => a.published);
  return [
    { name: 'First Discovery', icon: '🌟', earned: found >= 1 },
    { name: 'Three Finds', icon: '🧭', earned: found >= 3 },
    { name: 'Ten Finds', icon: '🏆', earned: found >= 10 },
    { name: 'Pet Pal', icon: '🏡', earned: (counts.Pets || 0) >= 3 },
    { name: 'Farm Friend', icon: '🌿', earned: (counts.Farm || 0) >= 3 },
    { name: 'Bug Buddy', icon: '🔎', earned: (counts.Bugs || 0) >= 3 },
    { name: 'City Explorer', icon: '🏙️', earned: (counts.City || 0) >= 3 },
    { name: 'Wild Tracker', icon: '🌲', earned: (counts.Wild || 0) >= 2 },
    { name: 'Zoo Scout', icon: '🧭', earned: (counts.Zoo || 0) >= 3 },
    { name: 'Found Again', icon: '🔁', earned: repeat },
    { name: 'Handmade Helper', icon: '🎨', earned: handmade }
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
    <section class="panel discover-panel">
      <div class="discover-copy">
        <p class="eyebrow">Discover animal</p>
        <h1>What animal did you find?</h1>
        <p class="helper">Take or choose a photo. Then pick the animal from the journal list. The app keeps one small local photo for the card.</p>
      </div>
      <div class="camera-card">
        <label class="photo-drop">
          <input id="discoverPhotoInput" type="file" accept="image/*" capture="environment">
          ${pendingPhoto ? `<img src="${pendingPhoto}" alt="Selected discovery photo">` : `<span class="camera-icon">📷</span><strong>Take or choose photo</strong><small>Works best on a phone. Desktop can choose an image.</small>`}
        </label>
        <div class="actions center">
          <button type="button" class="btn green" data-action="chooseAnimal" ${pendingPhoto ? '' : 'disabled'}>Choose Animal</button>
          <button type="button" class="btn yellow" data-action="mystery" ${pendingPhoto ? '' : 'disabled'}>Mystery Animal</button>
          ${pendingPhoto ? '<button type="button" class="btn ghost" data-action="clearPhoto">Retake / Choose Again</button>' : ''}
        </div>
      </div>
    </section>
  `);
}

function renderPicker(params = {}) {
  const mode = params.mode || 'discover';
  const selectedCategory = params.category || 'All';
  const search = params.search || '';
  const sourceMystery = mode === 'linkMystery' ? appState.mysteries.find(m => m.id === params.mysteryId) : null;
  const list = allAnimals().filter(animal => {
    const matchCategory = selectedCategory === 'All' || animal.category === selectedCategory;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || animal.name.toLowerCase().includes(q) || animal.category.toLowerCase().includes(q) || String(animal.familyGroup || '').toLowerCase().includes(q);
    return matchCategory && matchSearch;
  });
  shell(`
    <section class="panel">
      <div class="section-head"><div><p class="eyebrow">Animal picker</p><h1>${mode === 'linkMystery' ? 'Link mystery to an animal' : 'Choose what you found'}</h1></div><button type="button" class="btn ghost" data-route="${mode === 'linkMystery' ? 'parentArea' : 'discover'}" data-tab="mysteries">Back</button></div>
      ${sourceMystery ? `<div class="mystery-preview"><img src="${sourceMystery.photo}" alt="Mystery photo"><div><strong>Mystery photo</strong><p class="helper">Pick an existing animal to unlock later for the child.</p></div></div>` : ''}
      <div class="picker-tools">
        <input id="animalSearch" class="search-input" placeholder="Search animal, category, or family..." value="${escapeHtml(search)}">
        <select id="animalCategorySelect">
          <option value="All">All categories</option>
          ${categoryCounts().map(c => `<option value="${c.id}" ${selectedCategory === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="animal-grid picker-grid">${list.map(animal => animalCard(animal, { action: 'selectAnimal', compact: true })).join('')}</div>
      ${mode === 'discover' ? '<div class="actions center"><button type="button" class="btn yellow" data-action="mystery">I can’t find it</button></div>' : ''}
    </section>
  `);
  document.getElementById('animalSearch')?.addEventListener('input', event => setRoute('picker', { ...params, search: event.target.value }));
  document.getElementById('animalCategorySelect')?.addEventListener('change', event => setRoute('picker', { ...params, category: event.target.value }));
}

function animalCard(animal, options = {}) {
  if (!animal) return '';
  const unlocked = isUnlocked(animal.id);
  const discovery = discoveryFor(animal.id);
  const action = options.action || 'detail';
  const compact = options.compact ? 'compact' : '';
  const revealLockedImage = Boolean(options.revealLockedImage) || action === 'selectAnimal';
  const cardState = unlocked ? 'unlocked' : (revealLockedImage ? 'locked picker-visible' : 'locked mystery-locked');
  const metaLine = (unlocked || revealLockedImage) ? `${escapeHtml(animal.category)} • ${escapeHtml(animal.size || 'Unknown')}` : 'Mystery shape';
  const stateLine = unlocked ? `Found ${discovery.timesFound || 1}x` : (revealLockedImage ? 'Tap to choose' : 'Find to reveal');
  return `<button type="button" class="animal-card ${categoryClass(animal.category)} ${cardState} ${compact}" data-action="${action}" data-id="${animal.id}">
    <div class="card-art">${imgMarkup(animal)}<span class="lock-mark">?</span></div>
    <div class="card-meta">
      <strong>${escapeHtml(animal.name)}</strong>
      <span>${metaLine}</span>
      <em>${stateLine}</em>
    </div>
  </button>`;
}

function renderJournal(category = 'All') {
  const c = completion();
  const cats = categoryCounts();
  const filtered = allAnimals().filter(animal => category === 'All' || animal.category === category);
  shell(`
    <section class="journal-hero panel">
      <div><p class="eyebrow">Animal journal</p><h1>Color cards are found. Grey cards are waiting.</h1><p class="helper">Names stay visible so kids know what to look for next.</p></div>
      ${progressBar(c)}
    </section>
    <div class="journal-categories">
      <button type="button" class="journal-cat ${category === 'All' ? 'active' : ''}" data-route="journal" data-category="All"><span>📖</span><strong>All</strong><em>${c.found}/${c.total}</em></button>
      ${cats.map(cat => `<button type="button" class="journal-cat ${category === cat.id ? 'active' : ''} ${categoryClass(cat.id)}" data-route="journal" data-category="${cat.id}">
        <span class="cat-imgs">${firstAnimalsFor(cat.id, 2).map(a => imgMarkup(a)).join('')}</span><strong>${cat.label}</strong><em>${cat.found}/${cat.total}</em>
      </button>`).join('')}
    </div>
    <section class="panel">
      <div class="section-head compact"><h2>${category === 'All' ? 'All Animals' : categoryInfo(category).label}</h2><span>${filtered.filter(a => isUnlocked(a.id)).length}/${filtered.length}</span></div>
      <div class="animal-grid">${filtered.map(animal => animalCard(animal)).join('')}</div>
    </section>
  `);
}

function renderDetail(id) {
  const animal = getAnimal(id);
  if (!animal) return setRoute('journal');
  const unlocked = isUnlocked(animal.id);
  const discovery = discoveryFor(animal.id);
  shell(`
    <section class="detail-card ${categoryClass(animal.category)} ${unlocked ? 'unlocked' : 'locked-detail'}">
      <button type="button" class="back-btn" data-route="journal">← Back to Journal</button>
      <div class="detail-layout">
        <div class="detail-art">${imgMarkup(animal)}</div>
        <div class="detail-info">
          <div class="badge-row"><span class="badge earned">${escapeHtml(animal.category)}</span>${animal.isCustom ? '<span class="badge earned">🎨 Handmade</span>' : ''}${!unlocked ? '<span class="badge">Locked</span>' : ''}</div>
          <h1>${escapeHtml(animal.name)}</h1>
          <p class="helper">${unlocked ? escapeHtml(animal.funFact || 'A new animal friend for your journal.') : 'Discover this animal to unlock the full learning card.'}</p>
          <div class="fact-grid ${unlocked ? '' : 'soft-locked'}">
            <div class="fact"><span>Size</span><strong>${escapeHtml(animal.size || 'Unknown')}</strong></div>
            <div class="fact"><span>Explorer skill</span><strong>${escapeHtml(animal.explorerSkill || 'Explorer')}</strong></div>
            <div class="fact"><span>Eats</span><strong>${escapeHtml(asList(animal.eats).join(', ') || 'Unknown')}</strong></div>
            <div class="fact"><span>Lives in</span><strong>${escapeHtml(asList(animal.livesIn).join(', ') || 'Unknown')}</strong></div>
            <div class="fact"><span>Animal type</span><strong>${escapeHtml(animal.animalClass || 'Animal')}</strong></div>
            <div class="fact"><span>Family</span><strong>${escapeHtml(animal.familyGroup || animal.animalClass || 'Animal')}</strong></div>
          </div>
          ${unlocked ? `<div class="discovery-box"><div>${discovery.latestPhoto ? `<img src="${discovery.latestPhoto}" alt="Latest discovery photo">` : '<span>No photo saved.</span>'}</div><p><strong>Found ${discovery.timesFound || 1} time${(discovery.timesFound || 1) === 1 ? '' : 's'}.</strong><br>First found: ${formatDate(discovery.firstDiscoveredAt)}<br>Last found: ${formatDate(discovery.lastDiscoveredAt)}</p></div>` : ''}
          <div class="actions"><button type="button" class="btn green" data-route="discover">${unlocked ? 'Find Again' : 'Discover This Animal'}</button></div>
        </div>
      </div>
    </section>
  `);
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

function renderQuiz() {
  const discovered = allAnimals().filter(a => isUnlocked(a.id));
  if (discovered.length < 3) {
    shell(`<section class="panel empty-state large"><p class="eyebrow">Quiz</p><h1>Discover 3 animals to unlock quiz play.</h1><p>Quizzes only use animals already found.</p><button type="button" class="btn green" data-route="discover">Discover Animal</button></section>`);
    return;
  }
  quizDraft = quizDraft && quizDraft.options.every(id => discovered.some(a => a.id === id)) ? quizDraft : createQuiz(discovered);
  const options = quizDraft.options.map(id => getAnimal(id)).filter(Boolean);
  shell(`
    <section class="panel quiz-panel">
      <p class="eyebrow">Explorer quiz</p>
      <h1>${escapeHtml(quizDraft.question)}</h1>
      <p class="helper">Tap every card that matches. Questions use only animals already discovered.</p>
      <div class="animal-grid quiz-grid">${options.map(animal => animalCard(animal, { action: 'quizSelect', compact: true })).join('')}</div>
      <div class="actions center"><button type="button" class="btn green" data-action="checkQuiz">Check Answer</button><button type="button" class="btn ghost" data-action="newQuiz">New Quiz</button></div>
      <div id="quizFeedback" class="quiz-feedback"></div>
    </section>
  `);
  quizDraft.selected.forEach(id => document.querySelector(`[data-action="quizSelect"][data-id="${CSS.escape(id)}"]`)?.classList.add('selected'));
}

function createQuiz(discovered) {
  const types = [];
  const categories = [...new Set(discovered.map(a => a.category))].filter(cat => discovered.some(a => a.category === cat) && discovered.some(a => a.category !== cat));
  categories.forEach(cat => types.push({ question: `Which animals are ${cat} animals?`, match: a => a.category === cat }));
  const classes = [...new Set(discovered.map(a => a.animalClass).filter(Boolean))].filter(cls => discovered.some(a => a.animalClass === cls) && discovered.some(a => a.animalClass !== cls));
  classes.forEach(cls => types.push({ question: `Which animals are ${cls}s?`, match: a => a.animalClass === cls }));
  const eatsPlants = discovered.some(a => asList(a.eats).some(e => /plant|grass|leaf|leaves|nectar|seed|fruit|hay|grain/i.test(e))) && discovered.some(a => !asList(a.eats).some(e => /plant|grass|leaf|leaves|nectar|seed|fruit|hay|grain/i.test(e)));
  if (eatsPlants) types.push({ question: 'Which animals eat plants, seeds, leaves, or nectar?', match: a => asList(a.eats).some(e => /plant|grass|leaf|leaves|nectar|seed|fruit|hay|grain/i.test(e)) });
  const target = types[Math.floor(Math.random() * types.length)] || { question: 'Which animals have you discovered?', match: () => true };
  const matches = discovered.filter(target.match);
  const nonMatches = discovered.filter(a => !target.match(a));
  const chosen = shuffle([...shuffle(matches).slice(0, 3), ...shuffle(nonMatches).slice(0, 3)]).slice(0, 6);
  return { question: target.question, answers: chosen.filter(target.match).map(a => a.id), options: chosen.map(a => a.id), selected: [] };
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
  if (action === 'quizSelect') return toggleQuizCard(actionEl, id);
  if (action === 'checkQuiz') return checkQuiz();
  if (action === 'newQuiz') { quizDraft = null; return renderQuiz(); }
  if (action === 'manualUnlock') return setRoute('picker', { mode: 'manual' });
  if (action === 'linkMystery') return setRoute('picker', { mode: 'linkMystery', mysteryId: id });
  if (action === 'deleteMystery') return deleteMystery(id);
  if (action === 'export') return exportData();
  if (action === 'deletePhotos') return deletePhotos();
  if (action === 'resetDiscoveries') return resetDiscoveries();
  if (action === 'openReveal') return openReveal(id);
});

async function selectAnimal(id) {
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

function toggleQuizCard(card, id) {
  if (!quizDraft) return;
  const set = new Set(quizDraft.selected);
  if (set.has(id)) set.delete(id); else set.add(id);
  quizDraft.selected = [...set];
  card.classList.toggle('selected');
}

function checkQuiz() {
  if (!quizDraft) return;
  const selected = [...quizDraft.selected].sort().join('|');
  const answers = [...quizDraft.answers].sort().join('|');
  const feedback = document.getElementById('quizFeedback');
  if (!feedback) return;
  if (selected === answers) {
    feedback.className = 'quiz-feedback good';
    feedback.textContent = 'Correct! Great exploring.';
  } else {
    const names = quizDraft.answers.map(id => getAnimal(id)?.name).filter(Boolean).join(', ');
    feedback.className = 'quiz-feedback try';
    feedback.textContent = `Try again. The matching animals are: ${names}.`;
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
