# Ride Readout

A browser tool for everyday cyclists. Drop in one ride file and get a short readout in plain language: how hard it was, where it got hard, and how it compares with your last ride.

Rides stay on the rider's device. There is no account and no server.

A Sheridan Interaction Design portfolio project (Portfolio 1, Project 3) by Yiyang Zhang, Johnny and Jie Zhou.

## What it does

| Row | What it says | Where it comes from |
| --- | --- | --- |
| Summary | One sentence: length, effort or pace, climbs, stops | All of the below |
| Effort | Time in the American Heart Association's moderate (50–70% of max heart rate) and vigorous (70–85%) ranges | Heart rate in the file, and the rider's age (max = 220 − age) or their own max |
| Where it got hard | The climbs, the speed held on them, and the stretch with the highest heart rate | Elevation, speed, heart rate |
| Stops | Stops of 90 seconds or more, and the shorter pauses in total | Speed |
| Fastest | Top speed, where, and whether it was downhill | Speed, elevation |
| Vs last ride | Distance, speed and heart rate against the ride before; says "same route" when it is | The rides already added |
| Data check | GPS jumps, drift while stopped, a device distance that disagrees with the track, a recording left running, gaps in heart rate | The file itself |

Two rules run through all of it:

1. **Describe, don't prescribe.** The readout says what happened. It doesn't coach, and it isn't medical advice.
2. **Say so when data is missing or looks wrong.** No heart rate means "I can't say how hard this was", not a guess.

## Getting a ride in

- **HealthFit `.FIT`** (best from Apple Watch): one ride at a time, heart rate included.
- **Apple Health `export.zip`**: read in place in the browser, even at 1 GB+. The zip's index is used to pull out single route files, and `export.xml` is streamed past once in a Web Worker to list workouts and collect heart rate. Nothing is loaded whole and nothing is uploaded.
- **Any single `.FIT` or `.GPX`**: Garmin, Wahoo, Strava exports, bike computers.
- No file handy? The app ships two made-up sample rides.

## Privacy

- Rides are stored in IndexedDB and settings in localStorage, in the rider's browser only.
- The route is drawn with no map underneath, and its first and last 500 m are hidden by default.
- In production a Content-Security-Policy (`connect-src 'self'`, see `vercel.json`) makes the browser itself refuse any request to another host, so "nothing leaves this device" is enforced, not just promised.
- Fonts are bundled. The page makes no third-party requests.

## Run it

```bash
npm install
npm run dev      # develop
npm test         # the readout rules, against synthetic rides
npm run build    # type-check and build to dist/
npm run preview  # serve the build with the production security headers
```

Needs Node 20.19 or newer.

## Where things are

```
src/lib/parseFit.ts        .FIT in (Garmin's FIT SDK), loaded only when a .FIT arrives
src/lib/parseGpx.ts        .GPX in, no DOM needed
src/workers/appleExport.worker.ts   Apple Health export.zip, streamed in a worker
src/lib/analyze.ts         measured facts: distance, stops, climbs, effort ranges, data problems
src/lib/readout.ts         the wording rules: facts in, sentences out
src/lib/store.ts           IndexedDB
src/components/            readout card, charts, route drawing, add-ride flow, settings
tests/                     unit tests for the rules
```

The thresholds the team can argue with (what counts as a stop, a climb, a GPS jump) are constants at the top of `src/lib/analyze.ts`.

## Deploy

It is a static site. On Vercel: import the GitHub repository, keep the detected Vite settings, deploy. `vercel.json` adds the security headers.

## Credits

- Effort ranges: American Heart Association, [Target Heart Rates](https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates).
- `.FIT` decoding: [Garmin FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk), under the FIT Protocol License.
- Zip reading: [zip.js](https://github.com/gildas-lormeau/zip.js). Typeface: Inter.
