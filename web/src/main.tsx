import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Create } from './screens/Create.tsx';
import { Host } from './screens/Host.tsx';
import { Guest } from './screens/Guest.tsx';
import { Away } from './screens/Away.tsx';
import './theme.css';

// Four pages, picked from the address:
//   /                      create a gathering
//   /g/CODE                guests join here (this is what the QR code opens)
//   /g/CODE/host?t=TOKEN   the host's screen with the QR code
//   /g/CODE/away?t=TOKEN   the private link for the person who couldn't come
function Page() {
  const [, , code, view] = location.pathname.split('/');
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const id = (code ?? '').toUpperCase();

  if (!location.pathname.startsWith('/g/') || !id) return <Create />;
  if (view === 'host') return <Host id={id} token={token} />;
  if (view === 'away') return <Away id={id} token={token} />;
  return <Guest id={id} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
