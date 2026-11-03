/// <reference lib="webworker" />
import { ProcessingEngine } from './processing-engine';
import { WorkerRequest } from './worker-protocol';

const engine = new ProcessingEngine();

addEventListener('message', async ({ data }: MessageEvent<WorkerRequest>) => {
  const [response, transfer] = await engine.handle(data);
  postMessage(response, transfer);
});
