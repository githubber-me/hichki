// Joining a verified gathering: sign in with Google or a phone number (Clerk),
// and the server takes the guest's name and photo from that account.
// Loaded only for verified gatherings, so open gatherings never download Clerk.

import { useEffect, useRef, useState } from 'react';
import { ClerkProvider, Show, SignInButton, SignOutButton, useAuth, useUser } from '@clerk/react';
import { api, saved, type Member, type PublicGathering } from './api.ts';

type Props = { publishableKey: string; gathering: PublicGathering; onJoined: (m: Member) => void };

export default function VerifiedJoin({ publishableKey, gathering, onJoined }: Props) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <JoinCard gathering={gathering} onJoined={onJoined} />
    </ClerkProvider>
  );
}

function JoinCard({ gathering, onJoined }: Omit<Props, 'publishableKey'>) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [error, setError] = useState('');
  const tried = useRef(false);

  // Once signed in, join straight away: there's nothing left to type.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || tried.current) return;
    tried.current = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Your sign-in has expired. Sign in again.');
        const { member } = await api.joinSignedIn(gathering.id, token);
        saved.setMember(gathering.id, member);
        onJoined(member);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [isLoaded, isSignedIn, getToken, gathering.id, onJoined]);

  // Come back to this same page after signing in with Google.
  const here = location.href;

  return (
    <section className="card verified-join">
      <p className="badge badge-verified">Verified guests only</p>
      <p className="muted">
        The host asked everyone to sign in, so your name comes from your account and nobody else can use it.
      </p>

      {!isLoaded && <p className="muted">Getting sign-in ready&hellip;</p>}

      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl={here} signUpForceRedirectUrl={here}>
          <button type="button" className="btn btn-primary">
            Continue with Google or phone
          </button>
        </SignInButton>
      </Show>

      <Show when="signed-in">
        {!error && <p className="muted">Joining as {user?.fullName || user?.primaryPhoneNumber?.phoneNumber || 'you'}&hellip;</p>}
        {error && (
          <>
            <p className="error">{error}</p>
            <SignOutButton redirectUrl={here}>
              <button type="button" className="btn btn-quiet">
                Use a different account
              </button>
            </SignOutButton>
          </>
        )}
      </Show>
    </section>
  );
}
