# Citi Bike Siri

A tiny Siri-friendly API for checking live Citi Bike dock availability at your favorite stations.

You define private nicknames for Citi Bike stations, and each nickname becomes a URL. For example, a private config containing:

```json
{
  "home": "Example Station Name",
  "work": "Another Station Name"
}
```

creates:

```text
/home
/work
```

The public repository does not need to contain your real locations.

## Configuration

Set a `CITIBIKE_LOCATIONS` environment variable containing a JSON object that maps a nickname to an exact Citi Bike station name:

```text
CITIBIKE_LOCATIONS={"home":"Example Station Name","work":"Another Station Name"}
```

Keep this value private. Do not commit it to the repository.

For local development, put it in `.env.local`. Environment files are ignored by Git.

`locations.example.json` is provided only as a harmless example of the expected shape.

## API

### Spoken response

```text
GET /home
```

Example response:

```text
Home has 7 open docks.
```

### JSON response

```text
GET /home?format=json
```

Example shape:

```json
{
  "location": "home",
  "station": "Example Station Name",
  "docksAvailable": 7,
  "bikesAvailable": 12,
  "classicBikesAvailable": 8,
  "ebikesAvailable": 4,
  "isReturning": true,
  "isRenting": true
}
```

The underlying endpoint is also available as:

```text
GET /api/location?location=home
```

The included `vercel.json` adds the short `/home` style route on Vercel. On another host, configure an equivalent rewrite from `/:location` to `/api/location?location=:location` if needed.

## Siri Shortcut

Create a Shortcut for each nickname with these actions:

1. **URL**: `https://YOUR-HOST/home`
2. **Get Contents of URL**
3. **Speak Text** using the result of Get Contents of URL

Name the Shortcut whatever phrase you want to say to Siri.

## Data source

Citi Bike publishes live system data using GBFS. This project uses the current Citi Bike discovery feed and its `station_information` and `station_status` endpoints.

No Citi Bike or Lyft account, API key, or app authentication is required.

## Adding locations

Adding another location does not require changing the code. Just add another nickname/station pair to `CITIBIKE_LOCATIONS` and redeploy or restart the host if required.

## Roadmap

- Find the nearest station with open docks when a destination is full
- Optional low-parking warnings
- More natural Siri phrasing
- Bike-type-specific voice responses
