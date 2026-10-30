# Citi Bike Siri

A Siri-friendly API and lightweight web assistant for live Citi Bike availability. Save nicknames for stations, ask natural-language questions, and let one Shortcut or the deployment landing page handle all of them.

## Configuration

Set `CITIBIKE_LOCATIONS` to a JSON object mapping a nickname to an exact Citi Bike station name:

```text
CITIBIKE_LOCATIONS={"home":"Example Station Name","work":"Another Station Name"}
```

This can be a normal plain environment variable on Vercel. The public repository simply does not need to contain your actual mappings.

For local development, put the value in `.env.local`. Environment files are ignored by Git. `locations.example.json` shows the expected shape.

## Web assistant

The deployment root includes an interactive Ask page backed by the same `/ask` endpoint used by Siri.

It includes:

- A mobile-friendly natural-language input
- Browser geolocation for nearby station questions
- Example prompts for common questions
- A live response area
- Recent question history stored only in the browser

The page sends a JSON `POST` request to `/ask`, so web and Siri requests use the same parsing and Citi Bike data logic.

## Smart questions

Use the universal endpoint:

```text
GET /ask?q=Can%20I%20park%20at%20home
```

It understands the saved nickname anywhere in the question and currently supports:

- Parking and open docks: `Can I park at home?`, `Is work full?`, `How many docks at home?`
- Bikes: `Can I get a bike at work?`, `How many bikes at home?`
- Classic bikes: `Are there classic bikes at work?`, `Where is the closest classic bike?`, `How many regular bikes are near me?`
- E-bikes: `Are there e-bikes at work?`
- Status: `What's home looking like?`, `Home status`
- Comparisons: `Which has more docks, home or work?`, `Which has more classic bikes, home or work?`
- Location-aware searches when `lat` and `lon` are included: `Where can I park near me?`, `Where is the closest e-bike?`, `Find me a classic bike nearby`
- Nearby totals within a quarter mile: `How many e-bikes are near me?`, `How many classic bikes are near me?`, `How many docks are around me?`
- Area summaries: `How's Citi Bike around me?`

When a saved destination is full or nearly full, the response automatically suggests the nearest station with a healthier number of open docks. Bike, classic-bike, and e-bike questions also offer a nearby alternative when availability is empty or very low.

Area summaries report the total bikes, classic bikes, e-bikes, and open docks within a quarter mile, plus the strongest nearby bike and parking options.

### Location-aware example

```text
GET /ask?q=Where%20can%20I%20park%20near%20me&lat=40.0000&lon=-73.0000
```

### JSON debugging

Append `format=json`:

```text
GET /ask?q=Can%20I%20park%20at%20home&format=json
```

The endpoint also accepts a JSON `POST` body containing `q`, `lat`, `lon`, and optionally `format`.

## Direct station endpoints

The original short endpoints still work:

```text
GET /home
GET /home?format=json
GET /api/location?location=home
```

A spoken response might be:

```text
Home has 7 open docks.
```

The JSON response includes docks, total bikes, classic bikes when available, e-bikes, and rental/return status.

## One Siri Shortcut

Create a single Shortcut named something like **Citi Bike**:

1. **Ask for Input** with the prompt `What do you want to know?`
2. **Get Current Location**
3. **Get Details of Locations** → Latitude
4. **Get Details of Locations** → Longitude
5. **URL Encode** the spoken input
6. Build this URL:

```text
https://YOUR-HOST/ask?q=[Encoded Input]&lat=[Latitude]&lon=[Longitude]
```

7. **Get Contents of URL**
8. **Speak Text** using the response

Run it once manually so iOS can grant any required permissions. After that, invoke the Shortcut through Siri or AirPods and ask about any current or future saved location. Adding a new location no longer requires creating another Shortcut.

## Data source

Citi Bike publishes live system data using GBFS. This project uses the Citi Bike discovery feed plus `station_information` and `station_status`.

No Citi Bike or Lyft account, API key, or app authentication is required.

## Adding locations

Add another nickname/station pair to `CITIBIKE_LOCATIONS` and redeploy or restart the host if required. The `/ask` endpoint will recognize the new nickname automatically.

## Current behavior

- Natural-language intent parsing without an LLM
- Saved-location aliases
- Parking, bike, classic-bike, e-bike, status, and comparison questions
- Nearby fallback when a destination is full or low
- `near me` searches using Shortcut- or browser-provided coordinates
- Nearby totals and quarter-mile area summaries
- Interactive web Ask interface
- Plain-text responses optimized for Siri, plus JSON debugging
