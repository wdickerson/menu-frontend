import { MAX_IMAGES, MAX_IMAGE_BYTES, prepareMenuImage } from './menuApi';

type PreparationResult = { blob: Blob; error?: never } | { error: Error; blob?: never };
export type QueuedMenuImage = {
  id: string;
  file: Blob | null;
  blob: Blob | null;
  controller: AbortController;
  result: Promise<PreparationResult>;
};

/** Owns preparation independently of the capture screen, including after Done. */
export class ImagePreparationQueue {
  private images = new Map<string, QueuedMenuImage>();
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private prepare = prepareMenuImage) {}

  add(file: Blob): QueuedMenuImage {
    if (this.disposed) throw new Error('This capture session has ended.');
    if (this.images.size >= MAX_IMAGES) throw new Error(`Capture at most ${MAX_IMAGES} images.`);
    const image: QueuedMenuImage = { id: crypto.randomUUID(), file, blob: null,
      controller: new AbortController(), result: Promise.resolve({ error: new Error('Not prepared yet.') }) };
    this.images.set(image.id, image);
    this.schedule(image);
    return image;
  }

  private schedule(image: QueuedMenuImage) {
    image.result = this.tail.then(async (): Promise<PreparationResult> => {
      try {
        image.controller.signal.throwIfAborted();
        if (!image.file) throw new Error('This photo is no longer available. Capture it again.');
        const blob = await this.prepare(image.file, image.controller.signal);
        image.controller.signal.throwIfAborted();
        image.blob = blob;
        image.file = null; // Release the full-resolution photo once it is prepared.
        return { blob };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error('This photo could not be prepared. Take another photo.') };
      }
    });
    // Results never reject, including errors occurring before Done is pressed.
    this.tail = image.result;
  }

  remove(image: QueuedMenuImage) {
    this.images.delete(image.id);
    image.controller.abort();
    image.file = null;
    image.blob = null;
  }

  async collect(signal: AbortSignal): Promise<Blob[]> {
    signal.throwIfAborted();
    if (this.disposed) throw new Error('This capture session has ended.');
    const images = [...this.images.values()];
    if (!images.length) throw new Error('Capture an image before loading the menu.');
    const cancel = () => this.dispose();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const blobs: Blob[] = [];
      for (const image of images) {
        // Retry a failed preparation using its original, but reuse successful JPEGs.
        if (!image.blob && (await image.result).error) this.schedule(image);
        signal.throwIfAborted();
        const result = await image.result;
        signal.throwIfAborted();
        if (result.error) throw new Error(`Image ${blobs.length + 1}: ${result.error.message}`);
        blobs.push(result.blob);
      }
      if (blobs.reduce((sum, blob) => sum + blob.size, 0) > MAX_IMAGE_BYTES) {
        throw new Error('These photos are too large. Remove an image and try again.');
      }
      return blobs;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  dispose() {
    this.disposed = true;
    this.images.forEach((image) => this.remove(image));
  }
}