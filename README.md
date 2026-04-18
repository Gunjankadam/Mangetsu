<p align="center">
  <img src="docs/media/mangetsu-app-icon.png" alt="Mangetsu app icon: 満月 (full moon) on a starfield inside a red ring" width="300" height="300" />
</p>

# Mangetsu

**Mangetsu** is a cross-platform manga reader and library app built as a learning-oriented project. The UI runs as a **Vite + React** web app, ships inside an **Android** shell via **Capacitor**, and can talk to an optional **HTTP API** for catalog search, chapter metadata, and page URLs when you point the app at your own backend base URL.

This repository is maintained for **educational purposes**: to study modern frontend architecture (React 18, TanStack Query, client-side routing, offline-friendly patterns), mobile packaging with Capacitor, and how a thin client separates **presentation** from **data acquisition**.

---

## Showcase & downloads


### Demo video

<p align="center">
  <!-- TODO: set href to YouTube, Loom, etc. Optional: use https://img.youtube.com/vi/VIDEO_ID/maxresdefault.jpg as img src -->
  <a href="https://github.com/Gunjankadam/Mangetsu#showcase--downloads" title="Replace this link with your demo URL">
    <img src="docs/media/video-thumbnail-placeholder.svg" alt="Demo video thumbnail — replace link and image" width="720" />
  </a>
</p>


### Screenshots

| Library / home | Reader | Settings / account |
| :------------: | :----: | :----------------: |
| ![Screenshot 1](https://github.com/Gunjankadam/Mangetsu/blob/main/1.jpeg) | ![Screenshot 2](https://github.com/Gunjankadam/Mangetsu/blob/main/2.jpeg) | ![Screenshot 3](https://github.com/Gunjankadam/Mangetsu/blob/main/3.jpeg) |


### Android APK & QR

<p align="center">
  <table>
    <tr>
      <td align="center" valign="top" width="320">
        <strong>Scan to download</strong><br /><br />
        <img src="https://github.com/Gunjankadam/Mangetsu/blob/main/qrcode.png" alt="QR code for APK — replace with image pointing to your APK URL" width="220" height="220" /><br /><br />
        <em></em>
      </td>
      <td width="48"></td>
      <td align="center" valign="middle">
        <strong>Direct download</strong><br /><br />
        <!-- TODO: link to your GitHub Release asset or other HTTPS host -->
        <a href="https://drive.google.com/drive/folders/1VLKciMNQXaE-ajU8_WLVO2pkOZ2JpEZ2?usp=drive_link"><b>Download APK (Releases)</b></a><br /><br />
      </td>
    </tr>
  </table>
</p>

---

## Table of contents

1. [Showcase & downloads](#showcase--downloads)
2. [Educational goals](#educational-goals)
3. [Why this repository does not include the backend](#why-this-repository-does-not-include-the-backend)
4. [What you get in this repo](#what-you-get-in-this-repo)
5. [Architecture at a glance](#architecture-at-a-glance)
6. [Prerequisites](#prerequisites)
7. [Getting started](#getting-started)
8. [Environment variables](#environment-variables)
9. [Connecting to an API](#connecting-to-an-api)
10. [Android (Capacitor) builds](#android-capacitor-builds)
11. [Project structure](#project-structure)
12. [Scripts reference](#scripts-reference)
13. [Disclaimer](#disclaimer)
14. [License](#license)

---

## Educational goals

This project is useful if you want hands-on practice with:

- **Single-page applications (SPAs)** with React, TypeScript, and Vite.
- **Server-state management** using TanStack Query (caching, invalidation, background refresh).
- **Client-side persistence** (SQLite via Capacitor on native, local storage patterns on web).
- **Progressive enhancement**: the app can function as a shell that loads remote catalogs only when a backend URL is configured.
- **Capacitor** workflows: syncing web assets into `android/`, native plugins (`App`, `Filesystem`, `Network`, community SQLite), and producing installable **APK**s.
- **Separation of concerns**: the UI does not embed scraping logic; it consumes JSON over HTTP, which mirrors how production apps integrate with BFFs or microservices.

The codebase is intended to be read, forked, and experimented with—not to encourage misuse of third-party websites. Treat third-party manga hosts respectfully and comply with their terms and applicable law.

---

## Why this repository does not include the backend

The **Node.js backend** that powers source browsing (HTML scraping, image proxy routes, normalisation of chapter/page URLs, etc.) is **intentionally not published in this GitHub repository**. Reasons:

### 1. Educational focus and scope

The learning goals for this public repo are **frontend engineering** and **mobile distribution**: routing, state, UI composition, Capacitor, and API *consumption*. Shipping a full scraping server would widen the scope to operations, anti-bot evasion, rate limits, and fragile upstream HTML—topics that distract from the core UI curriculum and are hard to keep stable in a teaching repo.

### 2. Operational and legal sensitivity

A scraping-oriented backend:

- Interacts with **many third-party origins** under their terms of service and robots policies.
- May be **blocked or rate-limited** by CDNs (e.g. Cloudflare) depending on where it runs (home vs cloud).
- Raises **copyright and licensing** questions depending on jurisdiction and how the tool is used.

Keeping that code **out of a public educational fork** reduces the risk that learners clone a “batteries-included” infringement pipeline. Here, the contract is explicit: **you** decide whether and how to run a compatible API, on **your** infrastructure, under **your** responsibility.

### 3. Secrets, keys, and environment-specific config

Real deployments need API keys, Supabase credentials, optional Playwright installs, and host-specific tuning. Those do not belong in a public tree. A minimal **client** repo plus `.env.example` keeps secrets out of history while still documenting what the UI can read at build/runtime.

### 4. Independent lifecycles

The client can be versioned, tagged, and released on its own (web deploy, Play Store sideloads). The backend may change daily as sites change markup. Splitting them avoids a monorepo where every HTML tweak forces an unrelated app release—or where students must debug scrapers before they can learn React.

### 5. What you should do instead

- Run your own compatible API locally or on a VPS, **or**
- Point the app at a backend URL you trust (e.g. team internal), configured under **Settings → Backend link** or `VITE_MANGA_FLOW_BACKEND_URL` for static hosting.

The client expects JSON shapes documented implicitly by the `src/native/Backend.ts` calls to `/api/...` routes; implementing that contract is outside this repository’s scope.

---

## What you get in this repo

- **Web + Android shell** for the Mangetsu / Manga Flow UI.
- **Capacitor** Android project under `android/`.
- **Helper script** `scripts/android-assemble-debug.mjs` so Gradle uses a supported JDK (17–23) on Windows when JDK 25 is on `PATH`.
- **No** `backend/` folder in version control for this publication (see [.gitignore](.gitignore)).
- **`user-backend/`** (if present in your tree) is a **small optional** serverless API scaffold for profile/library sync (Supabase)—*not* the manga scraping server. You may keep or remove it from your fork; it is unrelated to HTML scraping sources.

---

## Architecture at a glance

```text
┌─────────────────────────────────────────────────────────────┐
│  Mangetsu client (this repo)                                 │
│  React + Vite + Capacitor                                    │
│  - Library, reader, browse, settings                         │
│  - fetch(`${BACKEND}/api/...`) when configured               │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS (optional)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Your Node API (not in this repo)                            │
│  Scraping / proxies / normalisation — your policy & hosting  │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- **Node.js 20.x** (see `package.json` `engines`).
- **npm** (or compatible package manager).
- For **Android APK** builds: **JDK 17–23** and **Android SDK** (Android Studio recommended). The included script prefers `C:\Program Files\Java\jdk-23` on Windows when present.

---

## Getting started

```bash
git clone https://github.com/Gunjankadam/Mangetsu.git
cd Mangetsu
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:8080`). Without a backend URL, browse features that depend on the API will prompt you to connect; configure the backend in **Settings** or via build-time env (see below).

---

## Environment variables

Create a `.env` file in the project root (never commit real secrets). See [.env.example](.env.example) for variable names.

| Variable | Purpose |
|----------|---------|
| `VITE_MANGA_FLOW_BACKEND_URL` | Optional default **origin** for the manga API when building static sites (e.g. Render). No trailing slash. Users can still override with **Settings → Backend link** (`localStorage`). |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Optional cloud auth / sync (see in-app Account screen). |
| `VITE_USER_BACKEND_URL` | Optional separate user backend (see `src/lib/userBackend.ts`). |

---

## Connecting to an API

1. Run a compatible Node server elsewhere (your own implementation of the `/api/...` contract), **or** use a private deployment you maintain.
2. In the app: **Settings → Backend link** → paste base URL (e.g. `http://192.168.1.10:8787`) → **Save**.
3. For **static hosting**, set `VITE_MANGA_FLOW_BACKEND_URL` at **build** time so first-time visitors do not need to paste a URL.

---

## Android (Capacitor) builds

```bash
npm run android:apk:debug
```

This runs `vite build`, `npx cap sync android`, then Gradle `assembleDebug`. The output APK is typically:

`android/app/build/outputs/apk/debug/app-debug.apk`

**JDK note:** If `JAVA_HOME` points to **JDK 25**, Gradle may fail with “Unsupported class file major version 69”. The script `scripts/android-assemble-debug.mjs` picks JDK **17–23** from common install paths when possible.

---

## Project structure

| Path | Role |
|------|------|
| `src/` | Application source (screens, hooks, storage, `native/Backend.ts` API client). |
| `android/` | Capacitor Android project. |
| `capacitor.config.ts` | App id `com.mangaflow.app`, display name **Mangetsu**, `webDir: dist`. |
| `vite.config.ts` | Vite + React; `base: './'` for WebView asset paths. |
| `scripts/android-assemble-debug.mjs` | Gradle wrapper with JDK selection. |

---

## Scripts reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server. |
| `npm run build` | Production web build → `dist/`. |
| `npm run cap:sync` | `build` + `cap sync android`. |
| `npm run android:apk:debug` | Sync + debug APK via Gradle. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest. |

---

## Disclaimer

This software is provided for **education**. Manga and images are usually owned by publishers and creators. Use official services where available. Do not use this project to violate terms of service, copyright, or local law. The maintainers are not responsible for how you configure backends or which sources you access.

---

## License

Specify your license in this section (e.g. MIT) when you choose one. Until then, all rights reserved unless you add a `LICENSE` file.

---

## Pushing to GitHub

If this folder was cloned without git metadata, initialise and push:

```bash
git init
git add .
git commit -m "Initial commit: Mangetsu client (educational, frontend-only)"
git branch -M main
git remote add origin https://github.com/Gunjankadam/Mangetsu.git
git push -u origin main
```

Use a personal access token or SSH as required by GitHub. If the remote already has a commit (e.g. empty README on GitHub), either `git pull --rebase origin main` first or force-push only if you intend to replace history.
