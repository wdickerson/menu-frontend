import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { captureMenuImage, MAX_IMAGES, MAX_IMAGE_BYTES } from './menuApi';
import { setCameraTorch, supportsTorch } from './cameraTorch';

type CapturedImage = { id: string; blob: Blob; url: string };
type CameraCaptureProps = { onClose: () => void; onSubmit: (images: Blob[]) => void };

function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was denied. Allow camera access in your browser settings and try again.';
  }
  if (name === 'NotFoundError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is unavailable. Close other apps using it and try again.';
  return 'The camera could not be started. Please try again.';
}

export default function CameraCapture({ onClose, onSubmit }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const captureButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterRemovalRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const torchChangingRef = useRef(false);
  const activeRef = useRef(false);
  const urlsRef = useRef(new Set<string>());
  const capturingRef = useRef(false);
  const pointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [cameraState, setCameraState] = useState<'starting' | 'ready' | 'error'>('starting');
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchChanging, setTorchChanging] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (focusAfterRemovalRef.current) {
      focusAfterRemovalRef.current = false;
      captureButtonRef.current?.focus();
    }
  }, [images]);

  useEffect(() => {
    activeRef.current = true;
    closeRef.current?.focus();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      activeRef.current = false;
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
      document.documentElement.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    setCameraState('starting');
    setCameraError('');
    setTorchSupported(false);
    setTorchEnabled(false);
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState('error');
        setCameraError('Camera access requires HTTPS (or localhost) and a browser with camera support.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } } });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        if (!active) return;
        setCameraState('ready');
        setTorchSupported(supportsTorch(stream.getVideoTracks()[0]));
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
          if (active) {
            setCameraState('error');
            setTorchSupported(false);
            setTorchEnabled(false);
            setCameraError('The camera disconnected. Please try again.');
          }
        }));
      } catch (cameraError) {
        stream?.getTracks().forEach((track) => track.stop());
        if (active) {
          setCameraState('error');
          setCameraError(cameraErrorMessage(cameraError));
        }
      }
    }
    void startCamera();
    return () => {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (video?.srcObject === stream) video.srcObject = null;
    };
  }, [attempt]);

  async function toggleFlashlight() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torchChangingRef.current || cameraState !== 'ready') return;
    torchChangingRef.current = true;
    setTorchChanging(true);
    const enabled = !torchEnabled;
    try {
      await setCameraTorch(track, enabled);
      if (activeRef.current && streamRef.current?.getVideoTracks()[0] === track) {
        setTorchEnabled(enabled);
        setError('');
      }
    } catch {
      if (activeRef.current && streamRef.current?.getVideoTracks()[0] === track) {
        setError('The flashlight could not be changed. This camera or browser may not support it.');
      }
    } finally {
      torchChangingRef.current = false;
      if (activeRef.current) setTorchChanging(false);
    }
  }

  async function captureImage() {
    if (!videoRef.current || capturingRef.current || images.length >= MAX_IMAGES) return;
    capturingRef.current = true;
    setCapturing(true);
    setError('');
    try {
      const blob = await captureMenuImage(videoRef.current, zoomRef.current);
      if (!activeRef.current) return;
      if (images.reduce((sum, image) => sum + image.blob.size, 0) + blob.size > MAX_IMAGE_BYTES) {
        throw new Error('The photos have reached the upload size limit. Remove an image before capturing another.');
      }
      const url = URL.createObjectURL(blob);
      urlsRef.current.add(url);
      setImages((current) => [...current, { id: crypto.randomUUID(), blob, url }]);
    } catch (captureError) {
      if (activeRef.current) setError(captureError instanceof Error ? captureError.message : 'Capture failed. Try again.');
    } finally {
      capturingRef.current = false;
      if (activeRef.current) setCapturing(false);
    }
  }

  function removeImage(image: CapturedImage) {
    URL.revokeObjectURL(image.url);
    urlsRef.current.delete(image.url);
    focusAfterRemovalRef.current = true;
    setImages((current) => current.filter(({ id }) => id !== image.id));
    setError('');
  }

  function loadMenu() {
    if (capturingRef.current || torchChangingRef.current || !images.length) return;
    onSubmit(images.map(({ blob }) => blob));
  }

  function updatePinchStart() {
    const points = [...pointsRef.current.values()];
    pinchRef.current = points.length === 2
      ? { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom: zoomRef.current }
      : null;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (capturing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updatePinchStart();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointsRef.current.has(event.pointerId) || capturing) return;
    pointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointsRef.current.values()];
    const pinch = pinchRef.current;
    if (points.length !== 2 || !pinch || pinch.distance === 0) return;
    zoomRef.current = Math.min(4, Math.max(1, pinch.zoom
      * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / pinch.distance));
    setZoom(zoomRef.current);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointsRef.current.delete(event.pointerId);
    updatePinchStart();
  }

  return (
    <main className="camera-screen" aria-label="Capture a New Menu">
      <div className="camera-view" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={handlePointerEnd}>
        <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview"
          style={{ transform: `scale(${zoom})` }} />
      </div>
      <button className="camera-flashlight" type="button" aria-label="Flashlight" aria-pressed={torchEnabled}
        aria-describedby={!torchSupported && cameraState === 'ready' ? 'flashlight-unavailable' : undefined}
        disabled={cameraState !== 'ready' || !torchSupported || torchChanging}
        onClick={() => void toggleFlashlight()}>
        Flashlight {torchEnabled ? 'on' : 'off'}
      </button>
      <button ref={closeRef} className="camera-close" type="button" aria-label="Close camera" onClick={onClose}>
        Close
      </button>
      <div className="camera-overlay">
        {cameraState === 'error' && <div className="camera-message" role="alert">
          <p>{cameraError}</p>
          <button className="menu-button" type="button" disabled={torchChanging} onClick={() => setAttempt((value) => value + 1)}>
            Retry camera
          </button>
        </div>}
        {error && <p className="camera-message" role="alert">{error}</p>}
        {!torchSupported && cameraState === 'ready' && <p id="flashlight-unavailable" className="camera-status">
          Flashlight is not supported by this camera.
        </p>}
        <p className="camera-status" role="status">
          {capturing ? 'Capturing image…'
            : cameraState === 'starting' ? 'Starting camera…'
              : `${images.length} of ${MAX_IMAGES} images captured. Pinch the preview to zoom.`}
        </p>
        {images.length > 0 && <ol className="capture-previews" aria-label="Captured menu images">
          {images.map((image, index) => <li key={image.id}>
            <img src={image.url} alt={`Captured menu image ${index + 1}`} />
            <button type="button" aria-label={`Remove image ${index + 1}`} disabled={capturing}
              onClick={() => removeImage(image)}>×</button>
          </li>)}
        </ol>}
        <div className="camera-actions">
          <button ref={captureButtonRef} className="menu-button" type="button" onClick={() => void captureImage()}
            disabled={cameraState !== 'ready' || capturing || images.length >= MAX_IMAGES}>
            Capture an image
          </button>
          <button className="menu-button" type="button" onClick={loadMenu}
            disabled={!images.length || capturing || torchChanging}>Load this menu</button>
        </div>
      </div>
    </main>
  );
}