import type { ErrorCode } from '../../../src/shared/types'
/** Business failure returned to the client as { ok:false, error }. */
export class Fail { constructor(public code: ErrorCode, public message: string, public retryable = false, public retryAfterMs?: number) {} }
