import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { RestaurantMenu } from './data/menus';
import { MAX_MENU_PHOTOS, submitMenuImages } from './menuApi';
import { prepareMenuPhoto, type PreparedMenuPhoto } from './prepareMenuPhoto';

type MenuPhoto = PreparedMenuPhoto & { id: number; previewUrl: string };
type MenuCaptureProps = {
  onMenuReady: (menu: RestaurantMenu) => void;
  onBack: () => void;
  onAnnounce: (text: string) => void;
};

function PhotoPreview({ photo, page, onClose }: { photo: MenuPhoto; page: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="photo-preview"
      aria-labelledby="preview-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div className="preview-heading">
        <h2 id="preview-title">Photo {page}</h2>
        <button type="button" onClick={onClose} autoFocus>Close preview</button>
      </div>
      <p className="selection-note">Check that small text is sharp and the whole page is visible.</p>
      <button type="button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>
        {zoomed ? 'Fit photo to screen' : 'Zoom in to check text'}
      </button>
      <div className="preview-image-area" tabIndex={0} aria-label="Photo preview; scroll when zoomed in">
        <img className={zoomed ? 'zoomed' : ''} src={photo.previewUrl} alt={`Prepared menu photo ${page}`} />
      </div>
    </dialog>
  );
}

export function MenuCapture({ onMenuReady, onBack, onAnnounce }: MenuCaptureProps) {
  const [photos, setPhotos] = useState<MenuPhoto[]>([]);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'submitting'>('idle');
  const [status, setStatus] = useState('No photos yet. Take a photo or choose photos from your library.');
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const discardHeadingRef = useRef<HTMLHeadingElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const reviewButtonsRef = useRef(new Map<number, HTMLButtonElement>());
  const focusAfterPreparationRef = useRef<number | null>(null);
  const photosRef = useRef<MenuPhoto[]>([]);
  const replacementIdRef = useRef<number | null>(null);
  const nextPhotoIdRef = useRef(1);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const isBusy = phase !== 'idle';

  useEffect(() => {
    aliveRef.current = true;
    headingRef.current?.focus();
    return () => {
      aliveRef.current = false;
      requestRef.current?.abort();
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    };
  }, []);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmDiscard) discardHeadingRef.current?.focus(); }, [confirmDiscard]);
  useEffect(() => {
    if (phase === 'idle' && focusAfterPreparationRef.current !== null) {
      if (!error) reviewButtonsRef.current.get(focusAfterPreparationRef.current)?.focus();
      focusAfterPreparationRef.current = null;
    }
  }, [phase, photos, error]);

  function updatePhotos(next: MenuPhoto[]) {
    photosRef.current = next;
    setPhotos(next);
  }

  function announce(text: string) {
    setStatus(text);
    onAnnounce(text);
  }

  function showError(text: string) {
    setError(text);
    onAnnounce(text);
  }

  function openCamera(replacementId: number | null = null) {
    replacementIdRef.current = replacementId;
    cameraInputRef.current?.click();
  }

  async function handlePhotosChosen(event: ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const files = Array.from(event.currentTarget.files ?? []);
    // Allow selecting the same photo again after removing it or a failed decode.
    event.currentTarget.value = '';
    const replacementId = fromCamera ? replacementIdRef.current : null;
    replacementIdRef.current = null;
    if (files.length === 0 || busyRef.current) return;
    setError('');
    setConfirmDiscard(false);

    if (replacementId === null && photosRef.current.length + files.length > MAX_MENU_PHOTOS) {
      showError(`You can submit up to ${MAX_MENU_PHOTOS} photos. Choose ${MAX_MENU_PHOTOS - photosRef.current.length} or fewer, or remove a photo first.`);
      return;
    }

    busyRef.current = true;
    setPhase('preparing');
    announce('Preparing photos on your phone. They have not been sent yet.');
    let lastAddedId: number | null = null;
    let preparedCount = 0;
    const failures: string[] = [];

    try {
      // Decode one full-resolution image at a time to bound memory on phones.
      for (const [index, file] of files.entries()) {
        if (!aliveRef.current) return;
        setStatus(`Preparing photo ${index + 1} of ${files.length}…`);
        try {
          const prepared = await prepareMenuPhoto(file);
          if (!aliveRef.current) return;
          const photo: MenuPhoto = {
            ...prepared,
            id: replacementId ?? nextPhotoIdRef.current++,
            previewUrl: URL.createObjectURL(prepared.file),
          };
          if (replacementId !== null) {
            const oldPhoto = photosRef.current.find((entry) => entry.id === replacementId);
            if (oldPhoto) URL.revokeObjectURL(oldPhoto.previewUrl);
            updatePhotos(photosRef.current.map((entry) => entry.id === replacementId ? photo : entry));
          } else {
            updatePhotos([...photosRef.current, photo]);
          }
          preparedCount += 1;
          lastAddedId = photo.id;
        } catch (reason) {
          failures.push(`Photo ${index + 1}: ${reason instanceof Error ? reason.message : 'Could not prepare this photo. Please take it again.'}`);
        }
      }
      if (!aliveRef.current) return;
      const count = photosRef.current.length;
      announce(replacementId !== null && preparedCount > 0
        ? 'Photo replaced. Review it before submitting.'
        : `${count} ${count === 1 ? 'photo' : 'photos'} ready. Add another page, or submit when you are done.`);
      if (failures.length > 0) {
        showError(`${failures.join(' ')}${replacementId !== null ? ' Your original photo has been kept.' : ' Other ready photos have been kept.'}`);
      } else if (lastAddedId !== null) {
        focusAfterPreparationRef.current = lastAddedId;
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setPhase('idle');
    }
  }

  function removePhoto(id: number) {
    const index = photosRef.current.findIndex((photo) => photo.id === id);
    const removed = photosRef.current[index];
    URL.revokeObjectURL(removed.previewUrl);
    const next = photosRef.current.filter((photo) => photo.id !== id);
    updatePhotos(next);
    setError('');
    announce(`Photo ${index + 1} removed. ${next.length} ${next.length === 1 ? 'photo remains' : 'photos remain'}.`);
    const nearby = next[Math.min(index, next.length - 1)];
    if (nearby) reviewButtonsRef.current.get(nearby.id)?.focus();
    else cameraButtonRef.current?.focus();
  }

  function movePhoto(index: number, direction: -1 | 1) {
    const next = [...photosRef.current];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    updatePhotos(next);
    setError('');
    announce(`Photo ${index + 1} moved to position ${index + direction + 1}.`);
  }

  async function submitPhotos() {
    if (busyRef.current || photosRef.current.length === 0) return;
    busyRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setError('');
    setPhase('submitting');
    announce(`Sending ${photosRef.current.length} ${photosRef.current.length === 1 ? 'photo' : 'photos'} and reading your menu. This may take up to 45 seconds.`);
    try {
      const menu = await submitMenuImages(photosRef.current.map((photo) => photo.file), controller.signal);
      // Ignore an old request after cancellation, even if its response already arrived.
      if (aliveRef.current && requestRef.current === controller && !controller.signal.aborted) onMenuReady(menu);
    } catch (reason) {
      if (aliveRef.current && requestRef.current === controller && !controller.signal.aborted) {
        showError(reason instanceof Error ? reason.message : 'Could not read the menu. Your photos are still here; please try again.');
        setStatus('Photos kept. Review them or try submitting again.');
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        busyRef.current = false;
        if (aliveRef.current) setPhase('idle');
      }
    }
  }

  function cancelRequest() {
    requestRef.current?.abort();
    requestRef.current = null;
    busyRef.current = false;
    setPhase('idle');
    announce('Request canceled. Your photos are still here. The service may already have received them.');
  }

  const previewIndex = photos.findIndex((photo) => photo.id === previewId);

  return (
    <main className="screen capture-screen" aria-labelledby="capture-title">
      <section className="capture-panel">
        <header className="capture-header">
          <p className="eyebrow">Version 11 · A new menu</p>
          <h1 id="capture-title" ref={headingRef} tabIndex={-1}>Capture your menu</h1>
          <p className="selection-note">Take one photo per page, or photograph smaller parts of a dense menu. Keep the text sharp, fill the frame, and avoid glare.</p>
          <p className="selection-note">Add up to {MAX_MENU_PHOTOS} photos from the same restaurant, in reading order. Nothing is sent until you submit.</p>
        </header>

        <input
          ref={cameraInputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          tabIndex={-1}
          aria-label="Take a menu photo"
          disabled={isBusy}
          onChange={(event) => { void handlePhotosChosen(event, true); }}
        />
        <input
          ref={libraryInputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          tabIndex={-1}
          aria-label="Choose menu photos"
          disabled={isBusy}
          onChange={(event) => { void handlePhotosChosen(event, false); }}
        />

        <div className="capture-add-actions">
          <button ref={cameraButtonRef} type="button" className="primary-button" disabled={isBusy || photos.length >= MAX_MENU_PHOTOS} onClick={() => openCamera()}>
            {photos.length === 0 ? 'Take a photo' : 'Take another photo'}
          </button>
          <button type="button" disabled={isBusy || photos.length >= MAX_MENU_PHOTOS} onClick={() => libraryInputRef.current?.click()}>Choose photos</button>
        </div>

        <div className="capture-status" role="status" aria-live="polite" aria-atomic="true">
          {isBusy && <span className="busy-indicator" aria-hidden="true" />}
          <p>{status}</p>
        </div>
        {error && <p className="capture-error" ref={errorRef} tabIndex={-1} role="alert">{error}</p>}

        <section className="photo-review" aria-labelledby="photos-title" aria-busy={phase === 'preparing'}>
          <div className="review-heading">
            <h2 id="photos-title">Your photos</h2>
            <span>{photos.length} / {MAX_MENU_PHOTOS}</span>
          </div>
          {photos.length === 0 ? (
            <div className="photo-empty"><p>Start with the first page.</p><p>You can check each photo before sending it.</p></div>
          ) : (
            <ol className="photo-list">
              {photos.map((photo, index) => (
                <li key={photo.id} className="photo-card">
                  <button
                    className="photo-thumbnail"
                    type="button"
                    aria-label={`Review photo ${index + 1}`}
                    disabled={isBusy}
                    ref={(button) => {
                      if (button) reviewButtonsRef.current.set(photo.id, button);
                      else reviewButtonsRef.current.delete(photo.id);
                    }}
                    onClick={() => setPreviewId(photo.id)}
                  >
                    <img src={photo.previewUrl} alt="" />
                    <span>Review photo {index + 1}</span>
                  </button>
                  <div className="photo-details">
                    <h3>Photo {index + 1}</h3>
                    <p>{Math.ceil(photo.file.size / 1000)} KB · {photo.width} × {photo.height}</p>
                    <div className="photo-actions">
                      <button type="button" disabled={isBusy} aria-label={`Retake photo ${index + 1}`} onClick={() => openCamera(photo.id)}>Retake</button>
                      <button type="button" disabled={isBusy} aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(photo.id)}>Remove</button>
                      {photos.length > 1 && <>
                        <button type="button" disabled={isBusy || index === 0} aria-label={`Move photo ${index + 1} earlier`} onClick={() => movePhoto(index, -1)}>Earlier</button>
                        <button type="button" disabled={isBusy || index === photos.length - 1} aria-label={`Move photo ${index + 1} later`} onClick={() => movePhoto(index, 1)}>Later</button>
                      </>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="capture-privacy">Photos are prepared on your phone at a maximum of 250 KB each, then sent to the menu service for AI transcription. Photos are not saved by this app. The resulting menu is saved on this device when browser storage is available. Confirm prices and allergy information with staff.</p>

        {confirmDiscard && (
          <section className="discard-confirmation" aria-labelledby="discard-title">
            <h2 id="discard-title" ref={discardHeadingRef} tabIndex={-1}>Discard these photos?</h2>
            <p>Leaving this screen will discard your photos. Your current menu will not change.</p>
            <div className="capture-add-actions">
              <button type="button" onClick={() => {
                setConfirmDiscard(false);
                const firstPhoto = photosRef.current[0];
                if (firstPhoto) reviewButtonsRef.current.get(firstPhoto.id)?.focus();
                else cameraButtonRef.current?.focus();
              }}>Keep editing</button>
              <button type="button" onClick={onBack}>Discard photos and go back</button>
            </div>
          </section>
        )}

        <footer className="capture-footer">
          <button className="primary-button" type="button" disabled={isBusy || photos.length === 0} onClick={() => { void submitPhotos(); }}>
            {phase === 'submitting' ? 'Reading your menu…' : `Submit ${photos.length || ''} ${photos.length === 1 ? 'photo' : 'photos'} & read menu`}
          </button>
          {phase === 'submitting' ? (
            <button type="button" onClick={cancelRequest}>Cancel request</button>
          ) : (
            <button type="button" disabled={isBusy} onClick={() => {
              if (photos.length > 0) setConfirmDiscard(true);
              else onBack();
            }}>Back to menus</button>
          )}
        </footer>
      </section>
      {previewIndex >= 0 && <PhotoPreview photo={photos[previewIndex]} page={previewIndex + 1} onClose={() => setPreviewId(null)} />}
    </main>
  );
}