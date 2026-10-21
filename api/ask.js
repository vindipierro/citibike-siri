import {
  displayName,
  findStation,
  formatDistance,
  getLocations,
  getSnapshot,
  getStationState,
  rankedStations,
  stationLabel
} from "../lib/citibike.js";

const LOW_DOCKS = 2;
const LOW_BIKES = 1;
const RECOMMENDED_DOCKS = 3;
const NEARBY_RADIUS_MILES = 0.25;

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionedLocations(question, locations) {
  const normalizedQuestion = ` ${normalize(question)} `;
  return Object.keys(locations)
    .sort((a, b) => b.length - a.length)
    .filter((nickname) => normalizedQuestion.includes(` ${normalize(nickname)} `));
}

function detectIntent(question) {
  const q = normalize(question);

  if (/\b(e bikes?|ebikes?|electric(?: bikes?)?)\b/.test(q)) {
    return "ebikes";
  }
  if (/\b(park|parking|dock|docks|docking|return|returning|drop off|full|space|spaces|spot|spots)\b/.test(q)) {
    return "docks";
  }
  if (/\b(bike|bikes|rent|renting|ride|grab|pick up|pickup)\b/.test(q)) {
    return "bikes";
  }
  return "status";
}

function detectMode(question) {
  const q = normalize(question);
  const isNearby = /\b(near me|around me|nearby|close by)\b/.test(q);

  if (isNearby && /\b(how many|total|number of)\b/.test(q)) {
    return "nearby-count";
  }

  if (
    isNearby &&
    (/\b(how is|how are|hows|status|overview|summary|looking)\b/.test(q) ||
      /\bwhat(?: is|s)? around me\b/.test(q))
  ) {
    return "area-summary";
  }

  return "standard";
}

function parseCoordinate(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function stateForNickname(nickname, locations, snapshot) {
  const stationName = locations[nickname];
  const station = findStation(snapshot.information, stationName);
  if (!station?.station_id) {
    throw new Error(`Configured station not found: ${stationName}`);
  }
  const status = snapshot.statusById.get(station.station_id);
  if (!status) {
    throw new Error(`Station status not found: ${stationName}`);
  }
  return getStationState(station, status);
}

function nearestForIntent(snapshot, lat, lon, intent, excludeStationId = null) {
  const predicates = {
    docks: (state) => state.isInstalled && state.isReturning && state.docksAvailable >= RECOMMENDED_DOCKS,
    bikes: (state) => state.isInstalled && state.isRenting && state.bikesAvailable > 0,
    ebikes: (state) => state.isInstalled && state.isRenting && state.ebikesAvailable > 0,
    status: (state) => state.isInstalled
  };
  let ranked = rankedStations(snapshot, lat, lon, predicates[intent], excludeStationId);

  if (intent === "docks" && ranked.length === 0) {
    ranked = rankedStations(
      snapshot,
      lat,
      lon,
      (state) => state.isInstalled && state.isReturning && state.docksAvailable > 0,
      excludeStationId
    );
  }

  return ranked[0] ?? null;
}

function nearbyStates(snapshot, lat, lon) {
  return rankedStations(
    snapshot,
    lat,
    lon,
    (state) => state.isInstalled
  ).filter((state) => state.distanceMiles <= NEARBY_RADIUS_MILES);
}

function bestNearby(states, metric, eligibility) {
  return states
    .filter((state) => eligibility(state) && state[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || a.distanceMiles - b.distanceMiles)[0] ?? null;
}

function alternativeFromStation(snapshot, state, intent) {
  return nearestForIntent(
    snapshot,
    Number(state.station.lat),
    Number(state.station.lon),
    intent,
    state.station.station_id
  );
}

function alternativeText(alternative, locations, metric) {
  if (!alternative) return "";
  const label = stationLabel(alternative.station, locations);
  const count = metric === "docks" ? alternative.docksAvailable : metric === "ebikes" ? alternative.ebikesAvailable : alternative.bikesAvailable;
  const noun = metric === "docks" ? (count === 1 ? "dock" : "docks") : metric === "ebikes" ? (count === 1 ? "e-bike" : "e-bikes") : (count === 1 ? "bike" : "bikes");
  return `${label} is ${formatDistance(alternative.distanceMiles)} with ${count} ${noun}.`;
}

function answerDocks(nickname, state, snapshot, locations) {
  const name = displayName(nickname);

  if (!state.isInstalled) {
    return `${name} is currently unavailable.`;
  }

  if (!state.isReturning) {
    const alternative = alternativeFromStation(snapshot, state, "docks");
    return `${name} is not accepting returns right now. ${alternativeText(alternative, locations, "docks")}`.trim();
  }

  if (state.docksAvailable <= 0) {
    const alternative = alternativeFromStation(snapshot, state, "docks");
    return `${name} is full. ${alternativeText(alternative, locations, "docks")}`.trim();
  }

  if (state.docksAvailable <= LOW_DOCKS) {
    const alternative = alternativeFromStation(snapshot, state, "docks");
    const noun = state.docksAvailable === 1 ? "dock" : "docks";
    return `${name} only has ${state.docksAvailable} open ${noun}. ${alternativeText(alternative, locations, "docks")}`.trim();
  }

  return `Yes. ${name} has ${state.docksAvailable} open docks.`;
}

function answerBikes(nickname, state, snapshot, locations, electricOnly = false) {
  const name = displayName(nickname);
  const metric = electricOnly ? "ebikes" : "bikes";
  const count = electricOnly ? state.ebikesAvailable : state.bikesAvailable;
  const noun = electricOnly ? (count === 1 ? "e-bike" : "e-bikes") : (count === 1 ? "bike" : "bikes");

  if (!state.isInstalled || !state.isRenting) {
    const alternative = alternativeFromStation(snapshot, state, metric);
    return `${name} is not renting bikes right now. ${alternativeText(alternative, locations, metric)}`.trim();
  }

  if (count <= 0) {
    const alternative = alternativeFromStation(snapshot, state, metric);
    return `No. ${name} has no ${electricOnly ? "e-bikes" : "bikes"} available. ${alternativeText(alternative, locations, metric)}`.trim();
  }

  if (count <= LOW_BIKES) {
    const alternative = alternativeFromStation(snapshot, state, metric);
    return `${name} only has ${count} ${noun}. ${alternativeText(alternative, locations, metric)}`.trim();
  }

  return `Yes. ${name} has ${count} ${noun} available.`;
}

function answerStatus(nickname, state) {
  const name = displayName(nickname);
  if (!state.isInstalled) return `${name} is currently unavailable.`;
  return `${name} has ${state.docksAvailable} open docks and ${state.bikesAvailable} bikes, including ${state.ebikesAvailable} e-bikes.`;
}

function answerNearMe(intent, snapshot, locations, lat, lon) {
  const nearest = nearestForIntent(snapshot, lat, lon, intent);
  if (!nearest) {
    return intent === "docks"
      ? "I couldn't find a nearby station with an open dock."
      : "I couldn't find a nearby station with an available bike.";
  }

  const label = stationLabel(nearest.station, locations);
  const distance = formatDistance(nearest.distanceMiles);

  if (intent === "docks") {
    return `${label} is ${distance} with ${nearest.docksAvailable} open docks.`;
  }
  if (intent === "ebikes") {
    return `${label} is ${distance} with ${nearest.ebikesAvailable} e-bikes.`;
  }
  if (intent === "bikes") {
    return `${label} is ${distance} with ${nearest.bikesAvailable} bikes.`;
  }
  return `${label} is ${distance}. It has ${nearest.docksAvailable} open docks and ${nearest.bikesAvailable} bikes.`;
}

function answerNearbyCount(intent, snapshot, lat, lon) {
  const states = nearbyStates(snapshot, lat, lon);
  if (states.length === 0) {
    return "I couldn't find a Citi Bike station within a quarter mile.";
  }

  if (intent === "status") {
    return `There are ${states.length} Citi Bike stations within a quarter mile.`;
  }

  const config = {
    docks: {
      metric: "docksAvailable",
      noun: "open docks",
      eligible: (state) => state.isReturning
    },
    bikes: {
      metric: "bikesAvailable",
      noun: "bikes",
      eligible: (state) => state.isRenting
    },
    ebikes: {
      metric: "ebikesAvailable",
      noun: "e-bikes",
      eligible: (state) => state.isRenting
    }
  }[intent];

  const eligible = states.filter(config.eligible);
  const count = eligible.reduce((total, state) => total + state[config.metric], 0);
  return `Within a quarter mile, there are ${count} ${config.noun} across ${eligible.length} active stations.`;
}

function answerAreaSummary(snapshot, locations, lat, lon) {
  const states = nearbyStates(snapshot, lat, lon);
  if (states.length === 0) {
    return "I couldn't find a Citi Bike station within a quarter mile.";
  }

  const renting = states.filter((state) => state.isRenting);
  const returning = states.filter((state) => state.isReturning);
  const totalBikes = renting.reduce((total, state) => total + state.bikesAvailable, 0);
  const totalEbikes = renting.reduce((total, state) => total + state.ebikesAvailable, 0);
  const totalDocks = returning.reduce((total, state) => total + state.docksAvailable, 0);
  const bestBike = bestNearby(states, "bikesAvailable", (state) => state.isRenting);
  const bestDock = bestNearby(states, "docksAvailable", (state) => state.isReturning);
  let text = `Within a quarter mile, ${states.length} stations have ${totalBikes} bikes, including ${totalEbikes} e-bikes, and ${totalDocks} open docks.`;

  if (bestBike) {
    text += ` Best for a bike is ${stationLabel(bestBike.station, locations)} with ${bestBike.bikesAvailable}.`;
  }
  if (bestDock) {
    text += ` Best for parking is ${stationLabel(bestDock.station, locations)} with ${bestDock.docksAvailable} open docks.`;
  }

  return text;
}

function answerComparison(nicknames, intent, locations, snapshot) {
  const states = nicknames.slice(0, 2).map((nickname) => ({
    nickname,
    state: stateForNickname(nickname, locations, snapshot)
  }));
  const metric = intent === "ebikes" ? "ebikesAvailable" : intent === "bikes" ? "bikesAvailable" : "docksAvailable";
  const noun = intent === "ebikes" ? "e-bikes" : intent === "bikes" ? "bikes" : "open docks";
  const [a, b] = states;
  const aCount = a.state[metric];
  const bCount = b.state[metric];

  if (aCount === bCount) {
    return `${displayName(a.nickname)} and ${displayName(b.nickname)} both have ${aCount} ${noun}.`;
  }

  const better = aCount > bCount ? a : b;
  return `${displayName(better.nickname)} has more: ${better.state[metric]} ${noun}. ${displayName(a.nickname)} has ${aCount}; ${displayName(b.nickname)} has ${bCount}.`;
}

async function readInput(request) {
  if (request.method === "POST") {
    let body = request.body ?? {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== "object") body = {};
    return {
      question: String(body.q ?? body.question ?? "").trim(),
      lat: body.lat,
      lon: body.lon,
      format: body.format
    };
  }

  return {
    question: String(request.query?.q ?? request.query?.question ?? "").trim(),
    lat: request.query?.lat,
    lon: request.query?.lon,
    format: request.query?.format
  };
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).send("Method not allowed");
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const input = await readInput(request);
    if (!input.question) {
      return response.status(400).send("Ask a Citi Bike question.");
    }

    const locations = getLocations();
    const snapshot = await getSnapshot();
    const intent = detectIntent(input.question);
    const mode = detectMode(input.question);
    const nicknames = mentionedLocations(input.question, locations);
    const lat = parseCoordinate(input.lat, -90, 90);
    const lon = parseCoordinate(input.lon, -180, 180);
    let text;

    if (nicknames.length >= 2) {
      text = answerComparison(nicknames, intent, locations, snapshot);
    } else if (nicknames.length === 1) {
      const nickname = nicknames[0];
      const state = stateForNickname(nickname, locations, snapshot);
      text = intent === "docks"
        ? answerDocks(nickname, state, snapshot, locations)
        : intent === "bikes"
          ? answerBikes(nickname, state, snapshot, locations, false)
          : intent === "ebikes"
            ? answerBikes(nickname, state, snapshot, locations, true)
            : answerStatus(nickname, state);
    } else if (lat !== null && lon !== null && mode === "nearby-count") {
      text = answerNearbyCount(intent, snapshot, lat, lon);
    } else if (lat !== null && lon !== null && mode === "area-summary") {
      text = answerAreaSummary(snapshot, locations, lat, lon);
    } else if (lat !== null && lon !== null) {
      text = answerNearMe(intent, snapshot, locations, lat, lon);
    } else {
      text = "I didn't hear a saved location. Try asking about one of your saved places, or include your current location.";
    }

    if (input.format === "json") {
      return response.status(200).json({
        question: input.question,
        intent,
        mode,
        locations: nicknames,
        response: text
      });
    }

    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.status(200).send(text);
  } catch (error) {
    console.error(error);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response
      .status(502)
      .send("I couldn't check Citi Bike availability right now. Try again in a moment.");
  }
}
