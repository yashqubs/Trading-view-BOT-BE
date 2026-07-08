import { HttpException, HttpStatus } from '@nestjs/common';

// Extends HttpException (not plain Error) so GlobalExceptionFilter reports the
// real IG error code as a 502 instead of collapsing it into an opaque 500 —
// IG's error codes (e.g. "error.security.invalid-details") are diagnostic
// classifications, not secrets, so they're safe to return to an authenticated
// portal user. Trade-execution paths (trade.service.ts) still catch this
// internally via `instanceof IgApiException` and never let it reach an HTTP
// response there — this only changes what read paths like stats/markets show.
export class IgApiException extends HttpException {
  constructor(public readonly errorCode: string) {
    super(`IG API error: ${errorCode}`, HttpStatus.BAD_GATEWAY);
  }
}
