import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { MAX_IMAGES } from './menuApi';
import { ImagePreparationQueue, type QueuedMenuImage } from './imagePreparationQueue';

type CapturedImage = { id: string; job: QueuedMenuImage; url: string; error?: string };
type CameraCaptureProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSubmit: (queue: ImagePreparationQueue) => void;
  expandedImageId: string | null;
  onExpandImage: (id: string) => void;
  onCloseImage: () => void;
};

export default function CameraCapture({ inputRef, onClose, onSubmit, expandedImageId,
  onExpandImage, onCloseImage }: CameraCaptureProps) {
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const expandedCloseRef = useRef<HTMLButtonElement | null>(null);
  const previewButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusRef = useRef<string | null>('add');
  const activeRef = useRef(false);
  const urlsRef = useRef(new Set<string>());
  const queueRef = useRef<ImagePreparationQueue | null>(null);
  const submittedRef = useRef(false);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [error, setError] = useState('');
  const expandedImage = images.find(({ id }) => id === expandedImageId);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (!submittedRef.current) {
        queueRef.current?.dispose();
        queueRef.current = null;
      }
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (expandedImageId) {
      returnFocusRef.current = expandedImageId;
      expandedCloseRef.current?.focus();
      const previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      return () => { document.documentElement.style.overflow = previousOverflow; };
    }
  }, [expandedImageId]);

  useEffect(() => {
    if (expandedImageId) return;
    const target = returnFocusRef.current;
    if (target) {
      returnFocusRef.current = null;
      if (target === 'add') addButtonRef.current?.focus();
      else previewButtonsRef.current.get(target)?.focus();
    }
  }, [expandedImageId, images]);

  function openCamera() {
    if (submittedRef.current || images.length >= MAX_IMAGES) return;
    setError('');
    inputRef.current?.click();
  }

  function acceptImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || submittedRef.current || images.length >= MAX_IMAGES) return;
    setError('');
    try {
      const queue = queueRef.current ??= new ImagePreparationQueue();
      const job = queue.add(file);
      // Preview the original immediately; preparation must not block another photo.
      const url = URL.createObjectURL(file);
      urlsRef.current.add(url);
      const id = job.id;
      returnFocusRef.current = images.length + 1 === MAX_IMAGES ? id : 'add';
      setImages((current) => [...current, { id, job, url }]);
      void job.result.then((result) => {
        if (!activeRef.current || job.controller.signal.aborted) return;
        if (result.error) {
          setImages((current) => current.map((image) => image.id === id ? { ...image, error: result.error.message } : image));
          return;
        }
        const preparedUrl = URL.createObjectURL(result.blob);
        urlsRef.current.add(preparedUrl);
        setImages((current) => current.map((image) => image.id === id ? { ...image, url: preparedUrl } : image));
        URL.revokeObjectURL(url);
        urlsRef.current.delete(url);
      });
    } catch (captureError) {
      if (activeRef.current) setError(captureError instanceof Error ? captureError.message : 'This image could not be opened. Try another photo.');
    }
  }

  function removeImage(image: CapturedImage) {
    queueRef.current?.remove(image.job);
    URL.revokeObjectURL(image.url);
    urlsRef.current.delete(image.url);
    returnFocusRef.current = 'add';
    setImages((current) => current.filter(({ id }) => id !== image.id));
    setError('');
  }

  function closeExpandedImage() {
    returnFocusRef.current = expandedImage?.id ?? 'add';
    onCloseImage();
  }

  if (expandedImage) return (
    <div className="image-inspection" role="dialog" aria-modal="true" aria-label="Full screen menu image"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeExpandedImage();
        if (event.key === 'Tab') { event.preventDefault(); expandedCloseRef.current?.focus(); }
      }}>
      <img src={expandedImage.url} alt={`Captured menu image ${images.indexOf(expandedImage) + 1}`} />
      <button ref={expandedCloseRef} className="camera-close" type="button" onClick={closeExpandedImage}>Close</button>
    </div>
  );

  return (
    <main className="screen capture-screen" aria-labelledby="capture-title">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
        onChange={acceptImage} />
      <div className="menu-content capture-content">
        <button className="capture-close" type="button" aria-label="Close image capture" onClick={onClose}>Close</button>
        <h1 id="capture-title">Preview your menu</h1>
        <p>Tap an image to check that the text is legible. Add menu pages in reading order.</p>
        {error && <p className="camera-message" role="alert">{error}</p>}
        {images.map((image, index) => image.error && <p key={image.id} className="camera-message" role="alert">
          Image {index + 1}: {image.error} Remove this image and take another photo, or select Done to retry.
        </p>)}
        <p className="camera-status" role="status">
          {`${images.length} of ${MAX_IMAGES} images captured.`}
        </p>
        {images.length > 0 && <ol className="capture-previews" aria-label="Captured menu images">
          {images.map((image, index) => <li key={image.id}>
            <button className="capture-thumbnail" type="button" aria-label={`Expand image ${index + 1}`}
              ref={(button) => { if (button) previewButtonsRef.current.set(image.id, button); else previewButtonsRef.current.delete(image.id); }}
              onClick={() => onExpandImage(image.id)}>
              <img src={image.url} alt={`Captured menu image ${index + 1}`} />
            </button>
            <button className="capture-remove" type="button" aria-label={`Remove image ${index + 1}`}
              onClick={() => removeImage(image)}>×</button>
          </li>)}
        </ol>}
        <div className="camera-actions">
          <button ref={addButtonRef} className="menu-button" type="button" onClick={openCamera}
            disabled={images.length >= MAX_IMAGES}>Add another image</button>
          <button className="menu-button" type="button" disabled={!images.length}
            onClick={() => {
              if (submittedRef.current || !images.length || !queueRef.current) return;
              submittedRef.current = true;
              onSubmit(queueRef.current);
            }}>Done</button>
        </div>
      </div>
    </main>
  );
}