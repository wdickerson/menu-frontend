import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { MenuCapture } from '../src/MenuCapture';
import { prepareMenuPhoto } from '../src/prepareMenuPhoto';

vi.mock('../src/prepareMenuPhoto', () => ({ prepareMenuPhoto: vi.fn() }));

const menu = {
  restaurantName: 'Captured Café',
  sections: [{ name: 'Lunch', items: ['Soup. $7.', 'Salad. $9.'] }, { name: 'Drinks', items: ['Tea. $3.'] }],
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const original = (name = 'photo.jpg') => new File([name], name, { type: 'image/jpeg' });
const onMenuReady = vi.fn();
const onBack = vi.fn();
const onAnnounce = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const revoke = vi.fn();
let urlCount = 0;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} rate = 1; });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:photo-${urlCount++}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); }),
  });
  vi.mocked(prepareMenuPhoto).mockReset().mockImplementation(async (file) => ({
    file: new File([file.name], 'prepared.jpg', { type: 'image/jpeg' }), width: 1600, height: 2000,
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderCapture() {
  return render(<StrictMode><MenuCapture onMenuReady={onMenuReady} onBack={onBack} onAnnounce={onAnnounce} /></StrictMode>);
}

async function addPhotos(files = [original()], camera = false) {
  fireEvent.change(screen.getByLabelText(camera ? 'Take a menu photo' : 'Choose menu photos'), { target: { files } });
  await waitFor(() => expect(screen.getByRole('button', { name: /Submit .* & read menu/ }).hasAttribute('disabled')).toBe(false));
}

describe('capture and review UX', () => {
  it('starts empty and never sends photos until explicit submission', async () => {
    renderCapture();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Capture your menu' }));
    expect(screen.getByRole('button', { name: /Submit/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Take a menu photo').getAttribute('capture')).toBe('environment');
    expect(screen.getByLabelText('Choose menu photos').hasAttribute('multiple')).toBe(true);
    await addPhotos([original('first.jpg'), original('second-long.jpg')]);
    expect(screen.getAllByRole('button', { name: /Review photo/ })).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('supports ordered submission, photo preview, retake and removal', async () => {
    const user = userEvent.setup();
    renderCapture();
    await addPhotos([original('first.jpg'), original('second-long.jpg')]);
    await user.click(screen.getByRole('button', { name: 'Review photo 1' }));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Zoom in to check text' }));
    expect(screen.getByRole('img', { name: 'Prepared menu photo 1' }).className).toBe('zoomed');
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    await user.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }));
    await user.click(screen.getByRole('button', { name: 'Retake photo 2' }));
    await addPhotos([original('retaken-page.jpg')], true);
    expect(revoke).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('button', { name: /Review photo/ })).toHaveLength(1);
    fetchMock.mockResolvedValue(json({ isDummy: false, ...menu }));
    await user.click(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }));
    await waitFor(() => expect(onMenuReady).toHaveBeenCalledWith(menu));
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect((form.get('images') as File).size).toBe('retaken-page.jpg'.length);
  });

  it('enforces the 10-photo limit without silently dropping or posting selected files', async () => {
    renderCapture();
    fireEvent.change(screen.getByLabelText('Choose menu photos'), {
      target: { files: Array.from({ length: 11 }, (_, i) => original(`page-${i}.jpg`)) },
    });
    expect(screen.getByRole('alert').textContent).toContain('up to 10 photos');
    expect(prepareMenuPhoto).not.toHaveBeenCalled();
    await addPhotos(Array.from({ length: 10 }, (_, i) => original(`page-${i}.jpg`)));
    expect(screen.getByRole('button', { name: 'Take another photo' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose photos' }).hasAttribute('disabled')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps other pages and the original page if a retake cannot be decoded', async () => {
    const user = userEvent.setup();
    renderCapture();
    await addPhotos();
    await user.click(screen.getByRole('button', { name: 'Retake photo 1' }));
    vi.mocked(prepareMenuPhoto).mockRejectedValueOnce(new Error('Please export as JPEG.'));
    fireEvent.change(screen.getByLabelText('Take a menu photo'), { target: { files: [original('bad.heic')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('original photo has been kept'));
    expect(screen.getByRole('button', { name: 'Review photo 1' })).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('preserves prepared photos and allows an explicit retry after API failure', async () => {
    const user = userEvent.setup();
    renderCapture();
    await addPhotos();
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'illegible_text' } }, 422));
    await user.click(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('good light'));
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(screen.getByRole('button', { name: 'Review photo 1' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onMenuReady).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ isDummy: false, ...menu }));
    await user.click(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }));
    await waitFor(() => expect(onMenuReady).toHaveBeenCalledWith(menu));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prepareMenuPhoto).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate submission, cancels locally, and ignores a late response', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    renderCapture();
    await addPhotos();
    await user.click(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(screen.getByRole('button', { name: 'Reading your menu…' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reading your menu…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }).hasAttribute('disabled')).toBe(false);
    await act(async () => { resolveRequest(json({ isDummy: false, ...menu })); });
    expect(onMenuReady).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review photo 1' })).toBeTruthy();
  });

  it('confirms discarding a draft and releases blob URLs on leaving', async () => {
    const user = userEvent.setup();
    const view = renderCapture();
    await addPhotos();
    await user.click(screen.getByRole('button', { name: 'Back to menus' }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Discard these photos?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('heading', { name: 'Discard these photos?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to menus' }));
    await user.click(screen.getByRole('button', { name: 'Discard photos and go back' }));
    expect(onBack).toHaveBeenCalledOnce();
    view.unmount();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('restores useful focus when keeping a draft at the ten-photo limit', async () => {
    const user = userEvent.setup();
    renderCapture();
    await addPhotos(Array.from({ length: 10 }, (_, i) => original(`page-${i}.jpg`)));
    await user.click(screen.getByRole('button', { name: 'Back to menus' }));
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review photo 1' }));
  });
});

describe('captured-menu reader integration and persistence', () => {
  it('loads and persists the new menu, preserves speed, and restores it after reload', async () => {
    const user = userEvent.setup();
    localStorage.setItem('menu-reader.restaurantId', 'twilight');
    localStorage.setItem('menu-reader.speechRate', '2.5');
    const view = render(<StrictMode><App /></StrictMode>);
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Menu Reader' }), { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Capture Menu Images' }));
    await addPhotos();
    fetchMock.mockResolvedValue(json({ isDummy: false, ...menu }));
    await user.click(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }));
    await screen.findByText('Captured Café');
    expect(screen.getByText('Speed: 2.5×')).toBeTruthy();
    expect(screen.getByText('Soup. $7.', { selector: '.item-text' })).toBeTruthy();
    expect(screen.getByText('Lunch 1 of 2')).toBeTruthy();
    expect(localStorage.getItem('menu-reader.restaurantId')).toBe('captured');
    expect(JSON.parse(localStorage.getItem('menu-reader.capturedMenu')!)).toEqual(menu);
    expect(speechSynthesis.speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining('Menu ready'), rate: 2.5 }));
    view.unmount();
    render(<App />);
    expect(screen.getByText('Captured Café')).toBeTruthy();
    expect(screen.getByText('Speed: 2.5×')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Menu Reader' }), { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Twilight' }));
    expect(localStorage.getItem('menu-reader.restaurantId')).toBe('twilight');
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Menu Reader' }), { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: /Captured Café/ }));
    expect(screen.getByText('Soup. $7.', { selector: '.item-text' })).toBeTruthy();
  });

  it('falls back safely when a stored captured menu is invalid or storage is blocked', () => {
    localStorage.setItem('menu-reader.restaurantId', 'captured');
    localStorage.setItem('menu-reader.capturedMenu', '{bad JSON');
    const view = render(<App />);
    expect(screen.getByText('Rough & Tumble')).toBeTruthy();
    view.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    render(<App />);
    expect(screen.getByText('Rough & Tumble')).toBeTruthy();
  });

  it('warns about quota failures and does not reload a stale captured menu', async () => {
    const user = userEvent.setup();
    localStorage.setItem('menu-reader.restaurantId', 'captured');
    localStorage.setItem('menu-reader.capturedMenu', JSON.stringify({ ...menu, restaurantName: 'Older Café' }));
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'menu-reader.capturedMenu' && value === JSON.stringify(menu)) throw new DOMException('Full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    const view = render(<App />);
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Menu Reader' }), { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Capture Menu Images' }));
    await addPhotos();
    fetchMock.mockResolvedValue(json({ isDummy: false, ...menu }));
    await user.click(screen.getByRole('button', { name: 'Submit 1 photo & read menu' }));
    await screen.findByText('Captured Café');
    expect(screen.getByRole('status').textContent).toContain('lost on reload');
    expect(localStorage.getItem('menu-reader.capturedMenu')).toBeNull();
    expect(localStorage.getItem('menu-reader.restaurantId')).toBe('rough-and-tumble');
    view.unmount();
    render(<App />);
    expect(screen.getByText('Rough & Tumble')).toBeTruthy();
    expect(screen.queryByText('Older Café')).toBeNull();
  });
});