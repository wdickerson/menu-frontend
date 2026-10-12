type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraints = MediaTrackConstraintSet & { torch: boolean };

export function supportsTorch(track: MediaStreamTrack | undefined): boolean {
  if (!track || track.readyState === 'ended' || typeof track.applyConstraints !== 'function') return false;
  try {
    return (track.getCapabilities?.() as TorchCapabilities | undefined)?.torch === true;
  } catch {
    return false;
  }
}

export async function setCameraTorch(track: MediaStreamTrack, enabled: boolean): Promise<void> {
  if (!supportsTorch(track)) throw new Error('Flashlight is not supported by this camera.');
  const constraints: TorchConstraints = { torch: enabled };
  await track.applyConstraints({ advanced: [constraints] });
}