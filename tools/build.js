// tools/build.js

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

const ROOT = path.join(__dirname, "..");
const TRACKS_DIR = path.join(ROOT, "tracks_originals");
const OUTPUT = path.join(ROOT, "tracks.json");

const CATEGORIES = ["walk", "cycle", "land", "boat", "plane"];

const tracks = [];

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function extractDate(obj) {
  try {
    if (obj.gpx?.metadata?.time)
      return obj.gpx.metadata.time;

    const trk = asArray(obj.gpx?.trk)[0];

    if (trk?.time)
      return trk.time;

    const firstPt =
      asArray(trk?.trkseg)[0]?.trkpt?.[0];

    if (firstPt?.time)
      return firstPt.time;
  } catch {}

  return null;
}

function extractGpxTracks(obj) {

  const trks = asArray(obj.gpx?.trk);

  if (!trks.length) return [];

  const results = [];

  trks.forEach((trk, index) => {

    const segments = asArray(trk.trkseg);

    const points = [];

    segments.forEach(seg => {

      asArray(seg.trkpt).forEach(pt => {

        const lat = parseFloat(pt.lat);
        const lon = parseFloat(pt.lon);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          points.push([lat, lon]);
        }

      });

    });

    if (points.length >= 2) {

      results.push({
        name:
          trk.name ||
          `Track ${String(index + 1).padStart(2, "0")}`,
        date: extractDate(obj),
        points
      });

    }

  });

  return results;
}

function extractKmlTrack(obj) {

  const doc = obj.kml?.Document;

  if (!doc) return null;

  const placemark =
    asArray(doc.Placemark)[0];

  if (!placemark) return null;

  const coordsText =
    placemark.LineString?.coordinates;

  if (!coordsText) return null;

  const points = coordsText
    .trim()
    .split(/\s+/)
    .map(line => {

      const [lon, lat] = line
        .split(",")
        .map(Number);

      return [lat, lon];

    })
    .filter(p =>
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1])
    );

  return {
    name: placemark.name || null,
    date: null,
    points
  };
}

function processFile(filePath, category) {

  try {

    const xml = fs.readFileSync(
      filePath,
      "utf8"
    );

    const obj = parser.parse(xml);

    if (obj.gpx) {

  const gpxTracks = extractGpxTracks(obj);

  if (!gpxTracks.length) {

    console.log(
      "⚠ Could not parse:",
      filePath
    );

    return;
  }

  gpxTracks.forEach((track, index) => {

    tracks.push({

      file: path.basename(filePath),

      category,

      name:
        gpxTracks.length > 1
          ? `${path.basename(
              filePath,
              path.extname(filePath)
            )} - ${String(index + 1).padStart(2, "0")}`
          : (
              track.name ||
              path.basename(
                filePath,
                path.extname(filePath)
              )
            ),

      date: track.date,

      points: track.points

    });

  });

  console.log(
    `✓ ${category} ${path.basename(filePath)} (${gpxTracks.length} tracks)`
  );

  return;
}

    console.log(
      "✓",
      category,
      path.basename(filePath)
    );

  } catch (err) {

    console.log(
      "✗",
      filePath,
      err.message
    );

  }
}

CATEGORIES.forEach(category => {

  const dir = path.join(
    TRACKS_DIR,
    category
  );

  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir).forEach(file => {

    const ext = path
      .extname(file)
      .toLowerCase();

    if (
      ext !== ".gpx" &&
      ext !== ".kml"
    ) {
      return;
    }

    processFile(
      path.join(dir, file),
      category
    );

  });

});

const drawOrder = {
  boat: 1,
  land: 2,
  cycle: 3,
  walk: 4,
  plane: 5
};

tracks.sort(
  (a, b) =>
    drawOrder[a.category] -
    drawOrder[b.category]
);

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(tracks)
);

console.log(
  `\n🎉 Built ${tracks.length} tracks`
);
console.log(
  `📄 Saved: ${OUTPUT}`
);