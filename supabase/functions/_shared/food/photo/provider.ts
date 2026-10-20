// The port a food-photo provider must implement, and nothing more. A provider sees one validated image and suggests
// REFERENCES to records Rise120 already holds. It never supplies nutrition, names or text that reach the member: the
// server resolves each reference against the catalogue and builds the answer itself. No real provider exists yet;
// F2 Task 4 gates adding one.
export interface PhotoGuess {
  kind: 'food' | 'recipe';
  id: string;
  confidence?: 'low' | 'medium' | 'high';
  servings?: number; // a portion suggestion, in servings of the listed food or recipe
}

export interface PhotoProvider {
  identify(image: Uint8Array, options: { signal: AbortSignal }): Promise<PhotoGuess[]>;
}

// outcomeUnknown is true when the request may have reached the provider and produced (and billed) an answer we never
// saw. Such a request is never started again under the same request id.
export class PhotoProviderError extends Error {
  readonly kind: 'unavailable' | 'invalid';
  readonly outcomeUnknown: boolean;

  constructor(kind: 'unavailable' | 'invalid', outcomeUnknown: boolean, message: string) {
    super(message);
    this.name = 'PhotoProviderError';
    this.kind = kind;
    this.outcomeUnknown = outcomeUnknown;
    Object.setPrototypeOf(this, PhotoProviderError.prototype);
  }
}
