/// <reference lib="webworker" />
import { analyze, render } from './processing-core';
import { WorkerRequest, WorkerResponse } from './worker-protocol';

addEventListener('message', async ({ data }: MessageEvent<WorkerRequest>) => {
  let response: WorkerResponse;
  try {
    switch (data.type) {
      case 'analyze':
        response = { id: data.id, type: 'analyze', matrix: analyze(data.pixels, data.width, data.height) };
        break;
      case 'render':
        response = { id: data.id, type: 'render', blob: await render(data.file, data.matrix, data.mimeType, data.quality) };
        break;
    }
  } catch (e) {
    response = { id: data.id, type: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  postMessage(response);
});
