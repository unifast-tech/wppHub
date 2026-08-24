const AUTH_TOKEN_KEY = 'wpphub.auth.token'
const AUTH_USER_KEY = 'wpphub.auth.user'
const AUTH_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL || '/api/auth').replace(/\/$/, '')

export function getAuthSession() {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
  if (!token) return null
  const rawUser = window.localStorage.getItem(AUTH_USER_KEY)
  return { token, user: rawUser ? JSON.parse(rawUser) : null }
}

export function authHeaders() {
  const session = getAuthSession()
  return session ? { Authorization: `Bearer ${session.token}` } : {}
}

export async function login(email, password) {
  const response = await fetch(`${AUTH_BASE_URL}/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Não foi possível entrar.')
  const token = payload?.token || payload?.access_token
  if (!token) throw new Error('O login não retornou um token de acesso.')
  const user = payload?.user || null
  window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  if (user) window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
  return { token, user }
}

export async function registerUser({ name, email, password, passwordConfirmation, department }) {
  const response = await fetch(`${AUTH_BASE_URL}/register`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, passwordConfirmation, department }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Não foi possível concluir o cadastro.')
  return payload
}

export async function getAdminUsers() {
  const response = await fetch('/api/admin/users', { headers: { Accept: 'application/json', ...authHeaders() } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar os usuários.')
  return payload.users || []
}

export async function updateAdminUser(userId, changes) {
  const response = await fetch(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(changes) })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível atualizar o usuário.')
  return payload.user
}

export async function deleteAdminUser(userId) {
  const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Não foi possível excluir o usuário.')
  }
}

export async function resetAdminUserPassword(userId) {
  const response = await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST', headers: authHeaders() })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível redefinir a senha.')
  return payload
}

export async function getAccountDepartments() {
  const response = await fetch('/api/admin/account-departments', { headers: { Accept: 'application/json', ...authHeaders() } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar as permissões.')
  return payload
}

export async function setAccountDepartment(mapping) {
  const response = await fetch('/api/admin/account-departments', { method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(mapping) })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar a permissão.')
  return payload.mapping
}

export async function removeAccountDepartment(channel, accountId) {
  const response = await fetch(`/api/admin/account-departments/${channel}/${encodeURIComponent(accountId)}`, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) throw new Error('Não foi possível remover a permissão.')
}

export function logout() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
  window.localStorage.removeItem(AUTH_USER_KEY)
}
