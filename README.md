# Little Explorer: Animal Quest

Tagline: Discover real animals. Unlock your animal journal.

This is a local-first Progressive Web App prototype for the Animal Quest MVP. It uses bundled animal data and bundled animal artwork. It has no external API calls and no online animal database.

## What is included

- 46 baseline animals across Pets, Farm, Bugs, City, Wild, and Zoo.
- Offline-ready PWA shell with service worker caching.
- Animal Journal with locked grey cards and unlocked color cards.
- Completion tracking across baseline animals plus published handmade animals.
- Discover flow: take/choose photo, manually select animal, unlock card.
- Mystery animal flow for animals not in the list.
- Parent gate with simple math.
- Parent area with mystery review, handmade animal creation, settings, export, and database check.
- Parent can link a mystery photo to an existing animal or create a handmade animal.
- Handmade animals require a cartoon image before publishing.
- Latest discovery photo only, compressed and stored locally in IndexedDB.
- Quiz mode using only animals already discovered.
- Metadata-only JSON export.

## How to run locally

From this folder:

```bash
python3 -m http.server 5173 --directory public
```

Then open:

```text
http://localhost:5173
```

For phone testing, the file input photo flow is the most reliable local option. Live camera access and PWA installation may require HTTPS depending on the browser/device. The app is designed so the phone camera can still be used through the photo picker/capture input.

## Folder structure

```text
public/
  index.html
  manifest.webmanifest
  sw.js
  data/animals.json
  src/app.js
  src/styles.css
  assets/animals/
  icons/
```

## Data model

Baseline animals live in:

```text
public/data/animals.json
```

Local user data is stored in IndexedDB:

- profile
- discoveries
- mystery discoveries
- custom handmade animals
- ready-to-reveal cards
- settings

## Approved category counts

| Category | Count |
|---|---:|
| Pets | 8 |
| Farm | 8 |
| Bugs | 9 |
| City | 7 |
| Wild | 4 |
| Zoo | 10 |
| Total | 46 |

## Notes

This prototype is dependency-free for easy offline testing. It uses native IndexedDB directly instead of Dexie so the PWA can run as a static local web app without installing packages.
