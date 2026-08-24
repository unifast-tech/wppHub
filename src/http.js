const DEFAULT_TIMEOUT = 10000
const MAX_RETRIES = 2

function canRetry(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase())
}

function shouldRetryResponse(response) {
  return response.status >= 500 && response.status <= 599
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function isFormDataBody(body) {
  return typeof FormData !== 'undefined' && body instanceof FormData
}

export async function httpFetch(input, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = MAX_RETRIES,
    onUnauthorized,
    ...fetchOptions
  } = options
  const method = String(fetchOptions.method || 'GET').toUpperCase()
  const retryable = canRetry(method)
  const totalRetries = retryable ? Math.min(Math.max(Number(retries) || 0, 0), MAX_RETRIES) : 0
  let attempt = 0

  while (true) {
    const controller = new AbortController()
    const externalSignal = fetchOptions.signal
    const abortFromExternal = () => controller.abort(externalSignal.reason)
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason)
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
    }
    const timeoutId = window.setTimeout(() => controller.abort(new Error('TIMEOUT')), timeout)

    try {
      const headers = new Headers(fetchOptions.headers || {})
      if (fetchOptions.body && !isFormDataBody(fetchOptions.body) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      const response = await fetch(input, { ...fetchOptions, method, headers, signal: controller.signal })
      if (response.status === 401 && onUnauthorized) onUnauthorized(response)
      if (shouldRetryResponse(response) && attempt < totalRetries) {
        attempt += 1
        await wait(300 * attempt)
        continue
      }
      return response
    } catch (error) {
      const externallyAborted = externalSignal?.aborted
      const timeoutError = controller.signal.aborted && !externallyAborted
      if (externallyAborted) throw error
      if (attempt >= totalRetries) {
        const normalized = new Error(timeoutError ? 'A requisição excedeu o tempo limite.' : 'Não foi possível conectar ao servidor.')
        normalized.code = timeoutError ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR'
        normalized.cause = error
        throw normalized
      }
      attempt += 1
      await wait(300 * attempt)
    } finally {
      window.clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', abortFromExternal)
    }
  }
}

export async function readHttpError(response, fallback = 'A API retornou um erro.') {
  const payload = await response.json().catch(() => null)
  const error = new Error(payload?.error || payload?.message || fallback)
  error.code = payload?.code
  error.status = response.status
  error.details = payload
  return error
}
