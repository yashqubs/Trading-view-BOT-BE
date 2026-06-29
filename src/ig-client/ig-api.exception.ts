export class IgApiException extends Error {
  constructor(public readonly errorCode: string) {
    super(`IG API error: ${errorCode}`);
  }
}
