// Take a photo without leaving Hichki: a live camera view with a shutter, then
// retake or send. The gallery is always one tap away, and is the fallback when the
// camera isn't allowed or there isn't one.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Facing = 'environment' | 'user';

export function Camera({
  facing: startFacing = 'environment',
  onPhoto,
  onClose,
}: {
  facing?: Facing;
  onPhoto: (file: File) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<Facing>(startFacing);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  // Start (or restart, after flipping) the camera.
  useEffect(() => {
    let stopped = false;
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t open the camera. Choose a photo instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = s;
        setError('');
        const v = video.current;
        if (v) {
          // Listen before connecting: on a fast phone the video can be ready at once.
          const markReady = () => v.videoWidth > 0 && setReady(true);
          v.onloadedmetadata = markReady;
          v.onplaying = markReady;
          v.srcObject = s;
          v.play().catch(() => {});
          markReady();
        }
      })
      .catch(() => setError('Allow the camera to take a photo here, or choose one from your gallery.'));
    return () => {
      stopped = true;
    };
  }, [facing]);

  // Turn the camera off when the sheet closes.
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  // Free the preview image when it's replaced.
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  function take() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The front camera shows a mirror image; save it the way people see themselves.
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
        setShot({ file, url: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.9,
    );
  }

  function send(file: File) {
    stream.current?.getTracks().forEach((t) => t.stop());
    onPhoto(file);
    onClose();
  }

  // Rendered at the top of the page, so animated cards around the button can't trap it.
  return createPortal(
    <div className="camera" role="dialog" aria-modal="true" aria-label="Take a photo">
      <div className="camera-view">
        {shot ? (
          <img src={shot.url} alt="Your photo" />
        ) : (
          <video ref={video} autoPlay playsInline muted className={facing === 'user' ? 'is-mirrored' : ''} />
        )}
        {!shot && !ready && !error && <p className="camera-note">Opening the camera&hellip;</p>}
        {error && <p className="camera-note">{error}</p>}
      </div>

      <div className="camera-bar">
        {shot ? (
          <>
            <button type="button" className="btn btn-quiet" onClick={() => setShot(null)}>
              Retake
            </button>
            <button type="button" className="btn btn-primary" onClick={() => send(shot.file)}>
              Send
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-quiet camera-side" onClick={() => gallery.current?.click()}>
              Gallery
            </button>
            <button type="button" className="camera-shutter" onClick={take} disabled={!ready} aria-label="Take the photo" />
            <button
              type="button"
              className="btn btn-quiet camera-side"
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              disabled={!!error}
              aria-label="Switch camera"
            >
              Flip
            </button>
          </>
        )}
      </div>

      <button type="button" className="camera-close" onClick={onClose} aria-label="Close the camera">
        &times;
      </button>

      <input
        ref={gallery}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) send(file);
        }}
      />
    </div>,
    document.body,
  );
}
