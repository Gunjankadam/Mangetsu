## Run UI in browser (dev)

From `manga-flow-main/manga-flow-main`:

```bash
npm install
npm run dev
```

Open `http://localhost:8080/`.

## Run UI inside Mihon Android app (Option A / WebView)

### Dev mode (fast iteration)

1. Start the web dev server:

```bash
npm run dev
```

2. Launch `WebUiActivity` in the Android app.

- It loads `http://10.0.2.2:8080/` by default in debug builds (Android emulator).
- For a physical device, replace `10.0.2.2` with your PC’s LAN IP (the one shown by Vite) and update the URL in `WebUiActivity.resolveStartUrl()`.

### Bundled mode (offline / release)

1. Build the web UI:

```bash
npm run build
```

2. Copy the Vite output folder to:

`app/src/main/assets/webui/`

So the Android app can load:

`file:///android_asset/webui/index.html`

Notes:
- You want the web build to use **relative asset paths** so it works from `file:///...`. If images/scripts fail to load, we’ll set Vite’s `base` to a relative path.

