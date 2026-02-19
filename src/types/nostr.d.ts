// Type definitions for NIP-07 window.nostr object
// Based on NIP-07 spec: https://github.com/nostria-app/nips/blob/master/07.md

interface UserMetadata {
  name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  [key: string]: unknown;
}

// interface NostrEvent {
//   id: string;
//   pubkey: string;
//   created_at: number;
//   kind: number;
//   tags: string[][];
//   content: string;
//   sig: string;
// }

interface SignEventResponse {
  id: string;
  sig: string;
}

interface Nip07NostrProvider {
  /**
   * Get the user's public key after asking for user consent
   */
  getPublicKey(): Promise<string>;

  /**
   * Get the user's profile metadata
   */
  getUserMetadata(): Promise<UserMetadata>;

  /**
   * Sign an event with the user's private key
   */
  signEvent(event: Partial<NostrEvent>): Promise<SignEventResponse>;

  /**
   * Encrypt a message with NIP-04
   */
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };

  /**
   * Encrypt a message with NIP-44
   */
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: Nip07NostrProvider;
  }
}

export { };
