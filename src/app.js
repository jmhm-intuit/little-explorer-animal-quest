const DB_NAME = 'little-explorer-animal-quest-db';
const DB_VERSION = 1;
const BASE_PATH = new URL('../', import.meta.url).pathname;
const DATA_URL = BASE_PATH + 'data/animals.json';

const CATEGORIES = [
  { id: 'Pets', label: 'Pets', slug: 'pets', note: 'Animals that can live with families.' },
  { id: 'Farm', label: 'Farm', slug: 'farm', note: 'Animals found on farms and fields.' },
  { id: 'Bugs', label: 'Bugs', slug: 'bugs', note: 'Tiny animals and little creatures.' },
  { id: 'City', label: 'City', slug: 'city', note: 'Animals seen in parks, yards, and neighborhoods.' },
  { id: 'Wild', label: 'Wild', slug: 'wild', note: 'Animals that live more freely in nature.' },
  { id: 'Zoo', label: 'Zoo', slug: 'zoo', note: 'Big world animals often seen at zoos.' },
  { id: 'Other', label: 'Other', slug: 'other', note: 'Special handmade discoveries.' }
];

const DEFAULT_SETTINGS = {
  cameraEnabled: true,
  manualUnlockEnabled: false,
  soundsEnabled: false
};

const app = document.getElementById('app');

let db;
let cameraStream = null;
let state = {
  screen: 'home',
  params: {},
  animals: [],
  customAnimals: [],
  discoveries: [],
  mysteries: [],
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  readyReveals: [],
  parentUnlocked: false,
  parentChallenge: null,
  pendingPhoto: null,
  pickerMode: 'discover',
  sourceMysteryId: null,
  pickerCategory: 'All',
  pickerSearch: '',
  journalCategory: 'All',
  toastTimer: null,
  quiz: null,
  handmadeImageData: null
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const slugify = (value = '') => String(value)
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || `animal-${Date.now()}`;

const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const byName = (a, b) => a.name.localeCompare(b.name);
const categorySlug = (category) => (CATEGORIES.find(c => c.id === category)?.slug || 'other');
const categoryClass = (category) => `category-${categorySlug(category)}`;
const categoryLabel = (category) => CATEGORIES.find(c => c.id === category)?.label || category || 'Other';
const asList = (value) => Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map(v => v.trim()).filter(Boolean);

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('discoveries')) database.createObjectStore('discoveries', { keyPath: 'animalId' });
      if (!database.objectStoreNames.contains('customAnimals')) database.createObjectStore('customAnimals', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('mysteries')) database.createObjectStore('mysteries', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txStore(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getItem(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function putItem(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName, 'readwrite').put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function deleteItem(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName, 'readwrite').delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName, 'readwrite').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function kvGet(key, fallback = null) {
  const record = await getItem('kv', key);
  return record ? record.value : fallback;
}

async function kvSet(key, value) {
  return putItem('kv', { key, value });
}

async function loadState() {
  const response = await fetch(DATA_URL);
  state.animals = await response.json();
  state.customAnimals = await getAll('customAnimals');
  state.discoveries = await getAll('discoveries');
  state.mysteries = await getAll('mysteries');
  state.profile = await kvGet('profile', null);
  state.settings = { ...DEFAULT_SETTINGS, ...(await kvGet('settings', {})) };
  state.readyReveals = await kvGet('readyReveals', []);
}

function allAnimals() {
  return [
    ...state.animals,
    ...state.customAnimals.filter(animal => animal.published)
  ].sort((a, b) => {
    const ca = CATEGORIES.findIndex(c => c.id === a.category);
    const cb = CATEGORIES.findIndex(c => c.id === b.category);
    return ca === cb ? a.name.localeCompare(b.name) : ca - cb;
  });
}

function getAnimal(animalId) {
  return allAnimals().find(animal => animal.id === animalId) || state.customAnimals.find(animal => animal.id === animalId) || state.animals.find(animal => animal.id === animalId);
}

function discoveryFor(animalId) {
  return state.discoveries.find(discovery => discovery.animalId === animalId) || null;
}

function isUnlocked(animalId) {
  return Boolean(discoveryFor(animalId));
}

function completion() {
  const animals = allAnimals();
  const found = animals.filter(animal => isUnlocked(animal.id)).length;
  const total = animals.length;
  return { found, total, pct: total ? Math.round((found / total) * 100) : 0 };
}

function categoryCounts() {
  const animals = allAnimals();
  return CATEGORIES.filter(cat => animals.some(animal => animal.category === cat.id)).map(cat => {
    const list = animals.filter(animal => animal.category === cat.id);
    return {
      ...cat,
      total: list.length,
      found: list.filter(animal => isUnlocked(animal.id)).length
    };
  });
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  state.toastTimer = window.setTimeout(() => toast.remove(), 2400);
}

function progressMarkup({ found, total, pct }) {
  return `
    <div class="progress-card">
      <div class="progress-label"><span>Animal Journal</span><span>${found} / ${total}</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <p class="helper small">Published handmade animals join the journal when they are ready.</p>
    </div>`;
}

function animalImage(animal, className = 'animal-img') {
  const src = animal.imageData || animal.image;
  if (!src) {
    return `<div class="${className} placeholder-img" aria-label="No image yet">?</div>`;
  }
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(animal.name)}" loading="lazy">`;
}

function animalCard(animal, options = {}) {
  const unlocked = isUnlocked(animal.id);
  const selectable = options.selectable !== false;
  const extraClass = options.extraClass || '';
  const customBadge = animal.isCustom ? '<span class="badge custom">Handmade</span>' : '';
  const foundBadge = unlocked ? `<span class="badge filled">Found ${discoveryFor(animal.id)?.timesFound || 1}x</span>` : '<span class="badge">Locked</span>';
  const tag = selectable ? 'button' : 'div';
  const action = selectable ? `data-animal-id="${escapeHtml(animal.id)}"` : '';
  return `
    <${tag} class="animal-card ${categoryClass(animal.category)} ${unlocked ? 'unlocked' : 'locked'} ${extraClass}" ${action}>
      <div class="lock-mark">?</div>
      <div class="animal-img-wrap">${animalImage(animal)}</div>
      <div class="card-title">
        <strong>${escapeHtml(animal.name)}</strong>
        <span>${escapeHtml(categoryLabel(animal.category))} - ${escapeHtml(animal.size || 'Unknown')}</span>
        <div class="badges">${customBadge}${options.showFound === false ? '' : foundBadge}</div>
      </div>
    </${tag}>`;
}

function render(content, active = state.screen) {
  const c = completion();
  app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand">
          <div class="brand-mark"><img src="${BASE_PATH}icons/icon-192.svg" alt="Animal Quest"></div>
          <div>
            <h1>Little Explorer: Animal Quest</h1>
            <p>Discover real animals. Unlock your animal journal.</p>
          </div>
        </div>
        <div class="status-pill">${c.found} / ${c.total} found</div>
      </header>
      <main class="screen">${content}</main>
      <nav class="navbar" aria-label="Main navigation">
        ${navButton('home', 'Home', active)}
        ${navButton('discover', 'Discover', active)}
        ${navButton('journal', 'Journal', active)}
        ${navButton('quiz', 'Quiz', active)}
        ${navButton('parent', 'Parent', active)}
      </nav>
    </div>`;
  bindNav();
}

function navButton(screen, label, active) {
  return `<button class="nav-btn ${active === screen ? 'active' : ''}" data-nav="${screen}">${label}</button>`;
}

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(button => {
    button.addEventListener('click', () => go(button.dataset.nav));
  });
}

async function go(screen, params = {}) {
  stopCamera();
  state.screen = screen;
  state.params = params;
  if (screen !== 'animalPicker') {
    state.pickerMode = 'discover';
    state.sourceMysteryId = null;
  }
  switch (screen) {
    case 'home': return renderHome();
    case 'discover': return renderDiscover();
    case 'animalPicker': return renderAnimalPicker(params);
    case 'journal': return renderJournal(params.category || state.journalCategory || 'All');
    case 'detail': return renderAnimalDetail(params.id);
    case 'unlock': return renderUnlock(params.animalId, params.wasAlreadyFound);
    case 'quiz': return renderQuiz();
    case 'profile': return renderProfile();
    case 'parent': return renderParentGate();
    case 'parentArea': return renderParentArea(params.tab || 'overview');
    case 'handmade': return renderHandmadeForm(params);
    case 'mysterySubmitted': return renderMysterySubmitted();
    case 'reveal': return renderReadyReveal(params.id);
    default: return renderHome();
  }
}

function renderHome() {
  const c = completion();
  const featured = getAnimal('squirrel') || allAnimals()[0];
  const latest = [...state.discoveries].sort((a, b) => String(b.lastDiscoveredAt).localeCompare(String(a.lastDiscoveredAt))).slice(0, 4);
  const badges = computeBadges();
  const revealAlert = state.readyReveals.length ? `
    <div class="alert">
      <span>New animal discovery ready. A grown-up studied your mystery animal.</span>
      <button class="btn yellow" id="openReveal">Reveal</button>
    </div>` : '';

  render(`
    ${revealAlert}
    <section class="panel hero">
      <div>
        <h2>Go outside. Find animals. Unlock your journal.</h2>
        <p>Take a photo of a real animal, choose what you found, and add it to your animal journal. This app is built to help kids explore the real world.</p>
        <div class="actions">
          <button class="btn primary" id="startDiscover">Discover Animal</button>
          <button class="btn yellow" id="openJournal">Open Journal</button>
        </div>
      </div>
      <div class="hero-art">${featured ? animalImage(featured, 'animal-img') : ''}</div>
    </section>

    <section class="grid two">
      ${progressMarkup(c)}
      <div class="progress-card">
        <div class="progress-label"><span>Explorer</span><span>${state.profile ? escapeHtml(state.profile.name) : 'Set up'}</span></div>
        <p class="helper">Create a local explorer card for the child or shared family explorers.</p>
        <button class="btn purple" id="editProfile">${state.profile ? 'Edit Profile' : 'Create Profile'}</button>
      </div>
    </section>

    <section class="panel compact">
      <h3>Badges</h3>
      <div class="badges">${badges.map(badge => `<span class="badge ${badge.earned ? 'filled' : ''}">${escapeHtml(badge.name)}</span>`).join('')}</div>
    </section>

    <section class="panel compact">
      <h3>Recent discoveries</h3>
      ${latest.length ? `<div class="animal-grid">${latest.map(discovery => animalCard(getAnimal(discovery.animalId), { selectable: true })).join('')}</div>` : '<div class="empty-state"><strong>No discoveries yet.</strong><p class="helper">Start with an animal nearby, like a pet, bug, or bird.</p></div>'}
    </section>
  `, 'home');

  document.getElementById('startDiscover')?.addEventListener('click', () => go('discover'));
  document.getElementById('openJournal')?.addEventListener('click', () => go('journal'));
  document.getElementById('editProfile')?.addEventListener('click', () => go('profile'));
  document.getElementById('openReveal')?.addEventListener('click', () => go('reveal', { id: state.readyReveals[0].id }));
  bindAnimalDetailLinks();
}

function computeBadges() {
  const c = completion();
  const counts = Object.fromEntries(categoryCounts().map(cat => [cat.id, cat.found]));
  const repeat = state.discoveries.some(d => d.timesFound >= 3);
  const handmade = state.customAnimals.some(a => a.published);
  return [
    { name: 'First Discovery', earned: c.found >= 1 },
    { name: 'Three Finds', earned: c.found >= 3 },
    { name: 'Ten Finds', earned: c.found >= 10 },
    { name: 'Pet Pal', earned: (counts.Pets || 0) >= 3 },
    { name: 'Farm Friend', earned: (counts.Farm || 0) >= 3 },
    { name: 'Bug Buddy', earned: (counts.Bugs || 0) >= 3 },
    { name: 'City Explorer', earned: (counts.City || 0) >= 3 },
    { name: 'Wild Tracker', earned: (counts.Wild || 0) >= 2 },
    { name: 'Zoo Scout', earned: (counts.Zoo || 0) >= 3 },
    { name: 'Found Again', earned: repeat },
    { name: 'Handmade Helper', earned: handmade }
  ];
}

async function renderProfile() {
  const profile = state.profile || {};
  render(`
    <section class="panel">
      <h2>Explorer Profile</h2>
      <p class="helper">This profile stays on this device. It can be one child or shared explorers like Simon and Olivia.</p>
      <form id="profileForm" class="form">
        <div class="field">
          <label for="profileName">Explorer name</label>
          <input class="input" id="profileName" value="${escapeHtml(profile.name || '')}" placeholder="Example: Simon and Olivia" required>
        </div>
        <div class="field">
          <label for="favoriteAnimal">Favorite animal</label>
          <input class="input" id="favoriteAnimal" value="${escapeHtml(profile.favoriteAnimal || '')}" placeholder="Example: Turtle">
        </div>
        <div class="field">
          <label for="avatarInput">Avatar image</label>
          <input class="input" id="avatarInput" type="file" accept="image/*">
          <p class="helper small">Optional. A small local copy will be saved in the app.</p>
        </div>
        ${profile.avatarData ? `<img class="preview-photo" style="max-width:220px" src="${profile.avatarData}" alt="Avatar preview">` : ''}
        <div class="actions">
          <button class="btn primary" type="submit">Save Profile</button>
          <button class="btn ghost" type="button" id="backHome">Back Home</button>
        </div>
      </form>
    </section>
  `, 'home');

  let newAvatar = profile.avatarData || null;
  document.getElementById('avatarInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) {
      newAvatar = await compressImage(file, 256, 0.72);
      showToast('Avatar ready to save.');
    }
  });
  document.getElementById('profileForm').addEventListener('submit', async event => {
    event.preventDefault();
    state.profile = {
      name: document.getElementById('profileName').value.trim() || 'Little Explorer',
      favoriteAnimal: document.getElementById('favoriteAnimal').value.trim(),
      avatarData: newAvatar,
      updatedAt: nowIso()
    };
    await kvSet('profile', state.profile);
    showToast('Profile saved.');
    go('home');
  });
  document.getElementById('backHome').addEventListener('click', () => go('home'));
}

function renderDiscover() {
  const canSkip = state.parentUnlocked && state.settings.manualUnlockEnabled;
  render(`
    <section class="panel">
      <h2>Discover Animal</h2>
      <p class="helper">Take a photo first. Then choose the animal you found. The app does not try to guess the animal for you.</p>
      <div class="grid two">
        <div class="progress-card">
          <h3>Photo first</h3>
          <p class="helper">Use the phone camera or pick a photo. The app stores one small local copy for the animal card.</p>
          <input id="photoInput" class="hidden" type="file" accept="image/*" capture="environment">
          <div class="actions">
            <button class="btn primary" id="photoButton">Take or Choose Photo</button>
            ${state.settings.cameraEnabled ? '<button class="btn blue" id="liveCameraButton">Open Live Camera</button>' : ''}
          </div>
        </div>
        <div class="progress-card">
          <h3>Mystery discoveries</h3>
          <p class="helper">If the animal is not in the list, save it as a mystery. A grown-up can study it later.</p>
          ${canSkip ? '<button class="btn ghost" id="manualUnlockButton">Parent manual unlock</button>' : '<p class="helper small">Parent manual unlock is available only in Parent settings.</p>'}
        </div>
      </div>
      <div id="cameraMount" class="camera-box"></div>
    </section>
  `, 'discover');

  document.getElementById('photoButton').addEventListener('click', () => document.getElementById('photoInput').click());
  document.getElementById('photoInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.pendingPhoto = await compressImage(file, 640, 0.68);
    state.pickerMode = 'discover';
    go('animalPicker');
  });
  document.getElementById('liveCameraButton')?.addEventListener('click', startLiveCamera);
  document.getElementById('manualUnlockButton')?.addEventListener('click', () => {
    state.pendingPhoto = null;
    state.pickerMode = 'manualUnlock';
    go('animalPicker');
  });
}

async function startLiveCamera() {
  const mount = document.getElementById('cameraMount');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    mount.innerHTML = `
      <video id="cameraVideo" class="camera-video" autoplay playsinline></video>
      <div class="actions">
        <button class="btn primary" id="captureButton">Capture Photo</button>
        <button class="btn ghost" id="cancelCameraButton">Cancel</button>
      </div>`;
    const video = document.getElementById('cameraVideo');
    video.srcObject = cameraStream;
    document.getElementById('captureButton').addEventListener('click', async () => {
      state.pendingPhoto = await captureVideoFrame(video, 640, 0.68);
      stopCamera();
      state.pickerMode = 'discover';
      go('animalPicker');
    });
    document.getElementById('cancelCameraButton').addEventListener('click', () => {
      stopCamera();
      mount.innerHTML = '';
    });
  } catch (error) {
    showToast('Live camera could not open. Use Take or Choose Photo instead.');
  }
}

function captureVideoFrame(video, maxDimension = 640, quality = 0.68) {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(maxDimension / video.videoWidth, maxDimension / video.videoHeight, 1);
  canvas.width = Math.round(video.videoWidth * ratio) || maxDimension;
  canvas.height = Math.round(video.videoHeight * ratio) || maxDimension;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return Promise.resolve(canvas.toDataURL('image/jpeg', quality));
}

function compressImage(file, maxDimension = 640, quality = 0.68) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const ratio = Math.min(maxDimension / img.width, maxDimension / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        const mime = file.type === 'image/png' && maxDimension > 800 ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, mime === 'image/jpeg' ? quality : undefined));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderAnimalPicker() {
  const mode = state.pickerMode || 'discover';
  const title = mode === 'parentLink' ? 'Link Mystery to Existing Animal' : mode === 'manualUnlock' ? 'Parent Manual Unlock' : 'What did you discover?';
  const subtitle = mode === 'parentLink'
    ? 'Choose the animal that matches the mystery photo. The child will see a reveal on the home screen.'
    : mode === 'manualUnlock'
      ? 'Choose an animal to unlock without a photo. This is inside the parent flow only.'
      : 'Pick from the journal list. If it is not here, save it as a mystery for a grown-up.';

  const animals = filteredPickerAnimals();
  render(`
    <section class="panel">
      <h2>${title}</h2>
      <p class="helper">${subtitle}</p>
      ${state.pendingPhoto ? `<img class="preview-photo" src="${state.pendingPhoto}" alt="Discovery photo preview">` : '<div class="empty-state"><strong>No photo attached.</strong><p class="helper">This should only happen in parent manual unlock.</p></div>'}
      <div class="grid two">
        <div class="field">
          <label for="animalSearch">Search</label>
          <input id="animalSearch" class="input" value="${escapeHtml(state.pickerSearch)}" placeholder="Dog, frog, bee...">
        </div>
        <div class="field">
          <label for="animalCategory">Filter</label>
          <select id="animalCategory" class="select">
            <option value="All" ${state.pickerCategory === 'All' ? 'selected' : ''}>All categories</option>
            ${CATEGORIES.filter(cat => cat.id !== 'Other' || state.customAnimals.some(a => a.published)).map(cat => `<option value="${cat.id}" ${state.pickerCategory === cat.id ? 'selected' : ''}>${cat.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="animal-grid" id="pickerGrid">
        ${animals.map(animal => animalCard(animal, { showFound: true })).join('')}
      </div>
      <div class="actions">
        ${mode === 'discover' ? '<button class="btn yellow" id="mysteryButton">This is a mystery animal</button><button class="btn ghost" id="retakeButton">Retake photo</button>' : ''}
        <button class="btn ghost" id="cancelPicker">Cancel</button>
      </div>
    </section>
  `, mode === 'parentLink' || mode === 'manualUnlock' ? 'parent' : 'discover');

  document.getElementById('animalSearch').addEventListener('input', event => {
    state.pickerSearch = event.target.value;
    renderAnimalPicker();
  });
  document.getElementById('animalCategory').addEventListener('change', event => {
    state.pickerCategory = event.target.value;
    renderAnimalPicker();
  });
  document.querySelectorAll('[data-animal-id]').forEach(button => {
    button.addEventListener('click', () => handlePickerSelection(button.dataset.animalId));
  });
  document.getElementById('mysteryButton')?.addEventListener('click', saveMysteryDiscovery);
  document.getElementById('retakeButton')?.addEventListener('click', () => go('discover'));
  document.getElementById('cancelPicker').addEventListener('click', () => mode === 'parentLink' || mode === 'manualUnlock' ? go('parentArea', { tab: 'mysteries' }) : go('discover'));
}

function filteredPickerAnimals() {
  const query = state.pickerSearch.toLowerCase().trim();
  return allAnimals()
    .filter(animal => state.pickerCategory === 'All' || animal.category === state.pickerCategory)
    .filter(animal => !query || `${animal.name} ${animal.category} ${animal.animalClass} ${animal.familyGroup}`.toLowerCase().includes(query));
}

async function handlePickerSelection(animalId) {
  if (state.pickerMode === 'parentLink') {
    const mystery = state.mysteries.find(item => item.id === state.sourceMysteryId);
    await addReadyReveal({
      type: 'existing',
      animalId,
      sourceMysteryId: mystery?.id,
      photoData: mystery?.photoData || state.pendingPhoto || null
    });
    if (mystery) {
      mystery.status = 'linked';
      mystery.linkedAnimalId = animalId;
      mystery.updatedAt = nowIso();
      await putItem('mysteries', mystery);
      state.mysteries = await getAll('mysteries');
    }
    state.pendingPhoto = null;
    state.sourceMysteryId = null;
    state.pickerMode = 'discover';
    showToast('Reveal is ready for the child.');
    return go('parentArea', { tab: 'mysteries' });
  }
  if (state.pickerMode === 'manualUnlock') {
    const already = Boolean(discoveryFor(animalId));
    await unlockAnimal(animalId, null);
    return go('unlock', { animalId, wasAlreadyFound: already });
  }
  const already = Boolean(discoveryFor(animalId));
  await unlockAnimal(animalId, state.pendingPhoto);
  state.pendingPhoto = null;
  return go('unlock', { animalId, wasAlreadyFound: already });
}

async function unlockAnimal(animalId, photoData = null) {
  const existing = discoveryFor(animalId);
  const discovery = existing || {
    animalId,
    timesFound: 0,
    firstDiscoveredAt: nowIso()
  };
  discovery.timesFound = (discovery.timesFound || 0) + 1;
  discovery.lastDiscoveredAt = nowIso();
  if (photoData) discovery.latestPhoto = photoData;
  await putItem('discoveries', discovery);
  state.discoveries = await getAll('discoveries');

  const custom = state.customAnimals.find(animal => animal.id === animalId);
  if (custom && !custom.revealed) {
    custom.revealed = true;
    custom.updatedAt = nowIso();
    await putItem('customAnimals', custom);
    state.customAnimals = await getAll('customAnimals');
  }
}

async function saveMysteryDiscovery() {
  if (!state.pendingPhoto) {
    showToast('Take a photo first.');
    return;
  }
  const mystery = {
    id: uid('mystery'),
    photoData: state.pendingPhoto,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await putItem('mysteries', mystery);
  state.mysteries = await getAll('mysteries');
  state.pendingPhoto = null;
  go('mysterySubmitted');
}

function renderMysterySubmitted() {
  render(`
    <section class="panel hero">
      <div>
        <h2>Mystery saved.</h2>
        <p>Your animal is not in the journal yet. A grown-up can study the mystery and add the right card later.</p>
        <div class="actions">
          <button class="btn primary" id="homeButton">Back Home</button>
          <button class="btn yellow" id="journalButton">Open Journal</button>
        </div>
      </div>
      <div class="hero-art"><strong style="font-size:6rem">?</strong></div>
    </section>
  `, 'discover');
  document.getElementById('homeButton').addEventListener('click', () => go('home'));
  document.getElementById('journalButton').addEventListener('click', () => go('journal'));
}

function renderUnlock(animalId, wasAlreadyFound = false) {
  const animal = getAnimal(animalId);
  const discovery = discoveryFor(animalId);
  render(`
    <section class="panel hero">
      <div>
        <h2>${wasAlreadyFound ? 'Found again.' : 'Animal unlocked.'}</h2>
        <p>${escapeHtml(animal.name)} is now in your animal journal. You have found this animal ${discovery?.timesFound || 1} time${(discovery?.timesFound || 1) === 1 ? '' : 's'}.</p>
        <div class="badges">
          <span class="badge filled">${escapeHtml(animal.category)}</span>
          <span class="badge filled">${escapeHtml(animal.size)}</span>
          <span class="badge filled">${escapeHtml(animal.explorerSkill)}</span>
        </div>
        <div class="actions">
          <button class="btn primary" id="openCard">Open Card</button>
          <button class="btn yellow" id="backHome">Back Home</button>
        </div>
      </div>
      <div class="hero-art ${categoryClass(animal.category)}">${animalImage(animal)}</div>
    </section>
  `, 'discover');
  document.getElementById('openCard').addEventListener('click', () => go('detail', { id: animalId }));
  document.getElementById('backHome').addEventListener('click', () => go('home'));
}

function renderJournal(category = 'All') {
  state.journalCategory = category;
  const animals = allAnimals().filter(animal => category === 'All' || animal.category === category);
  const c = completion();
  const cats = categoryCounts();
  render(`
    <section class="panel">
      <h2>Animal Journal</h2>
      <p class="helper">Color cards are discovered. Grey cards are waiting to be found. Names stay visible so kids know what to look for next.</p>
      ${progressMarkup(c)}
      <div class="category-strip">
        <button class="chip ${category === 'All' ? 'active' : ''}" data-category="All">All ${c.found}/${c.total}</button>
        ${cats.map(cat => `<button class="chip ${category === cat.id ? 'active' : ''}" data-category="${cat.id}">${cat.label} ${cat.found}/${cat.total}</button>`).join('')}
      </div>
      <div class="animal-grid">
        ${animals.map(animal => animalCard(animal)).join('')}
      </div>
    </section>
  `, 'journal');

  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => renderJournal(button.dataset.category)));
  bindAnimalDetailLinks();
}

function bindAnimalDetailLinks() {
  document.querySelectorAll('[data-animal-id]').forEach(button => {
    button.addEventListener('click', () => go('detail', { id: button.dataset.animalId }));
  });
}

function renderAnimalDetail(animalId) {
  const animal = getAnimal(animalId);
  if (!animal) return go('journal');
  const discovery = discoveryFor(animalId);
  const unlocked = Boolean(discovery);
  render(`
    <section class="panel">
      <div class="actions">
        <button class="btn ghost" id="backJournal">Back to Journal</button>
        ${unlocked ? '<button class="btn primary" id="findAgain">Find Again</button>' : '<button class="btn primary" id="discoverThis">Discover This Animal</button>'}
      </div>
      <div class="detail-layout">
        <div class="detail-portrait ${categoryClass(animal.category)} ${unlocked ? '' : 'locked'}">
          ${animalImage(animal)}
        </div>
        <div class="grid">
          <div>
            <div class="badges"><span class="badge filled">${escapeHtml(animal.category)}</span>${animal.isCustom ? '<span class="badge custom">Handmade</span>' : ''}</div>
            <h2>${escapeHtml(animal.name)}</h2>
            <p class="helper">${unlocked ? escapeHtml(animal.funFact || 'A new animal friend for the journal.') : 'Discover this animal to unlock the full learning card.'}</p>
          </div>
          <div class="fact-grid">
            <div class="fact"><span>Size</span><strong>${escapeHtml(animal.size || 'Unknown')}</strong></div>
            <div class="fact"><span>Explorer skill</span><strong>${escapeHtml(animal.explorerSkill || 'Explorer')}</strong></div>
            <div class="fact"><span>Eats</span><strong>${escapeHtml(asList(animal.eats).join(', ') || 'Unknown')}</strong></div>
            <div class="fact"><span>Lives in</span><strong>${escapeHtml(asList(animal.livesIn).join(', ') || 'Unknown')}</strong></div>
            <div class="fact"><span>Animal type</span><strong>${escapeHtml(animal.animalClass || 'Animal')}</strong></div>
            <div class="fact"><span>Animal family</span><strong>${escapeHtml(animal.familyGroup || 'Animal')}</strong></div>
          </div>
          ${unlocked ? `
            <div class="grid two">
              <div class="progress-card"><strong>Found ${discovery.timesFound || 1} time${(discovery.timesFound || 1) === 1 ? '' : 's'}</strong><p class="helper small">First found: ${formatDate(discovery.firstDiscoveredAt)}<br>Last found: ${formatDate(discovery.lastDiscoveredAt)}</p></div>
              <div class="progress-card">${discovery.latestPhoto ? `<img class="preview-photo" src="${discovery.latestPhoto}" alt="Latest discovery photo">` : '<p class="helper">No photo stored for this animal.</p>'}</div>
            </div>` : ''}
        </div>
      </div>
    </section>
  `, 'journal');
  document.getElementById('backJournal').addEventListener('click', () => go('journal'));
  document.getElementById('findAgain')?.addEventListener('click', () => go('discover'));
  document.getElementById('discoverThis')?.addEventListener('click', () => go('discover'));
}

function formatDate(value) {
  if (!value) return 'Not yet';
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
  } catch (_) {
    return value;
  }
}

function discoveredAnimals() {
  return allAnimals().filter(animal => isUnlocked(animal.id));
}

function renderQuiz() {
  const animals = discoveredAnimals();
  if (animals.length < 3) {
    render(`
      <section class="panel">
        <h2>Journal Quiz</h2>
        <div class="empty-state">
          <strong>Discover a few animals first.</strong>
          <p class="helper">The quiz only uses animals already found, so kids review what they discovered.</p>
          <button class="btn primary" id="goDiscover">Discover Animal</button>
        </div>
      </section>
    `, 'quiz');
    document.getElementById('goDiscover').addEventListener('click', () => go('discover'));
    return;
  }
  state.quiz = state.quiz || makeQuiz(animals);
  renderQuizQuestion();
}

function makeQuiz(animals) {
  const quizTypes = [];
  const uniqueCategories = [...new Set(animals.map(a => a.category))];
  uniqueCategories.forEach(category => quizTypes.push({ type: 'category', label: `Which animals are in ${category}?`, match: a => a.category === category }));
  const uniqueClasses = [...new Set(animals.map(a => a.animalClass).filter(Boolean))];
  uniqueClasses.forEach(animalClass => quizTypes.push({ type: 'class', label: `Which animals are ${animalClass}s?`, match: a => a.animalClass === animalClass }));
  const plantEaters = { type: 'eats', label: 'Which animals eat plants?', match: eatsPlants };
  const meatEaters = { type: 'eats', label: 'Which animals eat meat, fish, or tiny animals?', match: eatsMeatOrTinyAnimals };
  quizTypes.push(plantEaters, meatEaters);

  const valid = quizTypes.filter(type => {
    const positives = animals.filter(type.match).length;
    const negatives = animals.length - positives;
    return positives > 0 && negatives > 0;
  });
  const question = valid[Math.floor(Math.random() * valid.length)] || plantEaters;
  const positives = shuffle(animals.filter(question.match));
  const negatives = shuffle(animals.filter(a => !question.match(a)));
  const options = shuffle([...positives.slice(0, 3), ...negatives.slice(0, 3)]).slice(0, Math.min(6, animals.length));
  const answerIds = options.filter(question.match).map(a => a.id);
  return { question, options, selected: [], checked: false, answerIds };
}

function eatsPlants(animal) {
  const text = asList(animal.eats).join(' ').toLowerCase();
  return /(plant|grass|hay|seed|fruit|nectar|bamboo|leaf|leaves|grain)/.test(text);
}

function eatsMeatOrTinyAnimals(animal) {
  const text = asList(animal.eats).join(' ').toLowerCase();
  return /(meat|fish|insect|tiny animal|tiny insects)/.test(text);
}

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function renderQuizQuestion() {
  const quiz = state.quiz;
  const selected = new Set(quiz.selected);
  render(`
    <section class="panel">
      <h2>Journal Quiz</h2>
      <p class="helper">${escapeHtml(quiz.question.label)} Select every matching animal.</p>
      <div class="animal-grid">
        ${quiz.options.map(animal => {
          const isSelected = selected.has(animal.id);
          const isCorrect = quiz.answerIds.includes(animal.id);
          const checkedClass = quiz.checked ? (isCorrect ? 'correct' : isSelected ? 'wrong' : '') : '';
          return animalCard(animal, { extraClass: `quiz-option ${isSelected ? 'selected' : ''} ${checkedClass}`, showFound: false });
        }).join('')}
      </div>
      ${quiz.checked ? `<div class="alert"><span>${quizResultText()}</span><button class="btn yellow" id="newQuiz">New Question</button></div>` : ''}
      <div class="actions">
        <button class="btn primary" id="checkQuiz">Check Answer</button>
        <button class="btn ghost" id="resetQuiz">New Question</button>
      </div>
    </section>
  `, 'quiz');

  document.querySelectorAll('[data-animal-id]').forEach(button => button.addEventListener('click', () => {
    if (state.quiz.checked) return;
    const id = button.dataset.animalId;
    if (state.quiz.selected.includes(id)) state.quiz.selected = state.quiz.selected.filter(item => item !== id);
    else state.quiz.selected.push(id);
    renderQuizQuestion();
  }));
  document.getElementById('checkQuiz').addEventListener('click', () => {
    state.quiz.checked = true;
    renderQuizQuestion();
  });
  document.getElementById('resetQuiz').addEventListener('click', () => {
    state.quiz = makeQuiz(discoveredAnimals());
    renderQuizQuestion();
  });
  document.getElementById('newQuiz')?.addEventListener('click', () => {
    state.quiz = makeQuiz(discoveredAnimals());
    renderQuizQuestion();
  });
}

function quizResultText() {
  const selected = new Set(state.quiz.selected);
  const answers = new Set(state.quiz.answerIds);
  const correct = state.quiz.options.every(animal => selected.has(animal.id) === answers.has(animal.id));
  return correct ? 'Great exploring. You matched the journal facts.' : 'Good try. Review the green cards and try again.';
}

function renderParentGate() {
  if (state.parentUnlocked) return renderParentArea('overview');
  const a = Math.floor(Math.random() * 10) + 9;
  const b = Math.floor(Math.random() * 8) + 5;
  state.parentChallenge = { label: `${a} + ${b}`, answer: a + b };
  render(`
    <section class="panel">
      <h2>Grown-up Check</h2>
      <p class="helper">Parent tools can change data, create animals, and reset the local app.</p>
      <form id="parentGateForm" class="form">
        <div class="field">
          <label for="gateAnswer">What is ${state.parentChallenge.label}?</label>
          <input id="gateAnswer" class="input" inputmode="numeric" autocomplete="off" required>
        </div>
        <div class="actions"><button class="btn primary" type="submit">Open Parent Area</button></div>
      </form>
    </section>
  `, 'parent');
  document.getElementById('parentGateForm').addEventListener('submit', event => {
    event.preventDefault();
    const answer = Number(document.getElementById('gateAnswer').value);
    if (answer === state.parentChallenge.answer) {
      state.parentUnlocked = true;
      go('parentArea');
    } else {
      showToast('Try again.');
    }
  });
}

function parentTabButton(tab, label, active) {
  return `<button class="chip ${tab === active ? 'active' : ''}" data-parent-tab="${tab}">${label}</button>`;
}

function renderParentArea(tab = 'overview') {
  if (!state.parentUnlocked) return renderParentGate();
  const tabs = `
    <div class="category-strip">
      ${parentTabButton('overview', 'Overview', tab)}
      ${parentTabButton('mysteries', 'Mysteries', tab)}
      ${parentTabButton('handmade', 'Handmade', tab)}
      ${parentTabButton('settings', 'Settings', tab)}
      ${parentTabButton('data', 'Data Check', tab)}
    </div>`;
  render(`
    <section class="panel">
      <h2>Parent Area</h2>
      <p class="helper">Manage local data, mystery discoveries, handmade animals, and debug information.</p>
      ${tabs}
      <div id="parentPanel">${parentPanelContent(tab)}</div>
    </section>
  `, 'parent');
  document.querySelectorAll('[data-parent-tab]').forEach(button => button.addEventListener('click', () => go('parentArea', { tab: button.dataset.parentTab })));
  bindParentActions(tab);
}

function parentPanelContent(tab) {
  if (tab === 'mysteries') return parentMysteriesContent();
  if (tab === 'handmade') return parentHandmadeContent();
  if (tab === 'settings') return parentSettingsContent();
  if (tab === 'data') return parentDataContent();
  const c = completion();
  const pending = state.mysteries.filter(m => m.status === 'pending').length;
  return `
    <div class="grid two">
      ${progressMarkup(c)}
      <div class="progress-card"><strong>Pending mysteries</strong><p class="helper">${pending} waiting for review.</p><button class="btn yellow" data-action="tabMysteries">Review Mysteries</button></div>
      <div class="progress-card"><strong>Handmade animals</strong><p class="helper">${state.customAnimals.length} created locally.</p><button class="btn purple" data-action="newHandmade">Create Handmade Animal</button></div>
      <div class="progress-card"><strong>Manual unlock</strong><p class="helper">Use only when a photo is not possible.</p><button class="btn ghost" data-action="manualUnlock">Open Manual Unlock</button></div>
    </div>`;
}

function parentMysteriesContent() {
  const items = [...state.mysteries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!items.length) return '<div class="empty-state"><strong>No mystery discoveries yet.</strong><p class="helper">Mystery animals saved by the child appear here.</p></div>';
  return `<div class="grid">${items.map(mystery => `
    <div class="progress-card">
      <div class="grid two">
        <div>${mystery.photoData ? `<img class="preview-photo" src="${mystery.photoData}" alt="Mystery photo">` : '<div class="empty-state">No photo stored</div>'}</div>
        <div>
          <strong>Mystery from ${formatDate(mystery.createdAt)}</strong>
          <p class="helper">Status: ${escapeHtml(mystery.status || 'pending')}</p>
          <div class="actions">
            ${mystery.status === 'pending' ? `<button class="btn primary" data-action="linkMystery" data-id="${mystery.id}">Link to Existing Animal</button><button class="btn purple" data-action="createFromMystery" data-id="${mystery.id}">Create Handmade Animal</button>` : ''}
            <button class="btn danger" data-action="deleteMystery" data-id="${mystery.id}">Delete</button>
          </div>
        </div>
      </div>
    </div>`).join('')}</div>`;
}

function parentHandmadeContent() {
  const items = [...state.customAnimals].sort(byName);
  return `
    <div class="actions"><button class="btn purple" data-action="newHandmade">Create Handmade Animal</button></div>
    ${items.length ? `<div class="animal-grid">${items.map(animal => `
      <div class="animal-card ${categoryClass(animal.category)} ${animal.published ? 'unlocked' : 'locked'}">
        <div class="animal-img-wrap">${animalImage(animal)}</div>
        <div class="card-title">
          <strong>${escapeHtml(animal.name)}</strong>
          <span>${escapeHtml(animal.category)} - ${animal.published ? 'Published' : 'Draft'}</span>
          <div class="actions">
            <button class="btn ghost" data-action="editHandmade" data-id="${animal.id}">Edit</button>
            <button class="btn danger" data-action="deleteHandmade" data-id="${animal.id}">Delete</button>
          </div>
        </div>
      </div>`).join('')}</div>` : '<div class="empty-state"><strong>No handmade animals yet.</strong><p class="helper">Create custom animals when the journal does not have the right card.</p></div>'}`;
}

function parentSettingsContent() {
  return `
    <div class="grid two">
      <div class="progress-card">
        <strong>Camera</strong>
        <p class="helper">When disabled, the app uses photo upload/manual flow only.</p>
        <button class="btn ${state.settings.cameraEnabled ? 'primary' : 'ghost'}" data-action="toggleCamera">Camera ${state.settings.cameraEnabled ? 'On' : 'Off'}</button>
      </div>
      <div class="progress-card">
        <strong>Manual unlock</strong>
        <p class="helper">Available only after the parent gate.</p>
        <button class="btn ${state.settings.manualUnlockEnabled ? 'primary' : 'ghost'}" data-action="toggleManualUnlock">Manual Unlock ${state.settings.manualUnlockEnabled ? 'On' : 'Off'}</button>
      </div>
      <div class="progress-card">
        <strong>Export backup</strong>
        <p class="helper">Exports metadata only. Photos and uploaded animal images are not included in this MVP backup.</p>
        <button class="btn blue" data-action="exportData">Export JSON</button>
      </div>
      <div class="progress-card">
        <strong>Delete app photos</strong>
        <p class="helper">Removes latest discovery photos and mystery photos stored inside this app.</p>
        <button class="btn danger" data-action="deletePhotos">Delete App Photos</button>
      </div>
      <div class="progress-card">
        <strong>Reset discoveries</strong>
        <p class="helper">Keeps profile and handmade animals, but clears found progress.</p>
        <button class="btn danger" data-action="resetDiscoveries">Reset Discoveries</button>
      </div>
      <div class="progress-card">
        <strong>Factory reset</strong>
        <p class="helper">Clears all local app data on this device.</p>
        <button class="btn danger" data-action="factoryReset">Factory Reset</button>
      </div>
    </div>`;
}

function parentDataContent() {
  const cats = categoryCounts();
  return `
    <div class="grid">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Category</th><th>Found</th><th>Total</th></tr></thead>
          <tbody>${cats.map(cat => `<tr><td>${cat.label}</td><td>${cat.found}</td><td>${cat.total}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Animal</th><th>Category</th><th>Image path</th></tr></thead>
          <tbody>${allAnimals().map(animal => `<tr><td>${escapeHtml(animal.name)}</td><td>${escapeHtml(animal.category)}</td><td>${escapeHtml(animal.image || 'local-upload')}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="progress-card"><strong>Local records</strong><p class="helper">Baseline animals: ${state.animals.length}<br>Published/custom animals: ${state.customAnimals.filter(a => a.published).length}/${state.customAnimals.length}<br>Discoveries: ${state.discoveries.length}<br>Mysteries: ${state.mysteries.length}<br>Ready reveals: ${state.readyReveals.length}</p></div>
    </div>`;
}

function bindParentActions(tab) {
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (action === 'tabMysteries') return go('parentArea', { tab: 'mysteries' });
      if (action === 'newHandmade') return go('handmade');
      if (action === 'manualUnlock') {
        state.pickerMode = 'manualUnlock';
        state.pendingPhoto = null;
        return go('animalPicker');
      }
      if (action === 'linkMystery') return startLinkMystery(id);
      if (action === 'createFromMystery') return go('handmade', { sourceMysteryId: id });
      if (action === 'deleteMystery') return deleteMystery(id);
      if (action === 'editHandmade') return go('handmade', { id });
      if (action === 'deleteHandmade') return deleteHandmade(id);
      if (action === 'toggleCamera') return updateSetting('cameraEnabled', !state.settings.cameraEnabled);
      if (action === 'toggleManualUnlock') return updateSetting('manualUnlockEnabled', !state.settings.manualUnlockEnabled);
      if (action === 'exportData') return exportMetadata();
      if (action === 'deletePhotos') return deleteStoredPhotos();
      if (action === 'resetDiscoveries') return resetDiscoveries();
      if (action === 'factoryReset') return factoryReset();
    });
  });
}

async function updateSetting(key, value) {
  state.settings[key] = value;
  await kvSet('settings', state.settings);
  showToast('Setting saved.');
  go('parentArea', { tab: 'settings' });
}

function startLinkMystery(id) {
  const mystery = state.mysteries.find(item => item.id === id);
  if (!mystery) return;
  state.pendingPhoto = mystery.photoData || null;
  state.pickerMode = 'parentLink';
  state.sourceMysteryId = id;
  state.pickerSearch = '';
  state.pickerCategory = 'All';
  go('animalPicker');
}

async function deleteMystery(id) {
  if (!confirm('Delete this mystery discovery?')) return;
  await deleteItem('mysteries', id);
  state.mysteries = await getAll('mysteries');
  showToast('Mystery deleted.');
  go('parentArea', { tab: 'mysteries' });
}

async function deleteHandmade(id) {
  if (!confirm('Delete this handmade animal?')) return;
  await deleteItem('customAnimals', id);
  await deleteItem('discoveries', id);
  state.customAnimals = await getAll('customAnimals');
  state.discoveries = await getAll('discoveries');
  state.readyReveals = state.readyReveals.filter(reveal => reveal.animalId !== id);
  await kvSet('readyReveals', state.readyReveals);
  showToast('Handmade animal deleted.');
  go('parentArea', { tab: 'handmade' });
}

async function addReadyReveal(reveal) {
  const record = {
    id: uid('reveal'),
    createdAt: nowIso(),
    ...reveal
  };
  state.readyReveals.push(record);
  await kvSet('readyReveals', state.readyReveals);
  return record;
}

function renderReadyReveal(revealId) {
  const reveal = state.readyReveals.find(item => item.id === revealId) || state.readyReveals[0];
  if (!reveal) return go('home');
  const animal = getAnimal(reveal.animalId);
  render(`
    <section class="panel hero">
      <div>
        <h2>New animal discovered.</h2>
        <p>A grown-up studied your mystery animal. It is ready for your animal journal.</p>
        <div class="actions">
          <button class="btn primary" id="openReadyReveal">Reveal Card</button>
          <button class="btn ghost" id="laterReveal">Later</button>
        </div>
      </div>
      <div class="hero-art"><strong style="font-size:6rem">?</strong></div>
    </section>
  `, 'home');
  document.getElementById('openReadyReveal').addEventListener('click', () => consumeReadyReveal(reveal.id));
  document.getElementById('laterReveal').addEventListener('click', () => go('home'));
}

async function consumeReadyReveal(revealId) {
  const reveal = state.readyReveals.find(item => item.id === revealId);
  if (!reveal) return go('home');
  await unlockAnimal(reveal.animalId, reveal.photoData || null);
  state.readyReveals = state.readyReveals.filter(item => item.id !== revealId);
  await kvSet('readyReveals', state.readyReveals);
  return go('unlock', { animalId: reveal.animalId, wasAlreadyFound: false });
}

function renderHandmadeForm(params = {}) {
  if (!state.parentUnlocked) return renderParentGate();
  const sourceMystery = params.sourceMysteryId ? state.mysteries.find(item => item.id === params.sourceMysteryId) : null;
  const editing = params.id ? state.customAnimals.find(animal => animal.id === params.id) : null;
  const animal = editing || {
    id: '',
    name: '',
    category: 'City',
    size: 'Small',
    animalClass: 'Mammal',
    familyGroup: '',
    explorerSkill: 'Ground Explorer',
    eats: [],
    livesIn: [],
    funFact: '',
    imageData: null,
    published: false,
    isCustom: true
  };
  state.handmadeImageData = animal.imageData || null;
  render(`
    <section class="panel">
      <h2>${editing ? 'Edit Handmade Animal' : 'Create Handmade Animal'}</h2>
      <p class="helper">A handmade animal is visible to the child only after it has required details and a cartoon image.</p>
      ${sourceMystery?.photoData ? `<div class="progress-card"><strong>Source mystery photo</strong><img class="preview-photo" src="${sourceMystery.photoData}" alt="Mystery photo"></div>` : ''}
      <form id="handmadeForm" class="form">
        <div class="grid two">
          <div class="field"><label for="haName">Animal name</label><input class="input" id="haName" value="${escapeHtml(animal.name)}" required></div>
          <div class="field"><label for="haCategory">Category</label><select class="select" id="haCategory">${CATEGORIES.map(cat => `<option value="${cat.id}" ${animal.category === cat.id ? 'selected' : ''}>${cat.label}</option>`).join('')}</select></div>
          <div class="field"><label for="haSize">Size</label><select class="select" id="haSize">${['Tiny','Small','Medium','Large','Huge'].map(size => `<option value="${size}" ${animal.size === size ? 'selected' : ''}>${size}</option>`).join('')}</select></div>
          <div class="field"><label for="haClass">Animal type</label><select class="select" id="haClass">${['Mammal','Bird','Reptile','Fish','Amphibian','Insect','Arachnid','Invertebrate','Crustacean','Mollusk','Other'].map(type => `<option value="${type}" ${animal.animalClass === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
          <div class="field"><label for="haFamily">Animal family</label><input class="input" id="haFamily" value="${escapeHtml(animal.familyGroup || '')}" placeholder="Canine, Feline, Rodent..."></div>
          <div class="field"><label for="haSkill">Explorer skill</label><input class="input" id="haSkill" value="${escapeHtml(animal.explorerSkill || '')}" placeholder="Ground Explorer"></div>
          <div class="field"><label for="haEats">Eats</label><input class="input" id="haEats" value="${escapeHtml(asList(animal.eats).join(', '))}" placeholder="Plants, insects"></div>
          <div class="field"><label for="haLives">Lives in</label><input class="input" id="haLives" value="${escapeHtml(asList(animal.livesIn).join(', '))}" placeholder="Gardens, ponds"></div>
        </div>
        <div class="field"><label for="haFact">Fun fact</label><textarea class="textarea" id="haFact" placeholder="One simple kid-friendly fact.">${escapeHtml(animal.funFact || '')}</textarea></div>
        <div class="field"><label for="haImage">Cartoon image</label><input class="input" id="haImage" type="file" accept="image/*"><p class="helper small">Required before publishing. The real photo should not be used as the card image.</p></div>
        <div id="haImagePreview">${state.handmadeImageData ? `<img class="preview-photo" style="max-width:220px" src="${state.handmadeImageData}" alt="Handmade image preview">` : ''}</div>
        <div class="actions">
          <button class="btn ghost" type="submit" data-save-mode="draft">Save Draft</button>
          <button class="btn primary" type="submit" data-save-mode="publish">Publish for Child Reveal</button>
          <button class="btn ghost" type="button" id="cancelHandmade">Cancel</button>
        </div>
      </form>
    </section>
  `, 'parent');

  document.getElementById('haImage').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.handmadeImageData = await compressImage(file, 1024, 0.82);
    document.getElementById('haImagePreview').innerHTML = `<img class="preview-photo" style="max-width:220px" src="${state.handmadeImageData}" alt="Handmade image preview">`;
  });

  document.getElementById('handmadeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const mode = event.submitter?.dataset.saveMode || 'draft';
    await saveHandmadeAnimal({ editing, sourceMystery, publish: mode === 'publish' });
  });
  document.getElementById('cancelHandmade').addEventListener('click', () => go('parentArea', { tab: 'handmade' }));
}

async function saveHandmadeAnimal({ editing, sourceMystery, publish }) {
  const name = document.getElementById('haName').value.trim();
  const imageData = state.handmadeImageData;
  if (!name) return showToast('Animal name is required.');
  if (publish && !imageData) return showToast('Add a cartoon image before publishing.');
  const wasPublished = Boolean(editing?.published);
  const id = editing?.id || `custom-${slugify(name)}-${Date.now().toString(36)}`;
  const animal = {
    ...(editing || {}),
    id,
    name,
    category: document.getElementById('haCategory').value,
    size: document.getElementById('haSize').value,
    animalClass: document.getElementById('haClass').value,
    familyGroup: document.getElementById('haFamily').value.trim() || document.getElementById('haClass').value,
    explorerSkill: document.getElementById('haSkill').value.trim() || 'Ground Explorer',
    eats: asList(document.getElementById('haEats').value),
    livesIn: asList(document.getElementById('haLives').value),
    funFact: document.getElementById('haFact').value.trim() || `${name} is a special animal discovery.`,
    imageData,
    isBaseline: false,
    isCustom: true,
    published: publish || wasPublished,
    sourceMysteryId: sourceMystery?.id || editing?.sourceMysteryId || null,
    updatedAt: nowIso(),
    createdAt: editing?.createdAt || nowIso()
  };
  await putItem('customAnimals', animal);
  state.customAnimals = await getAll('customAnimals');
  if (sourceMystery) {
    sourceMystery.status = publish ? 'handmade-published' : 'handmade-draft';
    sourceMystery.customAnimalId = id;
    sourceMystery.updatedAt = nowIso();
    await putItem('mysteries', sourceMystery);
    state.mysteries = await getAll('mysteries');
  }
  if (publish && !wasPublished) {
    await addReadyReveal({
      type: 'custom',
      animalId: id,
      sourceMysteryId: sourceMystery?.id || null,
      photoData: sourceMystery?.photoData || null
    });
    showToast('Handmade animal published. Child reveal is ready.');
  } else {
    showToast('Handmade animal saved.');
  }
  go('parentArea', { tab: 'handmade' });
}

async function exportMetadata() {
  const cleanDiscoveries = state.discoveries.map(({ latestPhoto, ...rest }) => rest);
  const cleanCustom = state.customAnimals.map(({ imageData, ...rest }) => rest);
  const cleanMysteries = state.mysteries.map(({ photoData, ...rest }) => rest);
  const cleanReveals = state.readyReveals.map(({ photoData, ...rest }) => rest);
  const payload = {
    app: 'Little Explorer: Animal Quest',
    exportedAt: nowIso(),
    profile: state.profile,
    settings: state.settings,
    discoveries: cleanDiscoveries,
    customAnimals: cleanCustom,
    mysteries: cleanMysteries,
    readyReveals: cleanReveals
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `animal-quest-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteStoredPhotos() {
  if (!confirm('Delete all app-stored photos? This does not delete photos from the native photo app.')) return;
  const discoveries = state.discoveries.map(({ latestPhoto, ...rest }) => rest);
  await Promise.all(discoveries.map(item => putItem('discoveries', item)));
  const mysteries = state.mysteries.map(item => ({ ...item, photoData: null }));
  await Promise.all(mysteries.map(item => putItem('mysteries', item)));
  state.readyReveals = state.readyReveals.map(({ photoData, ...rest }) => rest);
  await kvSet('readyReveals', state.readyReveals);
  state.discoveries = await getAll('discoveries');
  state.mysteries = await getAll('mysteries');
  showToast('App-stored photos deleted.');
  go('parentArea', { tab: 'settings' });
}

async function resetDiscoveries() {
  if (!confirm('Reset all discoveries and badges? Handmade animals and profile will stay.')) return;
  await clearStore('discoveries');
  state.readyReveals = [];
  await kvSet('readyReveals', []);
  state.discoveries = [];
  showToast('Discoveries reset.');
  go('home');
}

async function factoryReset() {
  if (!confirm('Factory reset all local app data on this device?')) return;
  await clearStore('discoveries');
  await clearStore('customAnimals');
  await clearStore('mysteries');
  await clearStore('kv');
  state.profile = null;
  state.settings = { ...DEFAULT_SETTINGS };
  state.readyReveals = [];
  state.customAnimals = [];
  state.mysteries = [];
  state.discoveries = [];
  showToast('Local app data cleared.');
  go('home');
}

async function init() {
  try {
    db = await openDb();
    await loadState();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(BASE_PATH + 'sw.js', { scope: BASE_PATH }).catch(() => {});
    }
    renderHome();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="app-shell"><section class="panel"><h1>Little Explorer: Animal Quest</h1><p class="helper">The app could not start. Try serving the public folder from a local web server.</p><pre>${escapeHtml(error.message || error)}</pre></section></div>`;
  }
}

init();
