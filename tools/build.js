//     To regenerate map       //
//    after adding new gpx.    //
//                             //
//       tools/build.js        //

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

const ROOT = path.join(__dirname, "..");
const TRACKS_DIR = path.join(ROOT, "..", "tracks_originals");
const OUTPUT = path.join(ROOT, "tracks.json");

const CATEGORIES = ["walk", "cycle", "land", "boat", "plane"];

const tracks = [];

const HOME_LAT = 41.73164237532438;
const HOME_LON = 1.8281919505607196;

const HOME_RADIUS_METERS = 150;

const SPIKE_DISTANCE_METERS = 200;
const SPIKE_RETURN_METERS = 30;

const STOP_RADIUS_METERS = 30;
const STOP_TIME_SECONDS = 120;

function distanceMeters(lat1, lon1, lat2, lon2) {

  const R = 6371000;

  const dLat =
    (lat2 - lat1) * Math.PI / 180;

  const dLon =
    (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

function trimHomeEndpoints(points) {

  let start = 0;

  while (
    start < points.length &&
    distanceMeters(
      points[start].lat,
      points[start].lon,
      HOME_LAT,
      HOME_LON
    ) < HOME_RADIUS_METERS
  ) {
    start++;
  }

  let end = points.length - 1;

  while (
    end > start &&
    distanceMeters(
      points[end].lat,
      points[end].lon,
      HOME_LAT,
      HOME_LON
    ) < HOME_RADIUS_METERS
  ) {
    end--;
  }


  // Randomly extend the cut so it doesn't always stop at the same place
  const randomTrim = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  // Random extra points to remove (adjust range to your GPS density)
  const extraStart = randomTrim(5, 25);
  const extraEnd = randomTrim(5, 25);

  start = Math.min(start + extraStart, end - 10);
  end = Math.max(end - extraEnd, start + 10);

  return points.slice(start, end + 1);
}

function removeGpsSpikes(points) {

  if (points.length < 3)
    return points;

  const cleaned = [points[0]];

  for (
    let i = 1;
    i < points.length - 1;
    i++
  ) {

    const A = points[i - 1];
    const B = points[i];
    const C = points[i + 1];

    const AB = distanceMeters(
      A.lat, A.lon,
      B.lat, B.lon
    );

    const BC = distanceMeters(
      B.lat, B.lon,
      C.lat, C.lon
    );

    const AC = distanceMeters(
      A.lat, A.lon,
      C.lat, C.lon
    );

    const isSpike =
      AB > SPIKE_DISTANCE_METERS &&
      BC > SPIKE_DISTANCE_METERS &&
      AC < SPIKE_RETURN_METERS;

    if (!isSpike) {
      cleaned.push(B);
    }

  }

  cleaned.push(
    points[points.length - 1]
  );

  return cleaned;
}

function removeImpossibleSpeeds(points, category) {

  const limits = {
    walk: 15,
    cycle: 70,
    land: 180,
    boat: 120,
    plane: 1200
  };

  const maxSpeed =
    limits[category] || 200;

  if (points.length < 2)
    return points;

  const cleaned = [points[0]];

  for (let i = 1; i < points.length; i++) {

    const prev =
      cleaned[cleaned.length - 1];

    const curr = points[i];

    if (!prev.time || !curr.time) {
      cleaned.push(curr);
      continue;
    }

    const distance =
      distanceMeters(
        prev.lat,
        prev.lon,
        curr.lat,
        curr.lon
      );

    const dt =
      (
        new Date(curr.time) -
        new Date(prev.time)
      ) / 1000;

    if (dt <= 0) continue;

    const speed =
      distance / dt * 3.6;

    if (speed <= maxSpeed) {
      cleaned.push(curr);
    }
  }

  return cleaned;
}

function collapseStationaryClusters(points, category) {

  if (
    category !== "walk" &&
    category !== "cycle"
  ) {
    return points;
  }

  if (points.length < 2)
    return points;

  const result = [];

  let i = 0;

  while (i < points.length) {

    const start = points[i];

    if (!start.time) {
      result.push(start);
      i++;
      continue;
    }

    let foundStop = false;

    for (let j = i + 1; j < points.length; j++) {

      if (!points[j].time)
        break;

      const elapsed =
        (
          new Date(points[j].time) -
          new Date(start.time)
        ) / 1000;

      const dist =
        distanceMeters(
          start.lat,
          start.lon,
          points[j].lat,
          points[j].lon
        );

      if (
        elapsed >= STOP_TIME_SECONDS &&
        dist <= STOP_RADIUS_METERS
      ) {

        result.push(start);

        while (
          j < points.length &&
          distanceMeters(
            start.lat,
            start.lon,
            points[j].lat,
            points[j].lon
          ) <= STOP_RADIUS_METERS
        ) {
          j++;
        }

        i = j;
        foundStop = true;
        break;
      }

      if (dist > STOP_RADIUS_METERS)
        break;
    }

    if (!foundStop) {
      result.push(start);
      i++;
    }
  }

  return result;
}

function removeDetourSpikes(points) {

  if (points.length < 3)
    return points;

  const cleaned = [points[0]];

  for (
    let i = 1;
    i < points.length - 1;
    i++
  ) {

    const A = points[i - 1];
    const B = points[i];
    const C = points[i + 1];

    const AB =
      distanceMeters(
        A.lat, A.lon,
        B.lat, B.lon
      );

    const BC =
      distanceMeters(
        B.lat, B.lon,
        C.lat, C.lon
      );

    const AC =
      distanceMeters(
        A.lat, A.lon,
        C.lat, C.lon
      );

    const isDetour =
      AB > 100 &&
      BC > 100 &&
      (AB + BC) > (AC * 5);

    if (!isDetour) {
      cleaned.push(B);
    }

  }
  cleaned.push(
    points[points.length - 1]
  );

  return cleaned;
}

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

function extractGpxTracks(obj, category) {

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
  points.push({
    lat,
    lon,
    time: pt.time || null
  });
}

      });

    });

    if (points.length >= 2) {

      let cleanedPoints = points;

cleanedPoints =
  removeImpossibleSpeeds(
    cleanedPoints,
    category
  );

cleanedPoints =
  removeGpsSpikes(cleanedPoints);

cleanedPoints =
  removeDetourSpikes(cleanedPoints);

cleanedPoints =
  collapseStationaryClusters(
    cleanedPoints,
    category
  );

cleanedPoints =
  trimHomeEndpoints(cleanedPoints);

if (cleanedPoints.length >= 2) {

  results.push({
    name:
      trk.name ||
      `Track ${String(index + 1).padStart(2, "0")}`,
    date: extractDate(obj),
    points: cleanedPoints.map(
      p => [p.lat, p.lon]
    )
  });

}

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

  const gpxTracks = extractGpxTracks(obj, category);

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