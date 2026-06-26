# F7R LMU MarshalBoards

A small Tauri overlay for showing race-control signals from an F7R live manager websocket. It stays frameless and compact so it can sit over Le Mans Ultimate while still being draggable and easy to close from the native context menu.

## What it does

- Connects to the configured websocket on launch.
- Shows green, yellow, red, FCY, safety car, starting soon, and pit-closed signals.
- Reconnects automatically if the socket drops.
- Writes a config file on first launch so the websocket URL, support URL, size, and always-on-top behavior can be adjusted without rebuilding.

## Development

```bash
npm install
npm run tauri dev
```

For a production build:

```bash
npm run tauri build
```

Right-click the overlay to open the config folder, visit the support link, or exit the app.
