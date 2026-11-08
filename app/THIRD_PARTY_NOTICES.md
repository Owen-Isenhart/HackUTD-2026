# Third-party code and data

## Code

`src/location/nearbyStores.ts` contains code adapted from two open-source projects.
The file's header comment lists what was taken from each and what was changed.

| Source | File used | Licence | Licence text |
| --- | --- | --- | --- |
| [nirholas/x402-places](https://github.com/nirholas/x402-places) | `src/service.ts` (`searchPlaces`, `toPoi`, `buildAddress`, `esc`) | Apache-2.0 | [licenses/x402-places-Apache-2.0.txt](licenses/x402-places-Apache-2.0.txt) |
| [zeSchlausKwab/earthly](https://github.com/zeSchlausKwab/earthly) | `contextvm/tools/overpass.ts` (`executeQuery`, endpoint list) | MIT, Copyright (c) 2026 Schlaus Kwab | [licenses/earthly-MIT.txt](licenses/earthly-MIT.txt) |

The adapted code was modified for this app (Apache-2.0 section 4(b)). The x402-places
repository has no NOTICE file.

`src/location/geo.ts` (`distanceInMeters`) and `src/location/useUserLocation.ts` follow
code from this team's own feat-rs branch.

## Data

Store data comes from OpenStreetMap through the public Overpass API.
© OpenStreetMap contributors, available under the Open Database Licence
(https://www.openstreetmap.org/copyright). The app shows this credit under the store list.
