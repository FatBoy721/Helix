import type { SharedModelFile } from './nativeSlicer';

// One-shot handoff for a model opened via "Open with Helix". The tab layout
// reads the launch intent once and publishes here; the Slice screen subscribes
// so it still receives the file if native import finishes after first paint.

type Listener = (file: SharedModelFile) => void;

let pending: SharedModelFile | null = null;
const listeners = new Set<Listener>();

export function setPendingModel(file: SharedModelFile): void {
  if (listeners.size > 0) {
    pending = null;
    for (const listener of listeners) listener(file);
    return;
  }
  pending = file;
}

export function takePendingModel(): SharedModelFile | null {
  const file = pending;
  pending = null;
  return file;
}

/** Deliver any already-staged file and notify on future opens. */
export function subscribePendingModel(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const file = pending;
    pending = null;
    listener(file);
  }
  return () => {
    listeners.delete(listener);
  };
}
