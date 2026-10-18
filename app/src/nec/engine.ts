// Talks to the nec2c engine running in public/engine/worker.js.

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(import.meta.env.BASE_URL + 'engine/worker.js');
    worker.onmessage = (e: MessageEvent<{ id: number; text?: string; error?: string }>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.error !== undefined) job.reject(new Error(e.data.error));
      else job.resolve(e.data.text ?? '');
    };
  }
  return worker;
}

/** Runs one NEC deck and returns nec2c's text output. */
export function runNec(deck: string): Promise<string> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, deck });
  });
}
