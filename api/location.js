const DISCOVERY_URL = "https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json";

let cachedFeeds;
let cachedStationInformation;

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "citibike-siri/1.0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed with ${response.status}`);
  }

  return response.json();
}

function getLocations() {
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

async function getFeeds() {
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

async function getStationInformation(url) {
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

function findStation(stations, stationName) {
  return stations.find(
    (station) => station.name?.trim().toLowerCase() === stationName.toLowerCase()
  );
}

function getBikeCounts(status) {
  const hasSplitBikeCounts =
    status.num_bikes_available !== undefined ||
    status.num_ebikes_available !== undefined;

  if (hasSplitBikeCounts) {
    const classicBikesAvailable = Number(status.num_bikes_available ?? 0);
    const ebikesAvailable = Number(status.num_ebikes_available ?? 0);

    return {
      bikesAvailable: classicBikesAvailable + ebikesAvailable,
      classicBikesAvailable,
      ebikesAvailable
    };
  }

  const bikesAvailable = Number(status.num_vehicles_available ?? 0);

  return {
    bikesAvailable,
    classicBikesAvailable: null,
    ebikesAvailable: null
  };
}

function displayName(nickname) {
  return nickname
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function spokenResponse(nickname, status) {
  const name = displayName(nickname);

  if (status.is_installed === false) {
    return `${name} is currently unavailable.`;
  }

  if (status.is_returning === false) {
    return `${name} is not accepting bike returns right now.`;
  }

  const docks = Number(status.num_docks_available ?? 0);

  if (docks <= 0) {
    return `${name} is full. There are no open docks.`;
  }

  if (docks === 1) {
    return `${name} has 1 open dock.`;
  }

  return `${name} has ${docks} open docks.`;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).send("Method not allowed");
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");

  const nickname = String(request.query?.location ?? "").trim().toLowerCase();

  if (!nickname || !/^[a-z0-9_-]+$/.test(nickname)) {
    return response.status(400).send("Invalid location nickname.");
  }

  try {
    const locations = getLocations();
    const stationName = locations[nickname];

    if (!stationName) {
      return response.status(404).send(`Unknown location: ${nickname}`);
    }

    const feeds = await getFeeds();
    const stationInformation = await getStationInformation(feeds.station_information);
    const station = findStation(stationInformation, stationName);

    if (!station?.station_id) {
      throw new Error(`Configured station not found: ${stationName}`);
    }

    const statusFeed = await getJson(feeds.station_status);
    const stations = statusFeed?.data?.stations;

    if (!Array.isArray(stations)) {
      throw new Error("Citi Bike station status is unavailable");
    }

    const status = stations.find((item) => item.station_id === station.station_id);

    if (!status) {
      throw new Error(`Station status not found: ${stationName}`);
    }

    if (request.query?.format === "json") {
      return response.status(200).json({
        location: nickname,
        station: station.name,
        stationId: station.station_id,
        docksAvailable: Number(status.num_docks_available ?? 0),
        ...getBikeCounts(status),
        isReturning: Boolean(status.is_returning),
        isRenting: Boolean(status.is_renting),
        isInstalled: Boolean(status.is_installed),
        lastReported: status.last_reported ?? null
      });
    }

    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.status(200).send(spokenResponse(nickname, status));
  } catch (error) {
    console.error(error);

    if (request.query?.format === "json") {
      return response.status(502).json({
        error: "Citi Bike availability is temporarily unavailable"
      });
    }

    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response
      .status(502)
      .send("I couldn't check Citi Bike availability right now. Try again in a moment.");
  }
}
