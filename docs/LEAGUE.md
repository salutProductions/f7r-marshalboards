# Configuration

Launching the app for the first time will make it generate a default config.json file in `%appdata%/com.salutproductions.f7r-marshalboards`.

Default `config.json`:
```json
{
  "websocketUrl": "wss://f7livemanager.salutproductionscontact.workers.dev/ws",
  "defaultWidth": 220.0,
  "defaultHeight": 90.0,
  "alwaysOnTop": true,
  "roundedCorners": true,
  "audioEnabled": true,
  "audioVolume": 1.0
}
```

Modify the `websocketUrl` to point at your own hosted web socket.
Set `roundedCorners` to `false` to use square corners instead.
Set `audioEnabled` to `false` to disable the [voice callouts](#voice-callouts). `audioVolume` goes from `0.0` to `1.0`.
When the app is updated, any new settings are added to an existing `config.json` with their default values. Existing settings are left unchanged.

Settings can also be changed from the app by right-clicking the board and choosing Settings. Changes apply immediately, except the default window size, which applies on the next launch. The right-click menu also has an Audio callouts toggle for quickly muting the app.

## Voice callouts

The app can play voice clips when race control changes the flag, like a race engineer on the radio. It also announces the FCY countdown ("Full course yellow in 20 seconds", then "5, 4, 3, 2, 1" and the FCY call).

Clips are bundled into the app from `public/audio/` when it is built. The repository ships with machine-generated placeholder voices. To use your own recordings, replace the files and rebuild the app. Clips can be `.mp3`, `.ogg`, `.opus` or `.wav`, checked in that order. Every clip is optional. A missing clip just means that callout stays silent.

| Status | File | Placeholder phrase |
| --- | --- | --- |
| `GREEN` | `green` | "Green flag, green flag" |
| `YELLOW` | `yellow` | "Yellow flag, yellow flag" |
| `RED` | `red` | "Red flag, red flag, session stopped" |
| `FCY` (also when a countdown reaches zero) | `fcy` | "Full course yellow, full course yellow" |
| `SC` | `sc` | "Safety car, safety car" |
| `SC_IN` | `sc-in` | "Safety car in this lap" |
| `PIT_CLOSED` | `pit-closed` | "Pit lane closed" |
| `UNLAP` | `unlap` | "Lapped cars may now overtake" |
| `S1_Y` / `S2_Y` / `S3_Y` | `s1-yellow`, `s2-yellow`, `s3-yellow` | "Yellow, sector 1/2/3" |
| `NOTHING` | `clear` | "Track clear" |
| N seconds left in a FCY countdown | `fcy-in-N`, for example `fcy-in-20` | "Full course yellow in 20 seconds" |
| FCY countdown start, no matching `fcy-in-N` | `fcy-starting` | "Full course yellow imminent" |
| Final five seconds of a countdown | `5`, `4`, `3`, `2`, `1` | "Five" through "One" |

During a countdown, `fcy-in-N` plays when N seconds remain, for N of 120, 90, 60, 45, 30, 20, 15 and 10. The countdown start also plays `fcy-in-N` for its starting number, or `fcy-starting` if that clip doesn't exist. You only need the milestones you want called out. The chequered and starting-soon statuses have no callouts.

Callouts only play on actual changes. The state received when the app starts is not announced, and repeated payloads of the same status stay silent. Like the visual countdown, a stalled client skips to the correct second instead of replaying missed numbers. A new callout always interrupts the previous one.

### Testing locally

The repository includes a small test server in `scripts/mock-server.mjs`. Run it with `node scripts/mock-server.mjs`, point `websocketUrl` at `ws://localhost:8765` and start the app. Typing commands like `SC`, `fcy 20` or `drop` into the server's terminal sends them to the app.

## Hosting your own Marshal Board Websocket

Hosting your own Marshal Board socket is straightforward. The app displays flags from JSON payloads broadcast by a WebSocket server. A newly connected client must receive the latest state.

For the bundled Worker, send authenticated JSON requests to `POST /update`. Every update must include the `password` configured in the Worker's `ADMIN_PASSWORD` secret.

A normal flag payload involves two variables:

| Variable | Accepted Types |
| --- | --- |
| `type` | `IDLE`, `RACE_CONTROL` |
| `status` | `GREEN`, `YELLOW`, `RED`, `SC`, `SC_IN`, `FCY`, `PIT_CLOSED`, `STARTING_SOON`, `NOTHING`, `CHEQUERED_FLAG`, `GT3_Q_GREEN`, `GT3_Q_CHQ`, `HYC_Q_GREEN`, `HYC_Q_CHQ`, `LMP2_Q_GREEN`, `LMP2_Q_CHQ`, `LMP3_Q_GREEN`, `LMP3_Q_CHQ`, `S1_Y`, `S2_Y`, `S3_Y`, `UNLAP` |

The `status` variable selects the flag. Its behaviour in the app is:
| Status | Behaviour |
| --- | --- |
| `GREEN` | A green background that blinks 10 times before returning to black. |
| `YELLOW` | A yellow background that blinks until a new payload is received. |
| `RED` | A red background that blinks until a new payload is received. |
| `SC` | The initials "SC", with a yellow border that blinks until a new payload is received. |
| `SC_IN` | A yellow border that blinks until a new payload is received. |
| `FCY` | The initials "FCY", with a yellow border that blinks until a new payload is received. |
| `PIT_CLOSED` | The phrase "PIT CLOSED", with a red border that blinks until a new payload is received. |
| `STARTING_SOON` | The phrase "STARTING SOON", with a white border, allowing drivers to confirm connectivity. |
| `CHEQUERED_FLAG` | A flag with black and white squares that blinks indefinitely, until a new payload is received. |

## Server-authoritative FCY countdown

Protocol version 1 adds a scheduled FCY countdown. Race control requests a duration, and the server generates all timestamps from its own clock. Do not calculate or submit `countdownStartsAt` or `fcyAt` from the race-control computer.

POST this payload to `/update`:

```json
{
  "password": "your-admin-password",
  "type": "RACE_CONTROL",
  "status": "FCY",
  "countdownSeconds": 20
}
```

Including `countdownSeconds` with `RACE_CONTROL` / `FCY` schedules the countdown. Omitting it keeps the existing immediate FCY behaviour. `countdownSeconds` accepts whole numbers from `5` to `120`. The Worker also accepts `status: "FCY_COUNTDOWN"` (defaulting to 20 seconds) and the earlier `type: "FCY_COUNTDOWN"` request as compatibility aliases. The bundled Cloudflare Worker gives receivers a two-second distribution lead and broadcasts a state resembling:

```json
{
  "protocolVersion": 1,
  "type": "FCY_COUNTDOWN",
  "status": "FCY",
  "eventId": "a-server-generated-uuid",
  "sequence": 42,
  "serverSentAt": 1783971000000,
  "countdownSeconds": 20,
  "countdownStartsAt": 1783971002000,
  "fcyAt": 1783971022000
}
```

Receivers display the previous flag during the two-second lead, show `FCY 20` through `FCY 1`, and switch to `FCY` at `fcyAt`. The number is always recalculated from server time, so a late or temporarily stalled receiver skips to the correct second instead of replaying missed ticks.

The Worker also schedules a Durable Object alarm at `fcyAt` and broadcasts a normal `RACE_CONTROL` / `FCY` state. This final message updates stored state and gives legacy receivers an immediate FCY fallback, though legacy versions do not display the countdown.

Version 1 receivers send WebSocket clock-sync requests:

```json
{
  "type": "TIME_SYNC",
  "requestId": "sync-123",
  "clientSentAt": 1783970999000
}
```

A compatible server must echo `requestId` and `clientSentAt`, and add `serverReceivedAt` and `serverSentAt`. Receivers sample the lowest round-trip result to estimate server time and use these messages as connection health checks.

Examples of payloads:
###### A FCY payload
```json
{
  "type": "RACE_CONTROL",
  "status": "FCY"
}
```
###### A Red Flag payload
```json
{
  "type": "RACE_CONTROL",
  "status": "RED"
}
```
###### A Green Flag payload
```json
{
  "type": "RACE_CONTROL",
  "status": "GREEN"
}
```
###### Clear flags payload
```json
{
  "type": "RACE_CONTROL",
  "status": "NOTHING"
}
```

Hosting websockets can be done via a server running any modern language that supports WebSockets (Python, Java, NodeJS, C++, etc.). Other free options of hosting include Cloudflare Worker & Durable Objects.
