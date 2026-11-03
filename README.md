# ScubaFix

Restore natural colors to underwater photos, entirely in the browser — nothing is uploaded.

Water absorbs red light first, so underwater photos come out blue-green. It's an
Angular 19 app; all image math runs in web workers. Two correction methods:

- **Classic**: estimates how much red was lost, hue-shifts it back in, and
  stretches each color channel's histogram. Fast; usually best in clear blue water.
- **Fusion**: Ancuti et al., *Color Balance and Fusion for Underwater Image
  Enhancement* (IEEE TIP 2018). Red-channel compensation + Gray World, then a
  multi-scale fusion of a gamma-corrected and a sharpened version. Slower, often
  better for deep, green or murky water. Deviations from the paper (partial Gray
  World, a percentile stretch, plain unsharp masking) are documented in
  `fusion.ts`.

## Features

- Add photos by picking, dragging anywhere onto the page, or pasting.
- Load several photos at once and switch between them in the tray.
- **Method** (Classic / Fusion), **Strength** (0–100%) and **Clarity** (local
  contrast via CLAHE) with a live preview. Double-click a slider to reset it;
  settings are remembered.
- **Hold to compare**: press and hold the image (or the button, or Space/Enter on
  it) to see the original.
- **Download full size**: re-renders at full resolution in a worker. JPEG/WebP
  input stays lossy, PNG stays PNG. EXIF orientation is respected.

## Code layout

| Path | What |
|---|---|
| `src/app/processing/color-correction.ts` | Classic algorithm (`computeColorMatrix`, `scaleMatrix`, `applyColorMatrix`) |
| `src/app/processing/fusion.ts` | Ancuti color balance + fusion |
| `src/app/processing/clahe.ts` | Clarity (CLAHE on luminance) |
| `src/app/processing/image-ops.ts` | Blur and Laplacian-pyramid primitives |
| `src/app/processing/pipeline.ts` | Method → strength → clarity, for previews and full-size export |
| `src/app/processing/processing-engine.ts`, `*.worker.ts` | Worker request handling |
| `src/app/processing/image-processor.service.ts` | Promise API over two workers (preview + export), with main-thread fallback |
| `src/app/image-library.service.ts` | Loaded images + selection (signals) |
| `src/app/image-preview/` | Canvas preview, slider, compare, download |
| `src/app/image-tray/` | Thumbnail strip + file picker |

The preview is processed at up to 1600px on the long edge and the expensive
per-method step is cached, so slider changes are fast; downloads always
re-process the full-resolution file (a 12 MP Fusion export takes several
seconds). Clarity uses a fixed 8x8 tile grid and Fusion scales its filters with
the image, so the preview matches the export.

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
