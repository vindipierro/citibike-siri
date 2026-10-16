const DISCOVERY_URL = "https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json";

let cachedFeeds;
let cachedStationInformation;

export async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "citibike-siri/2.0"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed with ${response.status}`);
  }

  return response.json();
}

export function getLocations() {
  const raw = process.env.CITIBIKE_LOCATIONS;

  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CITIBIKE_LOCATIONS must be a JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([nickname, station]) => nickname && typeof station === "string")
      .map(([nickname, station]) => [nickname.toLowerCase(), station.trim()])
  );
}

export async function getFeeds() {
  if (cachedFeeds) {
    return cachedFeeds;
  }

  const discovery = await getJson(DISCOVERY_URL);
  const feeds = discovery?.data?.en?.feeds;

  if (!Array.isArray(feeds)) {
    throw new Error("Citi Bike GBFS discovery feed is unavailable");
  }

  const byName = Object.fromEntries(feeds.map((feed) => [feed.name, feed.url]));

  if (!byName.station_information || !byName.station_status) {
    throw new Error("Required Citi Bike GBFS feeds are missing");
  }

  cachedFeeds = byName;
  return byName;
}

export async function getStationInformation(url) {
  if (cachedStationInformation) {
    return cachedStationInformation;
  }

  const information = await getJson(url);
  const stations = information?.data?.stations;

  if (!Array.isArray(stations)) {
    throw new Error("Citi Bike station information is unavailable");
  }

  cachedStationInformation = stations;
  return stations;
}

export async function getSnapshot() {
  const feeds = await getFeeds();
  const [information, statusFeed] = await Promise.all([
    getStationInformation(feeds.station_information),
    getJson(feeds.station_status)
  ]);
  const statuses = statusFeed?.data?.stations;

  if (!Array.isArray(statuses)) {
    throw new Error("Citi Bike station status is unavailable");
  }

  const statusById = new Map(statuses.map((status) => [status.station_id, status]));
  return { information, statusById };
}

export function findStation(stations, stationName) {
  return stations.find(
    (station) => station.name?.trim().toLowerCase() === stationName.toLowerCase()
  );
}

export function getBikeCounts(status) {
  const bikesAvailable = Number(
    status.num_bikes_available ?? status.num_vehicles_available ?? 0
  );
  const ebikesAvailable = Number(status.num_ebikes_available ?? 0);
  const classicBikesAvailable =
    status.num_bikes_available !== undefined
      ? Math.max(bikesAvailable - ebikesAvailable, 0)
      : null;

  return {
    bikesAvailable,
    classicBikesAvailable,
    ebikesAvailable
  };
}

export function getStationState(station, status) {
  return {
    station,
    status,
    docksAvailable: Number(status.num_docks_available ?? 0),
    ...getBikeCounts(status),
    isReturning: status.is_returning !== false && status.is_returning !== 0,
    isRenting: status.is_renting !== false && status.is_renting !== 0,
    isInstalled: status.is_installed !== false && status.is_installed !== 0
  };
}

export function displayName(nickname) {
  return nickname
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function stationLabel(station, locations) {
  const stationName = station.name?.trim().toLowerCase();
  const match = Object.entries(locations).find(
    ([, configuredName]) => configuredName.toLowerCase() === stationName
  );
  return match ? displayName(match[0]) : station.name;
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}

export function rankedStations(snapshot, lat, lon, predicate, excludeStationId = null) {
  return snapshot.information
    .filter((station) => station.station_id !== excludeStationId)
    .map((station) => {
      const status = snapshot.statusById.get(station.station_id);
      if (!status) return null;
      const state = getStationState(station, status);
      if (!predicate(state)) return null;
      return {
        ...state,
        distanceMiles: haversineMiles(lat, lon, Number(station.lat), Number(station.lon))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function formatDistance(miles) {
  if (miles < 0.1) {
    return `${Math.max(1, Math.round(miles * 5280 / 50) * 50)} feet away`;
  }
  return `${miles.toFixed(1)} miles away`;
}
