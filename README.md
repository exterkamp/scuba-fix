# ScubaFix

Restore natural colors to underwater photos, entirely in the browser — nothing is uploaded.

Water absorbs red light first, so underwater photos come out blue-green. ScubaFix
estimates how much red was lost, hue-shifts it back in, and stretches each color
channel's histogram. It's an Angular 19 app; the image math runs in a web worker.

## Features

- Add photos by picking, dragging anywhere onto the page, or pasting.
- Load several photos at once and switch between them in the tray.
- **Strength** slider (0–100%; double-click to reset) with a live preview.
- **Hold to compare**: press and hold the image (or the button, or Space/Enter on
  it) to see the original.
- **Download full size**: re-renders at full resolution in a worker. JPEG/WebP
  input stays lossy, PNG stays PNG. EXIF orientation is respected.

## Code layout

| Path | What |
|---|---|
| `src/app/processing/color-correction.ts` | The pure algorithm (`computeColorMatrix`, `scaleMatrix`, `applyColorMatrix`) |
| `src/app/processing/color-correction.worker.ts` | Worker entry point |
| `src/app/processing/image-processor.service.ts` | Promise API over the worker (main-thread fallback) |
| `src/app/image-library.service.ts` | Loaded images + selection (signals) |
| `src/app/image-preview/` | Canvas preview, slider, compare, download |
| `src/app/image-tray/` | Thumbnail strip + file picker |

The preview is analysed and rendered at up to 1600px on the long edge, so
slider changes are instant; downloads always use the full-resolution file.

## Development

Needs Node 18.19+ (`nvm use 22`).

```bash
npm run dev     # ng serve on 0.0.0.0, port from $PORT (default 4200)
npm test -- --watch=false --browsers=ChromeHeadless
```

With devrun: `devrun up --name web --port-env PORT -- npm run dev`.

## Deploying to GitHub Pages

```bash
npm run build      # production build, base href /scuba-fix/
git add dist && git commit -m "Build"
npm run gh-pages   # pushes dist/scuba-fix/browser to the gh-pages branch
```
