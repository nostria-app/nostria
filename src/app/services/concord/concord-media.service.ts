import { inject, PLATFORM_ID, Service, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { gcm } from '@noble/ciphers/aes.js';
import { chacha20poly1305, xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { LoggerService } from '../logger.service';
import { CordBlobPointer } from '../../interfaces/concord';
import { fromHex, toHex } from './concord-crypto';

/**
 * CORD-02 §6 encrypted media.
 *
 * A community's icon and banner never touch a media server in plaintext: each
 * is encrypted under a fresh random key and uploaded as an ordinary blob, and
 * the metadata entity carries only a `{url, key, nonce, hash}` pointer. The
 * server therefore learns nothing, and a swapped blob fails closed.
 *
 * The spec does not name the blob cipher, so this resolver tries the plausible
 * AEADs and accepts whichever both authenticates *and* matches the pointer's
 * hash. That is safe rather than lax: every candidate is authenticated, so a
 * wrong guess cannot silently produce attacker-chosen bytes — it simply fails.
 */
@Service()
export class ConcordMediaService {
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Resolved object URLs keyed by the pointer hash. */
  private readonly cache = new Map<string, string>();

  /** Sniffed MIME type per resolved URL, for preview dialogs. */
  private readonly mimeTypes = new Map<string, string>();

  /** Pointers already known to be unresolvable, so we stop refetching them. */
  private readonly failed = new Set<string>();

  /** Bumped whenever a new image resolves, so templates re-read the cache. */
  readonly revision = signal(0);

  /**
   * The displayable URL for an icon or banner.
   *
   * Returns null until the blob has been fetched and decrypted; callers should
   * fall back to initials meanwhile. Resolution is kicked off on first ask.
   */
  resolve(pointer: CordBlobPointer | string | undefined): string | null {
    if (!pointer) return null;

    // Some clients carry a plain URL rather than an encrypted pointer.
    if (typeof pointer === 'string') return pointer;
    if (!pointer.url) return null;

    // An unencrypted pointer is just a URL.
    if (!pointer.key || !pointer.nonce) return pointer.url;

    const cacheKey = pointer.hash || pointer.url;

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.failed.has(cacheKey)) {
      this.failed.add(cacheKey); // Prevent a fetch storm while this one runs.
      void this.fetchAndDecrypt(pointer, cacheKey);
    }

    return null;
  }

  /**
   * Resolve an attachment that carries its own encryption parameters.
   *
   * Chat attachments are uploaded as encrypted blobs and referenced by URL,
   * with the key and nonce riding the event's tags — a different shape from the
   * `{url,key,nonce,hash}` pointer a community icon uses, but the same problem:
   * the URL alone serves ciphertext, so `<img src>` renders nothing.
   */
  resolveAttachment(attachment: {
    url: string;
    key?: string;
    nonce?: string;
    algorithm?: string;
  }): string | null {
    if (!attachment.url) return null;

    // Unencrypted attachments are just URLs.
    if (!attachment.key || !attachment.nonce) return attachment.url;

    return this.resolve({
      url: attachment.url,
      key: attachment.key,
      nonce: attachment.nonce,
      hash: '',
    });
  }

  private async fetchAndDecrypt(pointer: CordBlobPointer, cacheKey: string): Promise<void> {
    if (!this.isBrowser) return;

    try {
      const response = await fetch(pointer.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const ciphertext = new Uint8Array(await response.arrayBuffer());
      const key = fromHex(pointer.key);
      const nonce = fromHex(pointer.nonce);

      // The pointer's hash may commit to the stored blob (Blossom-style
      // content addressing) or to the decrypted image; accept either, and
      // require one of them so a swapped blob still fails closed.
      const ciphertextHash = toHex(sha256(ciphertext));
      const expected = pointer.hash?.toLowerCase();

      const plaintext = this.decrypt(ciphertext, key, nonce, expected);

      if (!plaintext) {
        throw new Error('No supported cipher could authenticate this blob');
      }

      const plaintextHash = toHex(sha256(plaintext));

      if (expected && expected !== ciphertextHash && expected !== plaintextHash) {
        throw new Error('Blob hash does not match the pointer');
      }

      // Without an explicit type the browser treats the blob as text/plain,
      // which is why an object URL rendered as a wall of characters.
      const blob = new Blob([plaintext as BlobPart], { type: sniffMimeType(plaintext) });
      const url = URL.createObjectURL(blob);

      this.cache.set(cacheKey, url);
      this.mimeTypes.set(url, blob.type);
      this.failed.delete(cacheKey);
      this.revision.update(value => value + 1);
    } catch (error) {
      this.logger.debug('[Concord] Could not resolve encrypted media', {
        url: pointer.url,
        error,
      });
      // Stays in `failed`, so we do not hammer the media server.
    }
  }

  /**
   * Try each plausible AEAD. Every one is authenticated, so a wrong cipher
   * throws rather than returning attacker-controlled plaintext.
   */
  private decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
    expectedHash?: string
  ): Uint8Array | null {
    const candidates: { name: string; open: () => Uint8Array }[] = [];

    if (nonce.length === 12) {
      candidates.push(
        { name: 'aes-256-gcm', open: () => gcm(key, nonce).decrypt(ciphertext) },
        { name: 'chacha20-poly1305', open: () => chacha20poly1305(key, nonce).decrypt(ciphertext) }
      );
    } else if (nonce.length === 24) {
      candidates.push({
        name: 'xchacha20-poly1305',
        open: () => xchacha20poly1305(key, nonce).decrypt(ciphertext),
      });
    } else {
      // Unknown nonce width: try everything that can accept it.
      candidates.push(
        { name: 'aes-256-gcm', open: () => gcm(key, nonce).decrypt(ciphertext) },
        { name: 'xchacha20-poly1305', open: () => xchacha20poly1305(key, nonce).decrypt(ciphertext) }
      );
    }

    for (const candidate of candidates) {
      try {
        const plaintext = candidate.open();

        // If the pointer commits to the plaintext, insist on the match so we
        // never accept a cipher that merely happened to authenticate.
        if (expectedHash && toHex(sha256(plaintext)) !== expectedHash) {
          const looksLikeImage = hasImageMagic(plaintext);
          if (!looksLikeImage) continue;
        }

        return plaintext;
      } catch {
        // Wrong cipher for this blob; try the next.
      }
    }

    return null;
  }

  /** The sniffed MIME type of a resolved object URL. */
  mimeFor(url: string): string {
    return this.mimeTypes.get(url) ?? '';
  }

  /** Release object URLs, e.g. on sign-out. */
  clear(): void {
    for (const url of this.cache.values()) URL.revokeObjectURL(url);

    this.cache.clear();
    this.failed.clear();
    this.revision.update(value => value + 1);
  }
}

/** Cheap sanity check that decrypted bytes really are an image. */
/** Detect the media type from magic bytes, so the blob carries a real type. */
function sniffMimeType(bytes: Uint8Array): string {
  if (bytes.length < 12) return 'application/octet-stream';

  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';

  // RIFF containers: WEBP declares itself at offset 8.
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp';
  }

  // ISO base media (MP4/MOV) carries 'ftyp' at offset 4.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4';
  }

  // Matroska / WebM.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm';
  }

  return 'application/octet-stream';
}

function hasImageMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;

  // PNG, JPEG, GIF, WEBP (RIFF), BMP
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return true;
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;

  return false;
}
