export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const firebaseServiceErrors = new Set([
  'app/invalid-credential',
  'auth/invalid-credential',
  'auth/insufficient-permission',
]);
export const isFirebaseServiceError = error => firebaseServiceErrors.has(error?.code);

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve().then(() => handler(req, res, next)).catch(next);
};

export function serialize(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const serviceUnavailable = isFirebaseServiceError(error);
  const status = error instanceof HttpError ? error.status : serviceUnavailable ? 503 : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError && error.status === 400 ? 400 : 500;
  if (serviceUnavailable) console.error('Account service unavailable:', error.code, 'Check Firebase server credentials and outbound access to Google APIs.');
  else if (status >= 500 && !(error instanceof HttpError)) console.error('Request failed:', error.code || error.name || 'Error');
  const message = error instanceof HttpError ? error.message : serviceUnavailable ? 'The account service is unavailable. Please try again shortly.' : status === 400 ? 'The request body must contain valid JSON.' : status === 413 ? 'The request is too large.' : 'Something went wrong. Please try again.';
  res.status(status).json({ error: message });
}
