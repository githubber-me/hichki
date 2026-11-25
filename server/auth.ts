// Optional sign-in through Clerk, for gatherings where the host wants verified guests.
// The browser signs in with Google or a phone number and sends Clerk's session token;
// the server checks it and takes the guest's name and photo from their account, so a
// name can't be typed in to pass as someone else.
// Docs: https://clerk.com/docs

import { createClerkClient, verifyToken } from '@clerk/backend';
import { config } from './config.ts';
import { log } from './app.ts';

const { publishableKey, secretKey } = config.clerk;

export const signInEnabled = publishableKey.length > 0 && secretKey.length > 0;

const clerk = signInEnabled ? createClerkClient({ secretKey, publishableKey }) : null;

export type SignedInGuest = { userId: string; name: string; avatarUrl: string | null };

export class SignInError extends Error {}

// Reads "Authorization: Bearer <session token>" and returns who signed in.
export async function signedInGuest(authorization: string | undefined): Promise<SignedInGuest> {
  if (!clerk) throw new SignInError('Sign-in isn’t set up on this server.');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new SignInError('Sign in to join this gathering.');

  let userId: string;
  try {
    const payload = await verifyToken(token, { secretKey });
    userId = payload.sub;
  } catch (err) {
    log.warn({ event: 'sign_in_rejected', err: (err as Error).message }, 'session token rejected');
    throw new SignInError('Your sign-in has expired. Sign in again.');
  }

  const user = await clerk.users.getUser(userId);
  const phone = user.primaryPhoneNumber?.phoneNumber ?? user.phoneNumbers[0]?.phoneNumber ?? '';
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.username ||
    // A phone-only account has no name yet: show the last four digits.
    (phone ? `Guest ${phone.slice(-4)}` : 'Guest');

  return { userId, name: name.slice(0, 40), avatarUrl: user.hasImage ? user.imageUrl : null };
}
