/** Base error for predictable application failures. */
export class ApplicationError extends Error {
  constructor(message, { code = 'APPLICATION_ERROR', cause = null, details = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** HTTP or transport failure returned by the API gateway. */
export class ApiError extends ApplicationError {
  constructor(message, { status = 0, data = null, cause = null } = {}) {
    super(message, { code: 'API_ERROR', cause, details: data });
    this.status = status;
    this.data = data;
  }
}

/** Invalid chess position, square, piece, FEN, or UCI input. */
export class ChessDataError extends ApplicationError {
  constructor(message, { code = 'CHESS_DATA_ERROR', details = null } = {}) {
    super(message, { code, details });
  }
}
