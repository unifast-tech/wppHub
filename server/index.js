import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import ffmpegPath from 'ffmpeg-static'

const app = express()
const ADMIN_EMAIL = 'admin@unifast.com.br'
const DEPARTMENTS = ['Comercial B2C', 'Comercial B2B', 'Secretaria', 'Financeiro', 'Coordenação', 'Administrativo']
const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const frontendDirectory = path.resolve(serverDirectory, '..', 'dist')
dotenv.config({ path: path.join(serverDirectory, '.env') })
const port = Number(process.env.PORT || 3001)
const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) throw new Error('JWT_SECRET é obrigatório.')

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório.')
const sql = neon(process.env.DATABASE_URL)
const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
const schemaStatements = schema
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean)
for (const statement of schemaStatements) await sql.query(statement)

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
  await sql`
    INSERT INTO users (email, password_hash, name)
    VALUES (${process.env.ADMIN_EMAIL.toLowerCase()}, ${passwordHash}, ${process.env.ADMIN_NAME || 'Administrador'})
    ON CONFLICT (email) DO NOTHING
  `
  await sql`UPDATE users SET role = 'admin', status = 'approved' WHERE lower(email) = ${ADMIN_EMAIL}`
}

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) || true }))
// A API Oficial aceita arquivos de até 20 MB em Base64. Como Base64 aumenta
// o tamanho do conteúdo em aproximadamente 33%, o proxy precisa aceitar um
// corpo JSON maior para conseguir encaminhar esses arquivos.
app.use(express.json({ limit: '30mb' }))
app.use(express.urlencoded({ extended: true, limit: '32kb' }))

async function convertAudioToOgg(body) {
  const mime = String(body?.mime || '').toLowerCase()
  const encoded = String(body?.arquivo_base64 || '')
  if (!mime.startsWith('audio/') || mime.startsWith('audio/ogg') || !encoded) return body
  if (!ffmpegPath) throw new Error('Conversor de áudio indisponível no servidor.')

  const base64 = encoded.replace(/^data:[^;]+;base64,/, '')
  const input = Buffer.from(base64, 'base64')
  if (!input.length) throw new Error('O áudio gravado está vazio ou inválido.')
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wpphub-audio-'))
  const inputPath = path.join(temporaryDirectory, 'input-audio')
  const outputPath = path.join(temporaryDirectory, 'output.ogg')
  try {
    await writeFile(inputPath, input)
    await new Promise((resolve, reject) => {
      const process = spawn(ffmpegPath, ['-y', '-i', inputPath, '-vn', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', outputPath])
      let errorOutput = ''
      process.stderr.on('data', (chunk) => { errorOutput += String(chunk) })
      process.on('error', reject)
      process.on('close', (code) => code === 0 ? resolve() : reject(new Error(errorOutput.slice(-500) || 'Falha ao converter o áudio.')))
    })
    const converted = await readFile(outputPath)
    return { ...body, arquivo_base64: converted.toString('base64'), mime: 'audio/ogg', nome: String(body.nome || 'audio-gravado').replace(/\.[^.]+$/, '') + '.ogg' }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

app.use('/official-api', async (request, response) => {
  const upstream = (process.env.OFFICIAL_API_UPSTREAM_URL || 'https://whatsapp-modelos.andre-51e.workers.dev').replace(/\/$/, '')
  const target = new URL(`${upstream}/api/v1${request.path || '/'}`)
  Object.entries(request.query).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => target.searchParams.append(key, item))
    else if (value != null) target.searchParams.set(key, value)
  })
  const headers = { Accept: request.get('accept') || 'application/json' }
  const token = process.env.OFFICIAL_API_TOKEN || process.env.VITE_OFFICIAL_API_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  if (request.get('content-type')) headers['Content-Type'] = request.get('content-type')
  let body = request.body
  try {
    if (request.path === '/messages/media') body = await convertAudioToOgg(body)
  } catch (error) {
    return response.status(422).json({ error: error.message })
  }
  const upstreamResponse = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(body),
  })
  response.status(upstreamResponse.status)
  const contentType = upstreamResponse.headers.get('content-type')
  if (contentType) response.set('Content-Type', contentType)
  response.send(Buffer.from(await upstreamResponse.arrayBuffer()))
})

function issueToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email, name: user.name, role: user.role, department: user.department }, jwtSecret, { expiresIn: '8h' })
}

function requireAuth(request, response, next) {
  const authorization = request.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return response.status(401).json({ error: 'Autenticação necessária.' })
  try {
    request.user = jwt.verify(token, jwtSecret)
    return next()
  } catch {
    return response.status(401).json({ error: 'Sessão inválida ou expirada.' })
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin' || request.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return response.status(403).json({ error: 'Acesso restrito ao administrador.' })
  }
  return next()
}

function requireActivityAccess(request, response, next) {
  if (request.user?.role !== 'admin' && request.user?.department !== 'Coordenação') {
    return response.status(403).json({ error: 'Acesso restrito ao painel de atividade.' })
  }
  return next()
}

async function logActivity(request, event) {
  try {
    await sql`
      INSERT INTO activity_logs
        (actor_user_id, actor_name, actor_email, event_type, category, severity, channel,
         account_id, account_name, bitrix_deal_id, conversation_id, target_user_id,
         metadata, ip_address, user_agent)
      VALUES
        (${request.user?.sub || null}, ${request.user?.name || null}, ${request.user?.email || null},
         ${event.eventType}, ${event.category}, ${event.severity || 'info'}, ${event.channel || null},
         ${event.accountId || null}, ${event.accountName || null}, ${event.bitrixDealId || null},
         ${event.conversationId || null}, ${event.targetUserId || null}, ${JSON.stringify(event.metadata || {})}::jsonb,
         ${request.ip || null}, ${request.get('user-agent') || null})
    `
  } catch (error) {
    console.error('Falha ao registrar atividade:', error.message)
  }
}

function validCompanyEmail(email) {
  return /^[^\s@]+@unifast\.com\.br$/i.test(email)
}

function validPassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, department: user.department, status: user.status, role: user.role, active: user.active }
}

function isGlobalUser(user) {
  return user?.role === 'admin' || ['Coordenação', 'Administrativo'].includes(user?.department)
}

async function fetchChannelAccounts(channel) {
  const isOfficial = channel === 'official'
  const baseUrl = (isOfficial ? process.env.OFFICIAL_API_UPSTREAM_URL : process.env.HUB_API_BASE_URL || process.env.VITE_HUB_API_BASE_URL || 'https://whatsapp.prosperargroup.com.br/api/v1').replace(/\/$/, '')
  const url = `${baseUrl}${isOfficial ? '/api/v1' : ''}/accounts`
  const token = isOfficial ? process.env.OFFICIAL_API_TOKEN || process.env.VITE_OFFICIAL_API_TOKEN : process.env.HUB_API_TOKEN || process.env.VITE_HUB_API_TOKEN
  const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const upstreamResponse = await fetch(url, { headers })
  if (!upstreamResponse.ok) throw new Error(`Não foi possível carregar contas do canal ${channel}.`)
  const payload = await upstreamResponse.json()
  return Array.isArray(payload?.accounts) ? payload.accounts : []
}

async function allowedAccounts(user, channel) {
  const accounts = await fetchChannelAccounts(channel)
  if (isGlobalUser(user)) return accounts
  const mappings = await sql`SELECT account_id FROM account_departments WHERE channel = ${channel} AND department = ${user.department}`
  const allowed = new Set(mappings.map((mapping) => String(mapping.account_id)))
  return accounts.filter((account) => allowed.has(String(account.id)))
}

app.post('/api/auth/login', async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase()
  const password = String(request.body?.password || '')
  if (!email || !password) return response.status(400).json({ error: 'E-mail e senha são obrigatórios.' })
  const result = await sql`
    SELECT id, email, name, department, status, role, password_hash, active
    FROM users
    WHERE email = ${email}
  `
  const user = result[0]
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    await logActivity({ ...request, user: null }, { eventType: 'login_failed', category: 'auth', severity: 'warning', metadata: { email_masked: email.replace(/^(.{2}).*(@.*)$/, '$1***$2') } })
    return response.status(401).json({ error: 'E-mail ou senha inválidos.' })
  }
  if (user.status !== 'approved') return response.status(403).json({ error: user.status === 'pending' ? 'Seu cadastro ainda aguarda aprovação do administrador.' : 'Seu cadastro não está aprovado.' })
  await logActivity({ ...request, user: { sub: user.id, name: user.name, email: user.email } }, { eventType: 'login_success', category: 'auth', severity: 'success' })
  return response.json({ token: issueToken(user), user: publicUser(user) })
})

app.post('/api/auth/register', async (request, response) => {
  const name = String(request.body?.name || '').trim()
  const email = String(request.body?.email || '').trim().toLowerCase()
  const password = String(request.body?.password || '')
  const confirmation = String(request.body?.passwordConfirmation || '')
  const department = String(request.body?.department || '').trim()
  if (!name || !email || !password || !confirmation || !department) return response.status(400).json({ error: 'Preencha todos os campos.' })
  if (!validCompanyEmail(email)) return response.status(400).json({ error: 'Use um e-mail com domínio @unifast.com.br.' })
  if (!DEPARTMENTS.includes(department)) return response.status(400).json({ error: 'Selecione um departamento válido.' })
  if (!validPassword(password)) return response.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres, com letras e números.' })
  if (password !== confirmation) return response.status(400).json({ error: 'As senhas não conferem.' })
  const existing = await sql`SELECT id FROM users WHERE lower(email) = ${email}`
  if (existing.length) return response.status(409).json({ error: 'Este e-mail já foi cadastrado.' })
  const passwordHash = await bcrypt.hash(password, 12)
  const result = await sql`
    INSERT INTO users (email, password_hash, name, department, status, role, active)
    VALUES (${email}, ${passwordHash}, ${name}, ${department}, 'pending', 'user', true)
    RETURNING id, email, name, department, status, role, active
  `
  return response.status(201).json({ user: publicUser(result[0]), message: 'Cadastro enviado para aprovação.' })
})

app.get('/api/accounts', requireAuth, async (request, response) => {
  const channel = String(request.query.channel || 'hub')
  if (!['hub', 'official'].includes(channel)) return response.status(400).json({ error: 'Canal inválido.' })
  try { return response.json({ accounts: await allowedAccounts(request.user, channel) }) } catch (error) { return response.status(502).json({ error: error.message }) }
})

app.get('/api/admin/users', requireAuth, requireAdmin, async (_request, response) => {
  const result = await sql`SELECT id, email, name, department, status, role, active, created_at FROM users ORDER BY created_at DESC`
  return response.json({ users: result.map(publicUser) })
})

app.get('/api/admin/activity', requireAuth, requireActivityAccess, async (request, response) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 200)
  const result = await sql`
    SELECT id, created_at AS "createdAt", actor_name AS "actorName", actor_email AS "actorEmail",
           event_type AS "eventType", category, severity, channel, account_id AS "accountId",
           account_name AS "accountName", bitrix_deal_id AS "bitrixDealId",
           conversation_id AS "conversationId", metadata
    FROM activity_logs
    WHERE created_at >= NOW() - INTERVAL '180 days'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `
  return response.json({ activities: result })
})

app.post('/api/activity', requireAuth, async (request, response) => {
  const allowed = ['conversation_opened', 'conversation_selected', 'message_sent', 'message_send_failed', 'session_expired', 'logout']
  const eventType = String(request.body?.eventType || '')
  if (!allowed.includes(eventType)) return response.status(400).json({ error: 'Evento de atividade inválido.' })
  await logActivity(request, {
    eventType,
    category: ['message_sent', 'message_send_failed'].includes(eventType) ? 'message' : 'conversation',
    severity: eventType.includes('failed') || eventType === 'session_expired' ? 'warning' : 'info',
    channel: request.body?.channel,
    accountId: request.body?.accountId,
    accountName: request.body?.accountName,
    bitrixDealId: request.body?.bitrixDealId,
    conversationId: request.body?.conversationId,
    metadata: request.body?.metadata || {},
  })
  return response.status(204).end()
})

app.get('/api/admin/account-departments', requireAuth, requireAdmin, async (_request, response) => {
  const [hub, official, mappings] = await Promise.all([
    fetchChannelAccounts('hub'),
    fetchChannelAccounts('official'),
    sql`SELECT channel, account_id AS "accountId", account_name AS "accountName", department FROM account_departments ORDER BY department, channel, account_name`,
  ])
  return response.json({ accounts: { hub, official }, mappings })
})

app.put('/api/admin/account-departments', requireAuth, requireAdmin, async (request, response) => {
  const channel = String(request.body?.channel || '')
  const accountId = String(request.body?.accountId || '')
  const accountName = String(request.body?.accountName || '')
  const department = String(request.body?.department || '')
  if (!['hub', 'official'].includes(channel) || !accountId || !DEPARTMENTS.includes(department)) return response.status(400).json({ error: 'Canal, conta e setor são obrigatórios.' })
  const result = await sql`
    INSERT INTO account_departments (channel, account_id, account_name, department)
    VALUES (${channel}, ${accountId}, ${accountName}, ${department})
    ON CONFLICT (channel, account_id) DO UPDATE SET account_name = EXCLUDED.account_name, department = EXCLUDED.department, updated_at = NOW()
    RETURNING channel, account_id AS "accountId", account_name AS "accountName", department
  `
  await logActivity(request, { eventType: 'account_department_assigned', category: 'admin', severity: 'success', channel, accountId, accountName, metadata: { department } })
  return response.json({ mapping: result[0] })
})

app.delete('/api/admin/account-departments/:channel/:accountId', requireAuth, requireAdmin, async (request, response) => {
  await sql`DELETE FROM account_departments WHERE channel = ${request.params.channel} AND account_id = ${request.params.accountId}`
  await logActivity(request, { eventType: 'account_department_removed', category: 'admin', severity: 'warning', channel: request.params.channel, accountId: request.params.accountId })
  return response.status(204).end()
})

app.patch('/api/admin/users/:userId', requireAuth, requireAdmin, async (request, response) => {
  const userId = Number(request.params.userId)
  const status = request.body?.status ? String(request.body.status) : null
  const department = request.body?.department ? String(request.body.department) : null
  const active = typeof request.body?.active === 'boolean' ? request.body.active : null
  if (!Number.isInteger(userId) || (!['pending', 'approved', 'rejected'].includes(status) && !DEPARTMENTS.includes(department || '') && active === null)) return response.status(400).json({ error: 'Alteração de usuário inválida.' })
  const result = await sql`
    UPDATE users SET
      status = COALESCE(${status}, status),
      department = COALESCE(${department}, department),
      active = COALESCE(${active}, active),
      updated_at = NOW()
    WHERE id = ${userId}
    RETURNING id, email, name, department, status, role, active
  `
  if (!result[0]) return response.status(404).json({ error: 'Usuário não encontrado.' })
  await logActivity(request, { eventType: status ? `user_status_${status}` : 'user_access_changed', category: 'admin', severity: 'success', targetUserId: userId, metadata: { status, department, active } })
  return response.json({ user: publicUser(result[0]) })
})

app.post('/api/admin/users/:userId/reset-password', requireAuth, requireAdmin, async (request, response) => {
  const userId = Number(request.params.userId)
  if (!Number.isInteger(userId)) return response.status(400).json({ error: 'Usuário inválido.' })
  const temporaryPassword = `${randomBytes(5).toString('hex')}A1`
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const result = await sql`
    UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW()
    WHERE id = ${userId} AND lower(email) <> ${ADMIN_EMAIL}
    RETURNING id, email
  `
  if (!result[0]) return response.status(404).json({ error: 'Usuário não encontrado ou não pode ser alterado.' })
  return response.json({ email: result[0].email, temporaryPassword })
})

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, async (request, response) => {
  const userId = Number(request.params.userId)
  if (!Number.isInteger(userId)) return response.status(400).json({ error: 'Usuário inválido.' })
  await sql`DELETE FROM users WHERE id = ${userId} AND lower(email) <> ${ADMIN_EMAIL}`
  return response.status(204).end()
})

app.get('/api/bitrix/deals/:dealId/conversation', requireAuth, async (request, response) => {
  const portal = String(request.query.portal || 'unifast.bitrix24.com.br')
  const result = await sql`
    SELECT bitrix_deal_id AS "dealId", bitrix_contact_id AS "contactId", conversation_id AS "conversationId",
           phone, channel, account_id AS "accountId"
    FROM bitrix_conversations
    WHERE bitrix_portal = ${portal} AND bitrix_deal_id = ${request.params.dealId}
  `
  return response.json({ conversation: result[0] || null })
})

app.put('/api/bitrix/deals/:dealId/conversation', requireAuth, async (request, response) => {
  const portal = String(request.body?.portal || 'unifast.bitrix24.com.br')
  const contactId = String(request.body?.contactId || '')
  const phone = String(request.body?.phone || '')
  const channel = String(request.body?.channel || '')
  const accountId = String(request.body?.accountId || '')
  const conversationId = request.body?.conversationId ? String(request.body.conversationId) : null
  if (!contactId || !phone || !channel || !accountId) {
    return response.status(400).json({ error: 'contactId, phone, channel e accountId são obrigatórios.' })
  }
  const result = await sql`
    INSERT INTO bitrix_conversations
      (bitrix_portal, bitrix_deal_id, bitrix_contact_id, conversation_id, phone, channel, account_id, created_by)
    VALUES (${portal}, ${request.params.dealId}, ${contactId}, ${conversationId}, ${phone}, ${channel}, ${accountId}, ${request.user.sub})
    ON CONFLICT (bitrix_portal, bitrix_deal_id) DO UPDATE SET
      bitrix_contact_id = EXCLUDED.bitrix_contact_id,
      conversation_id = COALESCE(EXCLUDED.conversation_id, bitrix_conversations.conversation_id),
      phone = EXCLUDED.phone,
      channel = EXCLUDED.channel,
      account_id = EXCLUDED.account_id,
      updated_at = NOW()
    RETURNING bitrix_deal_id AS "dealId", bitrix_contact_id AS "contactId", conversation_id AS "conversationId",
              phone, channel, account_id AS "accountId"
  `
  await logActivity(request, { eventType: 'conversation_linked_to_bitrix', category: 'conversation', severity: 'success', channel, accountId, bitrixDealId: request.params.dealId, conversationId, metadata: { phone_masked: `${phone.slice(0, 3)}******${phone.slice(-2)}` } })
  return response.json({ conversation: result[0] })
})

app.get('/health', (_request, response) => response.json({ ok: true }))

app.use(express.static(frontendDirectory))
async function sendFrontendWithBitrixContext(request, response) {
  const html = await readFile(path.join(frontendDirectory, 'index.html'), 'utf8')
  const context = JSON.stringify(request.body || {}).replace(/</g, '\\u003c')
  const bootstrap = `<script>window.__BITRIX_PLACEMENT_CONTEXT__=${context}</script>`
  response.type('html').send(html.replace('</head>', `${bootstrap}</head>`))
}

app.post('/integrations/bitrix/deal', sendFrontendWithBitrixContext)
app.post('/integrations/bitrix/install', async (_request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'))
})
app.get(/^(?!\/api(?:\/|$)|\/health$).*/, (_request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'))
})

app.listen(port, () => console.log(`WppHub backend ouvindo em http://localhost:${port}`))
