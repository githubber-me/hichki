// Voice recording in the browser. Tap to start, tap to stop.
// Recordings stop on their own at 30 seconds, the longest Sarvam accepts in one go.

import { useEffect, useRef, useState } from 'react';

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function recordingName(blob: Blob): string {
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  return `recording.${ext}`;
}

export function useRecorder(onDone: (blob: Blob) => void, maxSeconds = 30) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef(0);
  const cancelled = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  async function start() {
    setError('');
    if (recorder.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser can’t record. Type it instead.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Allow the microphone, then try again.');
      return;
    }

    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    cancelled.current = false;

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      window.clearInterval(timer.current);
      recorder.current = null;
      setRecording(false);
      // Keep only the base type ("audio/webm"), which is what the server checks.
      const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      if (!cancelled.current && blob.size > 0) done.current(blob);
    };

    recorder.current = rec;
    rec.start();
    setRecording(true);
    setSeconds(0);
    const began = Date.now();
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= maxSeconds && rec.state === 'recording') rec.stop();
    }, 250);
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  function cancel() {
    cancelled.current = true;
    stop();
  }

  // Leaving the screen mid-recording throws the recording away.
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      window.clearInterval(timer.current);
    },
    [],
  );

  return { recording, seconds, left: Math.max(0, maxSeconds - seconds), error, start, stop, cancel };
}

// Phone photos are several megabytes. Shrinking them first makes sending quick
// on a crowded venue network. Falls back to the original if the browser can't.
export async function shrinkPhoto(file: File, maxSide = 1600): Promise<{ blob: Blob; name: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (blob) return { blob, name: 'photo.jpg' };
  } catch {
    // Use the original below.
  }
  return { blob: file, name: file.name || 'photo.jpg' };
}
