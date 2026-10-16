import {
  displayName,
  findStation,
  getLocations,
  getSnapshot,
  getStationState
} from "../lib/citibike.js";

function spokenResponse(nickname, state) {
  const name = displayName(nickname);

  if (!state.isInstalled) {
    return `${name} is currently unavailable.`;
  }

  if (!state.isReturning) {
    return `${name} is not accepting bike returns right now.`;
  }

  if (state.docksAvailable <= 0) {
    return `${name} is full. There are no open docks.`;
  }

  if (state.docksAvailable === 1) {
    return `${name} has 1 open dock.`;
  }

  return `${name} has ${state.docksAvailable} open docks.`;
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

    const snapshot = await getSnapshot();
    const station = findStation(snapshot.information, stationName);

    if (!station?.station_id) {
      throw new Error(`Configured station not found: ${stationName}`);
    }

    const status = snapshot.statusById.get(station.station_id);
    if (!status) {
      throw new Error(`Station status not found: ${stationName}`);
    }

    const state = getStationState(station, status);

    if (request.query?.format === "json") {
      return response.status(200).json({
        location: nickname,
        station: station.name,
        stationId: station.station_id,
        docksAvailable: state.docksAvailable,
        bikesAvailable: state.bikesAvailable,
        classicBikesAvailable: state.classicBikesAvailable,
        ebikesAvailable: state.ebikesAvailable,
        isReturning: state.isReturning,
        isRenting: state.isRenting,
        isInstalled: state.isInstalled,
        lastReported: status.last_reported ?? null
      });
    }

    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.status(200).send(spokenResponse(nickname, state));
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
