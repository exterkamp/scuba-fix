/// <reference lib="webworker" />
import {CreateImageBitmapRequest,
  CreateFilterReqeuest,
  WorkType,
  WorkRequest,
  UnknownResult,
  CreateImageBitmapSuccessResult,
  CreateImageBitmapResults,
  Filter,
  CreateFilterResults,
  CreateFilterSuccessResult,
  ApplyFilteSuccessResult,
  ApplyFilterResults
} from './image-preview-worker-types';


addEventListener('message', ({ data }) => {
  console.log(`We have a request, ${JSON.stringify(data)}`);
  // Work comes in as any possible work type.
  const work = data as WorkRequest;
  switch (work.type) {
    case WorkType.CreateImageData:
      const imageData = createImageDataFromBitmap(work.bitmap);
      postMessage({
        type: WorkType.CreateImageData,
        result: CreateImageBitmapResults.Success,
        imageData,
      } as CreateImageBitmapSuccessResult);
      break;
    case WorkType.CreateFilter:
      const filter = createImageFilter(work.bitmap);
      postMessage({
        type: WorkType.CreateFilter,
        result: CreateFilterResults.Success,
        filter,
      } as CreateFilterSuccessResult);
      break;
    case WorkType.ApplyFilter:
      const f = JSON.parse(work.filter);
      const appliedImage = applyFilterOffscreen(work.bitmap, f);
      postMessage({
        type: WorkType.ApplyFilter,
        result: ApplyFilterResults.Success,
        imageData: appliedImage,
      } as ApplyFilteSuccessResult);
      break;
    default:
      postMessage({
        type: WorkType.Unknown,
        message: "Unknown requested work type.",
      } as UnknownResult);
  }
});

function createImageDataFromBitmap(bitmap: ImageBitmap): ImageData {
    // Let's convert this to data via an offscreen canvas.
    const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
    let ctx = offscreen.getContext("2d")!;
    // bitmap -> draw onto offscreen canvas
    ctx.drawImage(bitmap, 0, 0);
    // read out imageData from bitmap
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function createImageFilter(bitmap: ImageBitmap): Filter {
  const imageData = createImageDataFromBitmap(bitmap);
  const pixels = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Magic values:
  const numOfPixels = width * height
  const thresholdRatio = 2000
  const thresholdLevel = numOfPixels / thresholdRatio
  const minAvgRed = 60
  const maxHueShift = 120
  const blueMagicValue = 1.2

  type Histogram = {
    r: number[];
    g: number[];
    b: number[];
  }
  let hist: Histogram = { r: [], g: [], b: [] };
  let normalize: Histogram = { r: [], g: [], b: [] }
  let adjust: {
    r: {low: number, high: number},
    b: {low: number, high: number},
    g: {low: number, high: number},
  } = { r: {
    low: 0, high: 255
  }, g: {
    low: 0, high: 255
  }, b: {
    low: 0, high: 255
  } };

  let hueShift = 0

  // Initialize objects
  for (let i = 0; i < 256; i++) {
      hist.r.push(0)
      hist.g.push(0)
      hist.b.push(0)
  }

  const avg = calculateAverageColor(pixels, width, height)

  // Calculate shift amount:
  let newAvgRed = avg.r
  while (newAvgRed < minAvgRed) {
      const shifted = hueShiftRed(avg.r, avg.g, avg.b, hueShift)
      newAvgRed = shifted.r + shifted.g + shifted.b
      hueShift++
      if (hueShift > maxHueShift) newAvgRed = 60 // Max value
  }

  // Create hisogram with new red values:
  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width * 4; x += 4) {
          const pos = x + (width * 4) * y

          let red = Math.round(pixels[pos + 0])
          const green = Math.round(pixels[pos + 1])
          const blue = Math.round(pixels[pos + 2])

          const shifted = hueShiftRed(red, green, blue, hueShift) // Use new calculated red value
          red = shifted.r + shifted.g + shifted.b
          red = Math.min(255, Math.max(0, red))
          red = Math.round(red)

          hist.r[red] += 1
          hist.g[green] += 1
          hist.b[blue] += 1
      }
  }

  // Push 0 as start value in normalize array:
  normalize.r.push(0)
  normalize.g.push(0)
  normalize.b.push(0)

  // Find values under threshold:
  for (let i = 0; i < 256; i++) {
      if (hist.r[i] - thresholdLevel < 2) normalize.r.push(i)
      if (hist.g[i] - thresholdLevel < 2) normalize.g.push(i)
      if (hist.b[i] - thresholdLevel < 2) normalize.b.push(i)
  }

  // Push 255 as end value in normalize array:
  normalize.r.push(255)
  normalize.g.push(255)
  normalize.b.push(255)

  adjust.r = normalizingInterval(normalize.r)
  adjust.g = normalizingInterval(normalize.g)
  adjust.b = normalizingInterval(normalize.b)

  // Make histogram:
  const shifted = hueShiftRed(1, 1, 1, hueShift)

  const redGain = 256 / (adjust.r.high - adjust.r.low)
  const greenGain = 256 / (adjust.g.high - adjust.g.low)
  const blueGain = 256 / (adjust.b.high - adjust.b.low)

  const redOffset = (-adjust.r.low / 256) * redGain
  const greenOffset = (-adjust.g.low / 256) * greenGain
  const blueOffset = (-adjust.b.low / 256) * blueGain

  const adjstRed = shifted.r * redGain
  const adjstRedGreen = shifted.g * redGain
  const adjstRedBlue = shifted.b * redGain * blueMagicValue

  return {
    red: {
      r: adjstRed,
      g: adjstRedGreen,
      b: adjstRedBlue,
      a: 0,
      offset: redOffset,
    },
    green: {
      r: 0, g: greenGain, b: 0, a: 0, offset: greenOffset,
    },
    blue: {
      r: 0, g: 0, b: blueGain, a: 0, offset: blueOffset,
    },
    alpha: {
      r: 0, g: 0, b: 0, a: 1, offset: 0,
    }
  } as Filter;
}

function calculateAverageColor(pixels: Uint8ClampedArray, width: number, height: number) {
  const start = Date.now();
  const avg = { r: 0, g: 0, b: 0 }

  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width * 4; x += 4) {
          const pos = x + (width * 4) * y

          // Sum values:
          avg.r = avg.r + pixels[pos + 0]
          avg.g = avg.g + pixels[pos + 1]
          avg.b = avg.b + pixels[pos + 2]
      }
  }

  // Calculate average:
  avg.r = avg.r / (width * height)
  avg.g = avg.g / (width * height)
  avg.b = avg.b / (width * height)

  console.log(`Average color: ${JSON.stringify(avg)}`);
  console.log(`Average color calculation took ${Date.now() - start}ms`);

  return avg
}

function hueShiftRed(r: number, g: number, b: number, h: number) {
  let U = Math.cos(h * Math.PI / 180)
  let W = Math.sin(h * Math.PI / 180)

  r = (0.299 + 0.701 * U + 0.168 * W) * r
  g = (0.587 - 0.587 * U + 0.330 * W) * g
  b = (0.114 - 0.114 * U - 0.497 * W) * b

  return { r, g, b }
}

function normalizingInterval(normArray: number[]): {low: number, high: number} {
  let high = 255
  let low = 0
  let maxDist = 0

  for (let i = 1; i < normArray.length; i++) {
      let dist = normArray[i] - normArray[i - 1]
      if (dist > maxDist) {
          maxDist = dist;
          high = normArray[i]
          low = normArray[i - 1]
      }
  }

  return { low, high }
}

function applyFilterOffscreen(bitmap: ImageBitmap, filter: Filter) {
  const imageData = createImageDataFromBitmap(bitmap);
  const workingImageData = new Uint8ClampedArray(imageData.data);
  const baseImageData = imageData.data;
  // apply filter over imageData
  for (let i = 0; i < baseImageData.length; i += 4) {
      workingImageData[i] = Math.min(255, Math.max(0, baseImageData[i] * filter.red.r + 
                                                      baseImageData[i+1] * filter.red.g +
                                                      baseImageData[i+2] * filter.red.b +
                                                      filter.red.offset * 255)); // RED
      workingImageData[i + 1] = Math.min(255, Math.max(0, baseImageData[i+1] * filter.green.g + filter.green.offset * 255)); // GREEN
      workingImageData[i + 2] = Math.min(255, Math.max(0, baseImageData[i+2] * filter.blue.b + filter.blue.offset * 255)); // Blue
  }
  // console.log(workingImageData);
  const newImage = new ImageData(workingImageData, imageData.width, imageData.height);
  return newImage;
}