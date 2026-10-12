// Generates the official-source files of extension/data/fr; hand-curated files
// there are left alone.
//
// Sources (see LICENSE-DATA.md):
//   - Communes, postal codes, populations, departments, regions:
//     @etalab/decoupage-administratif (INSEE Code officiel géographique,
//     La Poste), Licence Ouverte 2.0.
//   - Commune centers: IGN Admin Express COG through gregoiredavid/france-geojson
//     at a pinned commit, Licence Ouverte 2.0.
//   - NAF rév. 2 labels: @socialgouv/codes-naf (INSEE), Licence Ouverte 2.0.
//   - NAF 2025 selection: scripts/data/naf-selection.json, curated from the
//     INSEE "Structure NAF 2025" document.
//
// Usage: npm run build:data (fetches from raw.githubusercontent.com)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const outDir = `${rootDir}extension/data/fr`;

const GEOJSON_COMMIT = '5d34ee6d0140c29f785fdb047d9329f1aab58833';
const GEOJSON_BASE = `https://raw.githubusercontent.com/gregoiredavid/france-geojson/${GEOJSON_COMMIT}`;
const GEOJSON_FILES = [
  'communes-version-simplifiee.geojson',
  'departements/971-guadeloupe/communes-971-guadeloupe.geojson',
  'departements/972-martinique/communes-972-martinique.geojson',
  'departements/973-guyane/communes-973-guyane.geojson',
  'departements/974-la-reunion/communes-974-la-reunion.geojson',
  'departements/976-mayotte/communes-976-mayotte.geojson',
];

/** Listed through their municipal arrondissements, which take the city name. */
const SPLIT_CITIES = { 75056: 'Paris', 69123: 'Lyon', 13055: 'Marseille' };

/** Fixed-line zone (first two digits) by region code. */
const PHONE_ZONE_BY_REGION = {
  11: '01',
  24: '02',
  27: '03',
  28: '02',
  32: '03',
  44: '03',
  52: '02',
  53: '02',
  75: '05',
  76: '05',
  84: '04',
  93: '04',
  94: '04',
  '01': '05',
  '02': '05',
  '03': '05',
  '04': '02',
  '06': '02',
};
/** Eastern Occitanie departments use zone 04. */
const PHONE_ZONE_EXCEPTIONS = { 11: '04', 30: '04', 34: '04', 48: '04', 66: '04' };

/** Banned from repository text files by test/project.test.js. */
const FORBIDDEN_CHARACTERS = [
  [/\u2014|\u2013/g, '-'],
  [/\u00b7/g, '.'],
  [/\u2019/g, "'"],
];

/**
 * @param {string} text
 * @returns {string}
 */
function clean(text) {
  return FORBIDDEN_CHARACTERS.reduce((result, [pattern, by]) => result.replace(pattern, by), text);
}

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
async function fetchJson(path) {
  const response = await fetch(`${GEOJSON_BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Area-weighted centroid of the largest outer ring of a (multi)polygon.
 * @param {{ type: string, coordinates: any }} geometry
 * @returns {[number, number] | null} [latitude, longitude]
 */
function centroid(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  let bestArea = 0;
  for (const polygon of polygons) {
    const ring = polygon[0];
    let area = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      x += (x0 + x1) * cross;
      y += (y0 + y1) * cross;
    }
    if (Math.abs(area) > bestArea && area !== 0) {
      bestArea = Math.abs(area);
      best = [y / (3 * area), x / (3 * area)];
    }
  }
  return best;
}

/**
 * @param {number} value
 * @returns {number}
 */
function round4(value) {
  return Math.round(value * 10000) / 10000;
}

async function loadCenters() {
  /** @type {Map<string, [number, number]>} */
  const centers = new Map();
  for (const file of GEOJSON_FILES) {
    const collection = await fetchJson(file);
    for (const feature of collection.features) {
      const center = feature.geometry ? centroid(feature.geometry) : null;
      if (center) {
        centers.set(feature.properties.code, center);
      }
    }
  }
  return centers;
}

/**
 * @param {Array<[number, number]>} points
 * @returns {[number, number] | null}
 */
function average(points) {
  if (points.length === 0) {
    return null;
  }
  const sum = points.reduce((acc, [lat, lon]) => [acc[0] + lat, acc[1] + lon], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

async function buildGeography() {
  const communes = require('@etalab/decoupage-administratif/data/communes.json');
  const departments = require('@etalab/decoupage-administratif/data/departements.json');
  const regions = require('@etalab/decoupage-administratif/data/regions.json');
  const centers = await loadCenters();

  const regionNames = new Map(regions.map((region) => [region.code, clean(region.nom)]));
  const communeNames = new Map(
    communes
      .filter((commune) => commune.type === 'commune-actuelle')
      .map((commune) => [commune.code, clean(commune.nom)]),
  );

  // Communes nouvelles missing from the GeoJSON fall back on their former communes.
  /** @type {Map<string, Array<[number, number]>>} */
  const delegatedCenters = new Map();
  for (const commune of communes) {
    if (commune.type === 'commune-deleguee' && centers.has(commune.code)) {
      const list = delegatedCenters.get(commune.chefLieu) || [];
      list.push(/** @type {[number, number]} */ (centers.get(commune.code)));
      delegatedCenters.set(commune.chefLieu, list);
    }
  }

  const kept = departments.filter((department) => department.zone !== 'com');
  /** @type {Map<string, Array<[string, string, string | string[], number, number, number]>>} */
  const byDepartment = new Map(kept.map((department) => [department.code, []]));
  /** @type {Array<{ code: string, name: string, center: [number, number] | null }>} */
  const missing = [];

  for (const commune of communes) {
    const rows = byDepartment.get(commune.departement);
    if (!rows || !commune.population || !commune.codesPostaux || !commune.codesPostaux.length) {
      continue;
    }
    if (commune.type === 'commune-actuelle' && !(commune.code in SPLIT_CITIES)) {
      const center =
        centers.get(commune.code) || average(delegatedCenters.get(commune.code) || []) || null;
      const row = [
        commune.code,
        clean(commune.nom),
        commune.codesPostaux.length === 1 ? commune.codesPostaux[0] : commune.codesPostaux,
        commune.population,
        center ? round4(center[0]) : 0,
        center ? round4(center[1]) : 0,
      ];
      rows.push(/** @type {any} */ (row));
      if (!center) {
        missing.push({ code: commune.code, name: commune.nom, center });
      }
    } else if (commune.type === 'arrondissement-municipal') {
      const parent = commune.commune;
      const center = centers.get(parent) || null;
      rows.push([
        commune.code,
        SPLIT_CITIES[/** @type {keyof typeof SPLIT_CITIES} */ (parent)],
        commune.codesPostaux.length === 1 ? commune.codesPostaux[0] : commune.codesPostaux,
        commune.population,
        center ? round4(center[0]) : 0,
        center ? round4(center[1]) : 0,
      ]);
    }
  }

  // Communes without any known center take the mean of their department.
  for (const [code, rows] of byDepartment) {
    const known = rows.filter((row) => row[4] !== 0).map((row) => [row[4], row[5]]);
    const mean = average(/** @type {Array<[number, number]>} */ (known));
    for (const row of rows) {
      if (row[4] === 0 && mean) {
        row[4] = round4(mean[0]);
        row[5] = round4(mean[1]);
      }
    }
    if (rows.length === 0) {
      throw new Error(`Department ${code} has no commune`);
    }
  }

  rmSync(`${outDir}/communes`, { recursive: true, force: true });
  mkdirSync(`${outDir}/communes`, { recursive: true });
  const index = [];
  for (const department of kept) {
    const rows = /** @type {any[]} */ (byDepartment.get(department.code));
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    writeFileSync(`${outDir}/communes/${department.code}.json`, JSON.stringify(rows));
    index.push({
      code: department.code,
      name: clean(department.nom),
      region: department.region,
      regionName: regionNames.get(department.region),
      prefecture: communeNames.get(department.chefLieu),
      population: rows.reduce((sum, row) => sum + row[3], 0),
      phoneZone:
        PHONE_ZONE_EXCEPTIONS[
          /** @type {keyof typeof PHONE_ZONE_EXCEPTIONS} */ (department.code)
        ] ||
        PHONE_ZONE_BY_REGION[/** @type {keyof typeof PHONE_ZONE_BY_REGION} */ (department.region)],
    });
  }
  for (const entry of index) {
    if (!entry.prefecture || !entry.phoneZone || !entry.regionName) {
      throw new Error(`Incomplete department ${JSON.stringify(entry)}`);
    }
  }
  writeFileSync(`${outDir}/departments.json`, `${JSON.stringify(index, null, 1)}\n`);
  console.log(
    `${index.length} departments, ${[...byDepartment.values()].reduce((n, r) => n + r.length, 0)} communes, ${missing.length} centers from the department mean`,
  );
}

function buildNaf() {
  const rev2 = new Map(
    require('@socialgouv/codes-naf/index.json').map(
      (/** @type {{ id: string, label: string }} */ entry) => [entry.id, clean(entry.label)],
    ),
  );
  const selection = JSON.parse(readFileSync(`${rootDir}scripts/data/naf-selection.json`, 'utf8'));
  const seen = new Set();
  const naf = selection.map((/** @type {any} */ entry) => {
    if (!/^\d\d\.\d\d[A-Z]$/.test(entry.code) || seen.has(entry.code)) {
      throw new Error(`Invalid or duplicate NAF 2025 code ${entry.code}`);
    }
    seen.add(entry.code);
    const rev2Label = rev2.get(entry.rev2);
    if (!rev2Label) {
      throw new Error(`Unknown NAF rev. 2 code ${entry.rev2}`);
    }
    return { ...entry, label: clean(entry.label), rev2Label };
  });
  writeFileSync(`${outDir}/naf.json`, `${JSON.stringify(naf, null, 1)}\n`);
  console.log(`${naf.length} NAF sub-classes`);
}

mkdirSync(outDir, { recursive: true });
buildNaf();
await buildGeography();
