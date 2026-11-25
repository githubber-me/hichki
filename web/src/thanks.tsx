// A thank-you from the person who couldn't come, to whoever sent the photo they picked:
// a line of text, a voice note, or a short selfie video recorded right here.

import { useEffect, useRef, useState } from 'react';
import type { Proof, RoomApi } from './api.ts';
import { RecordButton, MicIcon, uploadRecording } from './parts.tsx';

const VIDEO_SECONDS = 20;
const VIDEO_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];

// Shows a thank-you, for the away person and for the room.
export function ThanksView({ thanks, from }: { thanks: NonNullable<Proof['thanks']>; from: string }) {
  return (
    <div className="thanks">
      <p className="eyebrow">{from} said thank you</p>
      {thanks.text && <p className="thanks-text">&ldquo;{thanks.text}&rdquo;</p>}
      {thanks.url && thanks.media === 'video' && <video className="thanks-video" src={thanks.url} controls playsInline preload="metadata" />}
      {thanks.url && thanks.media === 'audio' && <audio src={thanks.url} controls preload="none" />}
    </div>
  );
}

// For the away person, under the proof they picked.
export function ThanksComposer({ api, proof }: { api: RoomApi; proof: Proof }) {
  const [mode, setMode] = useState<'' | 'text' | 'video'>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function send(changes: { text?: string; file?: string }) {
    setError('');
    try {
      await api.thank(proof.id, changes);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  }

  async function voice(blob: Blob) {
    setBusy('Sending…');
    try {
      const up = await uploadRecording(api, blob);
      await send({ file: up.file });
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }

  async function video(blob: Blob) {
    setBusy('Sending…');
    try {
      const up = await api.upload(blob, blob.type.includes('mp4') ? 'thanks.mp4' : 'thanks.webm');
      await send({ file: up.file });
      setMode('');
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }

  return (
    <div className="thanks-compose">
      <p className="eyebrow">Say thank you to {proof.memberName}</p>
      {mode === '' && (
        <div className="thanks-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setMode('text')}>
            Write
          </button>
          <RecordButton onDone={voice} disabled={!!busy} className="btn btn-quiet btn-small" maxSeconds={Infinity} idle={<><MicIcon /> Voice</>} />
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setMode('video')}>
            Video
          </button>
        </div>
      )}
      {mode === 'text' && (
        <form
          className="thanks-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return setError('Write a line first.');
            setBusy('Sending…');
            send({ text: text.trim() });
          }}
        >
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="You made my whole day" autoFocus />
          <div className="thanks-actions">
            <button className="btn btn-primary btn-small" disabled={!!busy}>
              {busy || 'Send'}
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setMode('')}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {mode === 'video' && <VideoNote onDone={video} onCancel={() => setMode('')} busy={!!busy} />}
      {busy && mode === '' && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// A short selfie video, kept small so it sends quickly on a phone connection.
function VideoNote({ onDone, onCancel, busy }: { onDone: (blob: Blob) => void; onCancel: () => void; busy: boolean }) {
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser can’t record video. Write a line or send a voice note instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (preview.current) preview.current.srcObject = s;
      })
      .catch(() => setError('Allow the camera and microphone, then try again.'));
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function start() {
    if (!stream.current) return;
    const mimeType = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream.current, { mimeType, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      setRecording(false);
      onDone(new Blob(chunks, { type: (rec.mimeType || 'video/webm').split(';')[0] }));
    };
    rec.start(1000);
    recorder.current = rec;
    setRecording(true);
    setSeconds(0);
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= VIDEO_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  if (error) return <p className="error">{error}</p>;
  return (
    <div className="video-note">
      <video ref={preview} className="thanks-video" autoPlay muted playsInline />
      <div className="thanks-actions">
        {!recording ? (
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={start}>
            {busy ? 'Sending…' : 'Record'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-small" onClick={stop}>
            Stop and send ({VIDEO_SECONDS - seconds}s)
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-small" disabled={recording || busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
