# Woogi Tools

A collection of small, single-purpose utilities — a calculator here, a converter there, a password generator, a QR code maker — with a bit of personality. No accounts, no tracking, and (with the exception of a couple of engines that fetch a WebAssembly binary or a model file from a CDN the first time you use them) nothing ever leaves your browser.

## What's inside

Tools are organised into six categories. Every tool can be hidden from Settings if you don't use it.

### Design

Colour Picker · Contrast Checker · Pixel Eyedropper · Background Remover · Image Resizer · Image Cropper · Image Slicer

### Dev

Data Codec · JSON Formatter · Hash Generator · UUID Generator · JWT Decoder · Regex Tester · Timestamp Converter · Number Base Converter · User Agent Parser · Cron Expression Builder · .gitignore Generator · Favicon Generator

### Files

File Converter (images, RAW photos, audio, video, documents, data, archives and fonts) · PDF Merge & Split · File Compressor

### Math

Calculator · Graph Calculator · Algebra Calculator · Time & Date Calculator · Age Calculator · Winrate Calculator · Unit Converter · Wage Calculator · Percentage Calculator · Aspect Ratio Calculator

### Text

Word Counter · Text Case Converter · Text Diff · Line Tools

### Other

QR Code Generator · P2P File Share · Password Generator · Lorem Ipsum Generator · Pomodoro Timer · Random Picker · Quick Notes

The full, current list — with descriptions, keywords and "how it's made" notes — lives in [`app/tools.js`](app/tools.js), which drives the sidebar, the home page and the command palette (`Ctrl`/`Cmd` + `F`) from a single source.

## How it's built

- **Ember.js** (Octane edition, `.gjs` template-tag components) on **Vite** via Embroider, rather than the classic ember-cli broccoli pipeline.
- No backend and no database. Preferences, notes and favourites are kept in `localStorage` under a `woogi-` prefix (see Settings → Reset).
- Heavier engines — ImageMagick, FFmpeg, Pandoc, 7-Zip, the background-removal model — are WebAssembly builds loaded lazily, only when a tool that needs them is actually used.
- P2P File Share uses [PeerJS](https://peerjs.com) for the WebRTC signalling handshake; the transfer itself is a direct connection between the two browsers.

## Prerequisites

- [Node.js](https://nodejs.org/) 20.19 or newer (with npm)
- A recent Chrome, Firefox, Safari or Edge for the WebAssembly- and Web Worker-heavy tools

## Getting started

```bash
npm install
npm start        # dev server at http://localhost:4200
```

### Building

```bash
npm run build                              # production build, output in dist/
npm exec vite build --mode development     # development build
```

### Linting & formatting

```bash
npm run lint        # eslint + template-lint + stylelint
npm run lint:fix
npm run format
```

## Project layout

```text
app/
  components/    one <Something>Page component per tool, wrapped in <ToolPage>
  templates/      one route template per tool, just rendering its page component
  services/      settings, favourites, notes, tool-visibility
  utils/         the actual logic behind each tool (converters, codecs, colour math, …)
  styles/        SCSS, split by concern (_math.scss, _tool-extras.scss, …)
  tools.js       the single registry every nav surface reads from
```

Adding a tool means: a route in `router.js`, a template in `app/templates/`, a component in `app/components/`, and an entry in `app/tools.js`.

## Licensing note

Everything here is MIT-licensed except the Background Remover, which uses [`@imgly/background-removal`](https://github.com/imgly/background-removal-js) — **AGPL-3.0**. If you deploy this project publicly with that tool enabled, the AGPL's network-use clause means you're expected to make the complete corresponding source of the running service available to your users. Remove or replace that tool (or get IMG.LY's commercial license) if that doesn't work for your deployment.

## Credits

Every tool page lists the libraries it's built on, with author and license, at the bottom of the page. Site-wide credits (Ember, Vite, icons, fonts) are in the footer of the home page.
