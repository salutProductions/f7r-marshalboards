# Configuration

Launching the app for the first time will make it generate a default config.json file in `%appdata%/com.salutproductions.f7r-marshalboards`.

Default `config.json`:
```json
{
  "websocketUrl": "wss://f7livemanager.salutproductionscontact.workers.dev/ws",
  "defaultWidth": 250.0,
  "defaultHeight": 150.0,
  "alwaysOnTop": true
}
```

Modify the `websocketUrl` to point at your own hosted web socket.
## Hosting your own Marshal Board Websocket

Hosting your own Marshal Board Socket is pretty straight forward. The app displays flags based on JSON payloads sent by clients to a WebSocket Server that sends the latest payload to every connected client.

A payload involves two types of variables:

| Variable | Accepted Types |
| --- | --- |
| `type` | `IDLE`, `RACE_CONTROL` |
| `status` | `GREEN`, `YELLOW`, `RED`, `SC`, `SC_IN`, `FCY`, `PIT_CLOSED`, `STARTING_SOON`, `NOTHING`|

The `status` variable describes the flags. Their behaviour in the app is as following:
| Status | Behaviour |
| --- | --- |
| `GREEN` |A green background blinking 10 times, before going to black |
| `YELLOW` |A yellow background, blinking for 10 seconds, before going to black|
| `RED` | A red background that blinks indefinetly, until a new payload is received|
| `SC`| The initials "SC", with a yellow border that blinks indefinetly, until a new payload is received.|
| `SC_IN`|A yellow border that blinks indefinetly, until a new payload is received.|
| `FCY`| The initials "FCY", with a yellow border that blinks indefinetly, until a new payload is received.|
| `PIT_CLOSED`| The phrase "PIT CLOSED", with a red border that blinks indefinetly, until a new payload is received.|
| `STARTING_SOON` | The phrase "TEST", with a white border, allowing drivers to confirm connectivity.

Examples of payloads:
###### A FCY payload
```
{
    type: "RACE_CONTROL",
    status: "FCY"
}
```
###### A Red Flag payload
```
{
    type: "RACE_CONTROL",
    status: "RED"
}
```
###### A Green Flag payload
```
{
    type: "RACE_CONTROL",
    status: "GREEN"
}
```
###### Clear flags payload
```
{
    type: "IDLE",
    status: "NOTHING"
}
```

Hosting websockets can be done via a server running any modern language that supports WebSockets (Python, Java, NodeJS, C++, etc.). Other free options of hosting include Cloudflare Worker & Durable Objects.
