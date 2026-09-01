import { ApiError } from './errors.mjs';

/**
 * Infrastructure service that owns JSON-over-HTTP behavior.
 *
 * Input:
 *   - url: relative or absolute HTTP URL.
 *   - method/body/signal: normal fetch request data.
 * Output:
 *   - Parsed JSON, null for a successful empty response.
 * Throws:
 *   - ApiError for non-2xx responses, invalid JSON, or transport failures.
 */
export class JsonApiClient {
  constructor({ fetchImpl = globalThis.fetch, defaultHeaders = {} } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('JsonApiClient requires a fetch implementation.');
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.defaultHeaders = { ...defaultHeaders };
  }

  get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  post(url, body, options = {}) {
    return this.request(url, { ...options, method: 'POST', body });
  }

  async request(url, { method = 'GET', body, signal, headers = {} } = {}) {
    const requestHeaders = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...headers,
    };

    const request = {
      method,
      signal,
      headers: requestHeaders,
    };

    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      request.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(url, request);
    } catch (cause) {
      if (cause?.name === 'AbortError') throw cause;
      throw new ApiError(`Network request failed for ${method} ${url}.`, { cause });
    }

    const raw = await response.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (cause) {
        throw new ApiError(`Expected JSON from ${method} ${url}.`, {
          status: response.status,
          data: { raw },
          cause,
        });
      }
    }

    if (!response.ok) {
      const message = data?.error ?? data?.message ?? `Request failed with status ${response.status}.`;
      throw new ApiError(message, { status: response.status, data });
    }

    return data;
  }
}
