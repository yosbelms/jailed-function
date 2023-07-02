export enum ErrorType {
  TIMEOUT = 2,
  MEMORY_LIMIT = 3,
}

export class TimeoutError extends Error {
  errorType: ErrorType = ErrorType.TIMEOUT
}

export class MemoryLimitError extends Error {
  errorType: ErrorType = ErrorType.MEMORY_LIMIT
}
