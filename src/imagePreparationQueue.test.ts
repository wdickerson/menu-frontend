import { describe, expect, it, vi } from 'vitest';
import { ImagePreparationQueue } from './imagePreparationQueue';

const photo = (text = 'photo') => new Blob([text], { type: 'image/jpeg' });
const signal = () => new AbortController().signal;

describe('background image preparation queue', () => {
  it('prepares one image at a time and preserves capture order', async () => {
    let finishFirst!: (blob: Blob) => void;
    const firstBlob = photo('first JPEG');
    const secondBlob = photo('second JPEG');
    const prepare = vi.fn().mockImplementationOnce(() => new Promise<Blob>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(secondBlob);
    const queue = new ImagePreparationQueue(prepare);
    const first = queue.add(photo('first original'));
    queue.add(photo('second original'));
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(1);
    const collected = queue.collect(signal());
    finishFirst(firstBlob);
    expect(await collected).toEqual([firstBlob, secondBlob]);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(first.file).not.toBeNull();
  });

  it('reuses prepared JPEGs when an API request is retried', async () => {
    const prepare = vi.fn().mockResolvedValue(photo());
    const queue = new ImagePreparationQueue(prepare);
    queue.add(photo());
    const images = await queue.collect(signal());
    expect(await queue.collect(signal())).toEqual(images);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1][2]).toBe(true);
  });

  it('keeps failed originals for a preparation retry without repeating successes', async () => {
    const original = photo('original');
    const prepare = vi.fn().mockResolvedValueOnce(photo('first prepared'))
      .mockRejectedValueOnce(new Error('Temporary decoder failure'))
      .mockResolvedValueOnce(photo('second prepared'));
    const queue = new ImagePreparationQueue(prepare);
    queue.add(photo('first original'));
    const failed = queue.add(original);
    await failed.result;
    expect(failed.file).toBe(original);
    expect((await queue.collect(signal())).length).toBe(2);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(prepare.mock.calls[2][0]).toBe(original);
  });

  it('reports persistent preparation failures with the image number', async () => {
    const queue = new ImagePreparationQueue(vi.fn().mockRejectedValue(new Error('Unsupported photo')));
    queue.add(photo());
    await expect(queue.collect(signal())).rejects.toThrow('Image 1: Unsupported photo');
    queue.dispose();
  });

  it('skips a removed queued image without disturbing other photos', async () => {
    const prepare = vi.fn().mockResolvedValue(photo());
    const queue = new ImagePreparationQueue(prepare);
    const removed = queue.add(photo('removed'));
    queue.add(photo('kept'));
    queue.remove(removed);
    expect(await queue.collect(signal())).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(removed.controller.signal.aborted).toBe(true);
    expect(removed.file).toBeNull();
  });

  it('cancels active preparation and skips queued photos', async () => {
    const prepare = vi.fn((_file: Blob, abortSignal?: AbortSignal) => new Promise<Blob>((_resolve, reject) => {
      abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    }));
    const queue = new ImagePreparationQueue(prepare);
    const first = queue.add(photo('first'));
    const second = queue.add(photo('second'));
    const controller = new AbortController();
    const collected = queue.collect(controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(collected).rejects.toMatchObject({ name: 'AbortError' });
    await second.result;
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(first.file).toBeNull();
    expect(second.file).toBeNull();
    expect(() => queue.add(photo())).toThrow('session has ended');
  });

  it('enforces the photo count and releases resources on close', async () => {
    const prepare = vi.fn().mockResolvedValue(photo());
    const queue = new ImagePreparationQueue(prepare);
    const images = Array.from({ length: 5 }, () => queue.add(photo()));
    expect(() => queue.add(photo())).toThrow('at most 5');
    queue.dispose();
    await images.at(-1)!.result;
    expect(prepare).not.toHaveBeenCalled();
    expect(images.every((image) => image.controller.signal.aborted && image.file === null)).toBe(true);
  });

  it('uses the multi-image policy when another photo is added before submission', async () => {
    const prepare = vi.fn().mockResolvedValue(photo());
    const queue = new ImagePreparationQueue(prepare);
    const first = queue.add(photo('first'));
    await first.result;
    queue.add(photo('second'));
    expect(await queue.collect(signal())).toHaveLength(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls.every((call) => call[2] === false)).toBe(true);
  });

  it('reprepares the remaining original with the single-image policy after removal', async () => {
    const original = photo('original');
    const multiBlob = photo('multi JPEG');
    const singleBlob = photo('single JPEG');
    const prepare = vi.fn().mockResolvedValueOnce(multiBlob).mockResolvedValueOnce(multiBlob)
      .mockResolvedValueOnce(singleBlob);
    const queue = new ImagePreparationQueue(prepare);
    queue.add(original);
    const removed = queue.add(photo('second'));
    await removed.result;
    queue.remove(removed);
    expect(await queue.collect(signal())).toEqual([singleBlob]);
    expect(prepare.mock.calls[2]).toEqual([original, expect.any(AbortSignal), true]);
    expect(await queue.collect(signal())).toEqual([singleBlob]);
    expect(prepare).toHaveBeenCalledTimes(3);
    queue.dispose();
  });
});