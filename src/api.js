import { notifySessionExpired, recordActivity } from './auth'
import { httpFetch, readHttpError } from './http'

const CHANNELS = {
  hub: {
    baseUrl: (import.meta.env.VITE_HUB_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || 'https://whatsapp.prosperargroup.com.br/api/v1').replace(/\/$/, ''),
    token: import.meta.env.VITE_HUB_API_TOKEN || import.meta.env.VITE_API_TOKEN || '',
    accountId: import.meta.env.VITE_HUB_ACCOUNT_ID || import.meta.env.VITE_ACCOUNT_ID || '',
  },
  official: {
    baseUrl: (import.meta.env.VITE_OFFICIAL_API_BASE_URL || '/official-api').replace(/\/$/, ''),
    token: '',
    accountId: import.meta.env.VITE_OFFICIAL_ACCOUNT_ID || '',
  },
}
export const ATTENDANT_NAME = import.meta.env.VITE_ATTENDANT_NAME || ''
const DEMO_MODE = String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true'

function authHeaders() {
  const token = window.localStorage.getItem('wpphub.auth.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const demoMessages = [
  { id: '1', direction: 'inbound', text: 'Oi! Gostaria de saber mais sobre os planos.', timestamp: '2026-08-17T12:41:00-03:00', status: 'read' },
  { id: '2', direction: 'outbound', text: 'Olá, Maria! Claro. Hoje temos opções a partir de R$ 89 por mês. Posso te ajudar a encontrar o plano ideal?', timestamp: '2026-08-17T12:42:00-03:00', status: 'read' },
  { id: '3', direction: 'inbound', text: 'Pode sim. Preciso para uma equipe de 5 pessoas.', timestamp: '2026-08-17T12:44:00-03:00', status: 'read' },
  { id: '4', direction: 'outbound', text: 'Perfeito! Nesse caso, o plano Equipe é o mais indicado. Vou te enviar os detalhes por aqui.', timestamp: '2026-08-17T12:45:00-03:00', status: 'delivered' },
]

function normalizeMessage(message, index) {
  const rawDirection = message.direcao ?? message.direction ?? message.type ?? message.fromMe ?? message.from_me
  const outbound = rawDirection === true || ['enviada', 'outbound', 'sent', 'outgoing', 'from_me'].includes(String(rawDirection).toLowerCase())
  const messageKind = String(message.tipo ?? message.type ?? '').toLowerCase()
  const isReaction = messageKind === 'reacao'
  const reactionTarget = message.reagiu_a ?? message.reaction ?? null
  const rawAttachment = message.anexo ?? message.attachment ?? null
  return {
    id: String(message.id ?? message.messageId ?? message.message_id ?? index),
    direction: outbound ? 'outbound' : 'inbound',
    text: isReaction ? '' : message.texto ?? message.text ?? message.body ?? message.content ?? message.message ?? '',
    timestamp: message.em ?? message.timestamp ?? message.createdAt ?? message.created_at ?? message.date ?? null,
    status: message.status ?? (outbound ? 'sent' : 'read'),
    kind: messageKind,
    isReaction,
    reaction: isReaction ? (message.texto ?? message.text ?? '') : '',
    reactionTargetId: isReaction ? String(reactionTarget?.id ?? reactionTarget?.messageId ?? reactionTarget?.message_id ?? '') : '',
    attachment: rawAttachment ? {
      type: String(rawAttachment.tipo ?? rawAttachment.type ?? '').toLowerCase(),
      mime: rawAttachment.mime ?? rawAttachment.mimeType ?? rawAttachment.mimetype ?? '',
      name: rawAttachment.nome ?? rawAttachment.name ?? '',
      bytes: rawAttachment.bytes ?? rawAttachment.size ?? null,
      ready: rawAttachment.pronto ?? rawAttachment.ready ?? true,
      status: rawAttachment.status ?? '',
      url: rawAttachment.url ?? rawAttachment.href ?? '',
    } : null,
  }
}

function attachReactions(messages) {
  const reactions = messages.filter((message) => message.isReaction && message.reactionTargetId)
  const messageIds = new Set(messages.filter((message) => !message.isReaction).map((message) => message.id))
  return messages
    .filter((message) => !message.isReaction || !messageIds.has(message.reactionTargetId))
    .map((message) => {
      const reaction = reactions.find((item) => item.reactionTargetId === message.id)
      return reaction ? { ...message, reaction: reaction.reaction, reactionId: reaction.id } : message
    })
}

function sortMessagesChronologically(messages) {
  return [...messages].sort((a, b) => {
    const first = new Date(a.timestamp).getTime()
    const second = new Date(b.timestamp).getTime()
    if (Number.isNaN(first) && Number.isNaN(second)) return 0
    if (Number.isNaN(first)) return 1
    if (Number.isNaN(second)) return -1
    return first - second
  })
}

function normalizeConversation(payload, phone) {
  const root = payload?.data ?? payload
  const conversation = root?.conversation ?? root?.chat ?? root
  const messages = conversation?.messages ?? root?.messages ?? (Array.isArray(root) ? root : [])
  const contact = conversation?.contact ?? root?.contact ?? {}
  return {
    contact: {
      name: contact.name ?? conversation?.name ?? root?.name ?? 'Contato',
      phone: contact.phone ?? conversation?.telefone ?? conversation?.phone ?? root?.telefone ?? root?.phone ?? phone,
      avatar: contact.avatar ?? contact.picture ?? conversation?.avatar ?? null,
    },
    messages: Array.isArray(messages) ? attachReactions(sortMessagesChronologically(messages.map(normalizeMessage))) : [],
    windowOpen: root?.janela_aberta ?? conversation?.janela_aberta ?? null,
  }
}

export function cleanPhone(value) {
  return value.replace(/\D/g, '')
}

export function normalizeBrazilianPhone(value) {
  const digits = cleanPhone(value)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

function configFor(channel) {
  return CHANNELS[channel] || CHANNELS.hub
}

function headers(channel) {
  const { token } = configFor(channel)
  return { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

function resolveApiUrl(channel, path) {
  if (/^https?:\/\//i.test(path)) return path
  const { baseUrl } = configFor(channel)
  if (/^https?:\/\//i.test(baseUrl)) return new URL(path, `${baseUrl}/`).toString()
  const normalizedPath = path.replace(/^\/api\/v1/, '')
  return new URL(`${baseUrl}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`, window.location.origin).toString()
}

async function parseError(response) {
  if (response.status === 401) notifySessionExpired()
  return readHttpError(response, `A API retornou o status ${response.status}.`)
}

export async function getAccounts(channel, signal) {
  if (DEMO_MODE) return [{ id: 'demo-account', name: 'Suporte UniFast', numero: '5584999998888', conectado: true }]
  if (window.localStorage.getItem('wpphub.auth.token')) {
    const response = await httpFetch(`/api/accounts?channel=${encodeURIComponent(channel)}`, { signal, headers: { Accept: 'application/json', ...authHeaders() } })
    if (!response.ok) throw await parseError(response)
    const payload = await response.json()
    return Array.isArray(payload?.accounts) ? payload.accounts : []
  }
  const config = configFor(channel)
  if (!config.token && channel !== 'official') throw new Error('Configure VITE_HUB_API_TOKEN com a chave wah_...')
    const response = await httpFetch(`${config.baseUrl}/accounts`, { signal, headers: headers(channel) })
  if (!response.ok) throw await parseError(response)
  const payload = await response.json()
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : []
  return config.accountId
    ? [...accounts].sort((a, b) => Number(String(b.id) === String(config.accountId)) - Number(String(a.id) === String(config.accountId)))
    : accounts
}

export async function getConversations(channel, accountId, signal) {
  if (DEMO_MODE) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    return [{
      id: 'demo-conversation',
      phone: '5584999998888',
      name: 'Maria Oliveira',
      status: 'queued',
      attending: null,
      lastMessage: 'Olá! Gostaria de tirar uma dúvida.',
      lastDirection: 'recebida',
      lastTimestamp: demoMessages.at(-1)?.timestamp ?? new Date().toISOString(),
      unreadCount: 1,
      windowOpen: true,
    }]
  }
  if (!accountId) throw new Error('Nenhuma conta do WhatsApp está disponível para listar conversas.')
  const url = new URL(`${configFor(channel).baseUrl}/conversations`, window.location.origin)
  url.searchParams.set('account_id', accountId)
  const response = await httpFetch(url, {
    method: 'GET',
    signal,
    headers: headers(channel),
  })
  if (!response.ok) throw await parseError(response)
  const payload = await response.json()
  const root = payload?.data ?? payload
  const conversations = Array.isArray(root?.conversations) ? root.conversations : []
  return conversations.map((conversation, index) => ({
    id: String(conversation.id ?? conversation.conversation_id ?? `${accountId}-${conversation.telefone ?? index}`),
    phone: conversation.telefone ?? conversation.phone ?? '',
    name: conversation.nome_whatsapp ?? conversation.name ?? 'Contato',
    status: conversation.status ?? null,
    attending: conversation.atendendo ?? conversation.attending ?? null,
    lastMessage: conversation.ultima_mensagem ?? conversation.last_message ?? '',
    lastDirection: conversation.ultima_direcao ?? conversation.last_direction ?? '',
    lastTimestamp: conversation.ultima_em ?? conversation.last_timestamp ?? null,
    unreadCount: Number(conversation.nao_lidas ?? conversation.unread_count ?? 0),
    windowOpen: conversation.janela_aberta ?? conversation.window_open ?? null,
  }))
}

export async function getConversation(channel, phone, accountId, signal, since = '') {
  const normalizedPhone = normalizeBrazilianPhone(phone)
  if (!/^55\d{10,11}$/.test(normalizedPhone)) {
    throw new Error('Digite um telefone brasileiro válido, com DDD.')
  }

  if (DEMO_MODE) {
    await new Promise((resolve) => setTimeout(resolve, 650))
    return { contact: { name: 'Maria Oliveira', phone: normalizedPhone, avatar: null }, messages: demoMessages }
  }
  if (!accountId) throw new Error('Nenhuma conta do WhatsApp está disponível para a consulta.')
  const url = new URL(
    `${configFor(channel).baseUrl}/conversations/${encodeURIComponent(normalizedPhone)}/messages`,
    window.location.origin,
  )
  url.searchParams.set('account_id', accountId)
  url.searchParams.set('limit', '500')
  if (since) url.searchParams.set('since', since)
  const response = await httpFetch(url, {
    timeout: 20000,
    method: 'GET',
    signal,
    headers: headers(channel),
  })
  if (response.status === 404) {
    const payload = await response.json().catch(() => null)
    if (!payload?.code || payload.code === 'CONVERSA_NAO_ENCONTRADA') return { contact: { name: 'Contato', phone: normalizedPhone }, messages: [] }
    throw await parseError(new Response(JSON.stringify(payload), { status: response.status, headers: { 'Content-Type': 'application/json' } }))
  }
  if (!response.ok) throw await parseError(response)
  return normalizeConversation(await response.json(), normalizedPhone)
}

export async function getAttachment(channel, path, signal) {
  if (!path) throw new Error('A mídia não possui uma URL disponível.')
  const response = await httpFetch(resolveApiUrl(channel, path), {
    timeout: 60000,
    method: 'GET',
    signal,
    headers: headers(channel),
  })
  if (!response.ok) throw await parseError(response)
  return response.blob()
}

export async function sendMessage({ channel, phone, accountId, text, attendant }, signal) {
  const normalizedPhone = normalizeBrazilianPhone(phone)
  const normalizedText = text.trim()
  if (!/^55\d{10,11}$/.test(normalizedPhone)) throw new Error('O telefone da conversa é inválido.')
  if (!accountId) throw new Error('Nenhuma conta do WhatsApp está disponível para o envio.')
  if (!normalizedText) throw new Error('Digite uma mensagem antes de enviar.')
  if (normalizedText.length > 4096) throw new Error('A mensagem pode ter no máximo 4096 caracteres.')

  if (DEMO_MODE) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    return { ok: true, message_id: `demo-${Date.now()}`, evolution_message_id: null }
  }

  const response = await httpFetch(`${configFor(channel).baseUrl}/messages`, {
    retries: 0,
    method: 'POST',
    signal,
    headers: { ...headers(channel), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_id: accountId,
      telefone: normalizedPhone,
      texto: normalizedText,
      ...(attendant?.trim() ? { atendente: attendant.trim() } : {}),
    }),
  })
  if (!response.ok) throw await parseError(response)
  const payload = await response.json()
  recordActivity({ eventType: 'message_sent', channel, accountId })
  return payload
}

export async function sendMedia({ channel, phone, accountId, fileUrl = '', fileBase64 = '', name = '', mime = '', caption = '', attendant = '' }, signal) {
  const normalizedPhone = normalizeBrazilianPhone(phone)
  if (!/^55\d{10,11}$/.test(normalizedPhone)) throw new Error('O telefone da conversa é inválido.')
  if (!accountId) throw new Error('Nenhuma conta do WhatsApp está disponível para o envio.')
  if (!fileUrl && !fileBase64) throw new Error('Selecione um arquivo ou informe uma URL pública.')
  if (channel === 'official' && !fileUrl && !fileBase64) throw new Error('A API Oficial exige arquivo_url ou arquivo_base64.')
  if (channel !== 'official' && !fileUrl) throw new Error('A API Não Oficial exige uma URL pública para enviar mídia.')
  const official = channel === 'official'
  const body = {
    account_id: accountId,
    telefone: normalizedPhone,
    ...(official ? { ...(fileUrl ? { arquivo_url: fileUrl } : { arquivo_base64: fileBase64 }), ...(name ? { nome: name } : {}), ...(mime ? { mime } : {}), ...(caption && !mime.startsWith('audio/') ? { legenda: caption.slice(0, 1024) } : {}) } : { arquivo_url: fileUrl, ...(mime ? { tipo: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document' } : {}), ...(name ? { nome: name } : {}), ...(caption ? { texto: caption.slice(0, 4096) } : {}) }),
    ...(attendant?.trim() ? { atendente: attendant.trim() } : {}),
  }
  const response = await httpFetch(`${configFor(channel).baseUrl}${official ? '/messages/media' : '/messages'}`, { method: 'POST', retries: 0, signal, headers: { ...headers(channel), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw await parseError(response)
  return response.json()
}

export async function getTemplates(accountId, signal) {
  if (!accountId) throw new Error('Nenhuma conta oficial selecionada para carregar os modelos.')
  const url = new URL(`${configFor('official').baseUrl}/templates`, window.location.origin)
  url.searchParams.set('account_id', accountId)
  const response = await httpFetch(url, { signal, headers: headers('official'), timeout: 20000 })
  if (!response.ok) throw await parseError(response)
  const payload = await response.json()
  return (Array.isArray(payload?.modelos) ? payload.modelos : []).filter((template) => Number(template.variaveis || 0) <= 1)
}

export async function sendTemplate({ accountId, phone, name, templateName, title = '', requiresName = true }, signal) {
  const normalizedPhone = normalizeBrazilianPhone(phone)
  const recipientName = String(name || '').trim()
  if (!accountId || !templateName || !/^55\d{10,11}$/.test(normalizedPhone)) throw new Error('Conta, modelo e telefone são obrigatórios para o disparo.')
  if (requiresName && !recipientName) throw new Error('Este modelo exige o nome do contato para ser disparado.')
  const response = await httpFetch(`${configFor('official').baseUrl}/campaigns`, { method: 'POST', retries: 0, signal, headers: { ...headers('official'), 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, modelo: templateName, destinatarios: [{ telefone: normalizedPhone, nome: recipientName }], ...(title.trim() ? { titulo: title.trim() } : {}) }) })
  if (!response.ok) throw await parseError(response)
  return response.json()
}
