// Photos and voice recordings people upload. Stored on disk under DATA_DIR/uploads,
// one folder per gathering, with random names so links can't be guessed.

import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';
import { config } from './config.ts';
import { secret } from './db.ts';

export const uploadsDir = resolve(config.dataDir, 'uploads');
mkdirSync(uploadsDir, { recursive: true });

export type Media = 'photo' | 'audio' | 'video';

const EXTENSIONS: Record<string, { ext: string; media: Media }> = {
  'image/jpeg': { ext: 'jpg', media: 'photo' },
  'image/png': { ext: 'png', media: 'photo' },
  'image/webp': { ext: 'webp', media: 'photo' },
  'image/heic': { ext: 'heic', media: 'photo' },
  'image/heif': { ext: 'heif', media: 'photo' },
  'audio/webm': { ext: 'webm', media: 'audio' },
  'audio/ogg': { ext: 'ogg', media: 'audio' },
  'audio/mp4': { ext: 'm4a', media: 'audio' },
  'audio/x-m4a': { ext: 'm4a', media: 'audio' },
  'audio/aac': { ext: 'aac', media: 'audio' },
  'audio/mpeg': { ext: 'mp3', media: 'audio' },
  'audio/wav': { ext: 'wav', media: 'audio' },
  'audio/x-wav': { ext: 'wav', media: 'audio' },
  'video/mp4': { ext: 'mp4', media: 'video' },
  'video/webm': { ext: 'webm', media: 'video' },
  'video/quicktime': { ext: 'mov', media: 'video' },
};

// Browsers add codec details ("audio/webm;codecs=opus"); only the base type matters here.
export function baseType(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

export function kindOf(mime: string) {
  return EXTENSIONS[baseType(mime)];
}

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type StoredFile = { file: string; url: string; media: Media; mime: string; bytes: number };

export async function saveUpload(gatheringId: string, part: MultipartFile): Promise<StoredFile> {
  const kind = kindOf(part.mimetype);
  if (!kind) throw new UploadError('That file type isn’t supported. Send a photo or a voice note.', 415);

  const folder = join(uploadsDir, gatheringId);
  mkdirSync(folder, { recursive: true });
  const name = `${secret()}.${kind.ext}`;
  const path = join(folder, name);

  await pipeline(part.file, createWriteStream(path));
  if (part.file.truncated) {
    throw new UploadError(`That file is too big. The limit is ${config.maxUploadMb} MB.`, 413);
  }

  const file = `${gatheringId}/${name}`;
  return { file, url: mediaUrl(file), media: kind.media, mime: baseType(part.mimetype), bytes: statSync(path).size };
}

// A stored file reference is "GATHERING/name.ext". Reject anything else, so a
// request can't point at another gathering's files or outside the folder.
export function isOwnFile(gatheringId: string, file: unknown): file is string {
  return typeof file === 'string' && new RegExp(`^${gatheringId}/[0-9a-f]{32}\\.[a-z0-9]{2,4}$`).test(file);
}

export function filePath(file: string): string {
  return join(uploadsDir, file);
}

export function mediaUrl(file: string): string {
  return `/media/${file}`;
}

export function mediaOf(file: string): Media {
  const ext = file.split('.').pop() ?? '';
  const match = Object.values(EXTENSIONS).find((k) => k.ext === ext);
  return match?.media ?? 'photo';
}

export function mimeOf(file: string): string {
  const ext = file.split('.').pop() ?? '';
  return Object.entries(EXTENSIONS).find(([, k]) => k.ext === ext)?.[0] ?? 'application/octet-stream';
}
