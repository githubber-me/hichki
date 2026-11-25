// Phone behaviour that makes the hichki moment actually land:
// keep the screen awake, and unlock sound with one tap (browsers block audio
// until someone has touched the page).

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Sound: one shared AudioContext, unlocked by the first tap.
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

export function soundReady(): boolean {
  return ctx?.state === 'running';
}

export async function unlockSound(): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  try {
    await c.resume();
  } catch {
    // stays blocked; the screen and the buzz still say it
  }
  return c.state === 'running';
}

// Two soft rising notes: the hichki.
export function playHichki() {
  const c = audio();
  if (!c || c.state !== 'running') return;
  [0, 0.16].forEach((at, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = i ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, c.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.25, c.currentTime + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + 0.14);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + at);
    osc.stop(c.currentTime + at + 0.16);
  });
}

// "Tap to turn sound on", until the page has been touched once.
export function SoundPrimer({ label = 'Tap to turn sound on' }: { label?: string }) {
  const [on, setOn] = useState(soundReady());

  // Any first touch anywhere on the page unlocks it too.
  useEffect(() => {
    if (on) return;
    const first = () => unlockSound().then(setOn);
    window.addEventListener('pointerdown', first, { once: true });
    return () => window.removeEventListener('pointerdown', first);
  }, [on]);

  if (on) return null;
  return (
    <button type="button" className="banner sound-primer" onClick={() => unlockSound().then(setOn)}>
      {label}, so you hear every hichki
    </button>
  );
}

// ---------------------------------------------------------------------------
// Keep the screen on while this page is open (where the phone allows it).
// ---------------------------------------------------------------------------

type Sentinel = { release: () => Promise<void> };

export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let gone = false;

    const take = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock!.request('screen').then(
        (l) => {
          if (gone) l.release().catch(() => {});
          else lock = l;
        },
        () => {}, // refused (battery saver, or not allowed): fine
      );
    };

    take();
    // The lock drops whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', take);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', take);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
