import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, Image as ImageIcon, LogOut, MessageCircle, Mic, Paperclip, Send, Settings as SettingsIcon, X } from 'lucide-react'
import AuthScreen from '../../../auth-ui/AuthScreen'
import { httpFetch } from '../../../http'
import { authHeaders, getAuthSession, login, logout, notifySessionExpired, onSessionExpired, recordActivity, registerUser } from '../../../auth'
import { getBitrixDealContext, resizeBitrixWindow } from '../../../bitrix'
import { getAccounts, getAttachment, getConversation, getTemplates, normalizeBrazilianPhone, sendMedia, sendMessage, sendTemplate } from '../../../api'

const CHANNEL_LABELS = { hub: 'WhatsApp Hub', official: 'API Oficial' }

async function getConversationLink(dealId, signal) {
  const response = await httpFetch(`/api/bitrix/deals/${encodeURIComponent(dealId)}/conversation`, { signal, headers: { Accept: 'application/json', ...authHeaders() } })
  if (response.status === 401) notifySessionExpired()
  if (!response.ok) throw new Error('Não foi possível carregar o vínculo da conversa.')
  return (await response.json()).conversation
}

async function saveConversationLink(dealId, payload) {
  const response = await httpFetch(`/api/bitrix/deals/${encodeURIComponent(dealId)}/conversation`, {
    retries: 0,
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (response.status === 401) notifySessionExpired()
  if (!response.ok) throw new Error('A conversa foi enviada, mas o vínculo com o negócio não pôde ser salvo.')
  return (await response.json()).conversation
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function accountLabel(account) {
  return account?.name || account?.nome || account?.numero || account?.phone || `Dispositivo ${account?.id || ''}`
}

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return ''
  const size = Number(bytes)
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 ** 2).toFixed(1)} MB`
}

function MessageAttachment({ attachment, channel }) {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)
  const supported = ['image', 'sticker', 'video', 'audio', 'document'].includes(attachment?.type)
  const AttachmentIcon = attachment?.type === 'audio' ? Mic : attachment?.type === 'document' ? FileText : ImageIcon
  const label = attachment?.type === 'audio' ? 'áudio' : attachment?.type === 'document' ? 'documento' : attachment?.type === 'video' ? 'vídeo' : attachment?.type === 'sticker' ? 'figurinha' : 'imagem'

  useEffect(() => {
    if (!supported || !attachment.url || attachment.ready === false) return undefined
    const controller = new AbortController()
    let objectUrl = ''
    setSource('')
    setFailed(false)
    getAttachment(channel, attachment.url, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSource(objectUrl)
      })
      .catch((err) => { if (err.name !== 'AbortError') setFailed(true) })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment?.ready, attachment?.url, channel, supported])

  if (!supported) return null
  if (attachment.ready === false) return <div className="attachment-state"><AttachmentIcon size={18} />{label.charAt(0).toUpperCase() + label.slice(1)} sendo processad{['imagem', 'figurinha'].includes(label) ? 'a' : 'o'}...</div>
  if (!attachment.url) return <div className="attachment-state error-state"><AttachmentIcon size={18} />{label.charAt(0).toUpperCase() + label.slice(1)} sem URL disponível.</div>
  if (failed) return <div className="attachment-state error-state"><AttachmentIcon size={18} />Não foi possível carregar o {label}.</div>
  if (!source) return <div className="attachment-state"><AttachmentIcon size={18} />Carregando {label}...</div>
  if (attachment.type === 'video') return <figure className="message-attachment message-video">
    <video src={source} controls preload="metadata">Seu navegador não suporta reprodução de vídeo.</video>
    <a href={source} download={attachment.name || 'video.mp4'} aria-label="Baixar vídeo"><Download size={15} />Baixar</a>
  </figure>
  if (attachment.type === 'audio') return <figure className="message-attachment message-audio">
    <div className="audio-label"><Mic size={17} /><span>{attachment.name || 'Mensagem de áudio'}</span></div>
    <audio src={source} controls preload="metadata">Seu navegador não suporta reprodução de áudio.</audio>
    <a href={source} download={attachment.name || 'audio.ogg'} aria-label="Baixar áudio"><Download size={15} />Baixar</a>
  </figure>
  if (attachment.type === 'document') return <figure className="message-attachment message-document">
    <FileText size={30} />
    <figcaption><strong>{attachment.name || 'Documento'}</strong><span>{[formatFileSize(attachment.bytes), attachment.mime].filter(Boolean).join(' · ')}</span></figcaption>
    <a href={source} download={attachment.name || 'documento'} aria-label="Baixar documento"><Download size={16} />Baixar</a>
  </figure>
  return <figure className={`message-attachment ${attachment.type === 'sticker' ? 'message-sticker' : ''}`}>
    <img src={source} alt={attachment.name || 'Imagem enviada na conversa'} loading="lazy" />
    <a href={source} download={attachment.name || 'imagem'} aria-label="Baixar imagem"><Download size={15} />Baixar</a>
  </figure>
}

function mergeMessages(current, incoming) {
  const incomingMessages = [...incoming.messages]
  const reactionMessages = incomingMessages.filter((message) => message.isReaction && message.reactionTargetId)
  const currentWithReactions = current.messages.map((message) => {
    const reaction = reactionMessages.find((item) => item.reactionTargetId === message.id)
    return reaction ? { ...message, reaction: reaction.reaction, reactionId: reaction.id } : message
  })
  const currentMessages = currentWithReactions.filter((message) => {
    if (!message.optimistic) return true
    const matchingIndex = incomingMessages.findIndex((candidate) => candidate.direction === 'outbound' && candidate.text === message.text)
    if (matchingIndex === -1) return true
    incomingMessages.splice(matchingIndex, 1)
    return false
  })
  const messagesById = new Map(currentMessages.map((message) => [message.id, message]))
  incomingMessages.filter((message) => !message.isReaction).forEach((message) => messagesById.set(message.id, message))
  return {
    ...current,
    ...incoming,
    contact: { ...current.contact, ...incoming.contact },
    messages: [...messagesById.values()].sort((first, second) => {
      const firstTime = new Date(first.timestamp).getTime()
      const secondTime = new Date(second.timestamp).getTime()
      if (Number.isNaN(firstTime)) return 1
      if (Number.isNaN(secondTime)) return -1
      return firstTime - secondTime
    }),
  }
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',').pop())
    reader.onerror = () => reject(new Error('Não foi possível preparar o arquivo para envio.'))
    reader.readAsDataURL(file)
  })
}

function LoginScreen({ onLogin }) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const departments = ['Comercial B2C', 'Comercial B2B', 'Secretaria', 'Financeiro', 'Coordenação', 'Administrativo']

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (registering) {
        const result = await registerUser({ name, email, password, passwordConfirmation, department })
        setSuccess(result.message || 'Cadastro enviado para aprovação.')
        setRegistering(false)
        setPassword('')
        setPasswordConfirmation('')
      } else {
        const session = await login(email, password)
        onLogin(session)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return <main className="bitrix-page bitrix-login-page">
    <section className="bitrix-login-panel">
      <span className="bitrix-brand"><MessageCircle size={19} />WppHub</span>
      <h1>{registering ? 'Criar acesso' : 'Acesse suas conversas'}</h1>
      <p>{registering ? 'Seu cadastro será enviado para aprovação do administrador.' : 'Entre para abrir a mensageria deste negócio.'}</p>
      <form onSubmit={handleSubmit} className="bitrix-login-form">
        {registering && <><label htmlFor="bitrix-name">Nome completo</label><input id="bitrix-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></>}
        <label htmlFor="bitrix-email">E-mail</label>
        <input id="bitrix-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        {registering && <><label htmlFor="bitrix-department">Departamento</label><select id="bitrix-department" value={department} onChange={(event) => setDepartment(event.target.value)} required><option value="">Selecione</option>{departments.map((item) => <option key={item}>{item}</option>)}</select></>}
        <label htmlFor="bitrix-password">Senha</label>
        <input id="bitrix-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        {registering && <><small className="bitrix-form-hint">Mínimo de 8 caracteres, com letras e números.</small><label htmlFor="bitrix-password-confirmation">Confirmar senha</label><input id="bitrix-password-confirmation" type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" required /></>}
        {success && <div className="bitrix-form-success">{success}</div>}
        {error && <div className="error" role="alert"><X size={15} />{error}</div>}
        <button type="submit" disabled={loading}>{loading ? 'Aguarde...' : registering ? 'Solicitar cadastro' : 'Entrar'}</button>
      </form>
      <button className="bitrix-mode-toggle" type="button" onClick={() => { setRegistering((value) => !value); setError(''); setSuccess('') }}>{registering ? 'Já tenho acesso' : 'Criar novo acesso'}</button>
    </section>
  </main>
}

function MessageList({ conversation, channel }) {
  const messagesRef = useRef(null)

  useEffect(() => {
    const element = messagesRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [conversation.messages.length])

  return <div className="messages bitrix-messages" ref={messagesRef}>
    {!conversation.messages.length && <div className="empty-state"><div className="empty-icon"><MessageCircle size={28} /></div><h2>Nenhuma mensagem ainda</h2><p>A primeira mensagem enviada criará a conversa neste dispositivo.</p></div>}
    {conversation.messages.map((message) => <div className={`message-row ${message.direction}`} key={message.id}>
      <div className="bubble">
        {message.attachment && <MessageAttachment attachment={message.attachment} channel={channel} />}
        {(message.text || !message.attachment) && <p>{message.text || 'Mensagem sem conteúdo textual'}</p>}
        <span className="meta">{formatTime(message.timestamp)}</span>
        {message.reaction && <span className="message-reaction" title="Reação à mensagem">{message.reaction}</span>}
      </div>
    </div>)}
  </div>
}

export default function BitrixDeal() {
  const [session, setSession] = useState(() => getAuthSession())
  useEffect(() => onSessionExpired(() => setSession(null)), [])
  const [context, setContext] = useState(null)
  const [channels, setChannels] = useState({ hub: [], official: [] })
  const [channel, setChannel] = useState('hub')
  const [accountId, setAccountId] = useState('')
  const [conversation, setConversation] = useState(null)
  const [conversationOptions, setConversationOptions] = useState([])
  const [lockedAccount, setLockedAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaCaption, setMediaCaption] = useState('')
  const [mediaType, setMediaType] = useState('document')
  const [mediaOpen, setMediaOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordedAudio, setRecordedAudio] = useState(null)
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [error, setError] = useState('')
  const [switchingDevice, setSwitchingDevice] = useState(false)
  const [deviceLoading, setDeviceLoading] = useState(false)
  const conversationRef = useRef(null)
  const composerRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])

  const selectedAccount = useMemo(() => channels[channel].find((account) => String(account.id) === String(accountId)) || null, [accountId, channel, channels])
  const activeAccount = switchingDevice ? selectedAccount : lockedAccount || selectedAccount
  const canSwitchDevice = Boolean(lockedAccount && channel === 'official' && conversation?.windowOpen === false)
  const showDeviceSelector = !lockedAccount || switchingDevice

  useEffect(() => { conversationRef.current = conversation }, [conversation])

  useEffect(() => {
    if (loading || channel !== 'official' || conversation?.windowOpen !== false || !activeAccount?.id) {
      setTemplates([])
      setSelectedTemplate('')
      return undefined
    }
    const controller = new AbortController()
    setTemplatesLoading(true)
    getTemplates(activeAccount.id, controller.signal)
      .then((items) => { setTemplates(items); setSelectedTemplate(items[0]?.nome || '') })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setTemplatesLoading(false) })
    return () => controller.abort()
  }, [activeAccount?.id, channel, conversation?.windowOpen, loading])

  useEffect(() => {
    if (!session) return undefined
    resizeBitrixWindow(860).catch(() => {})
    return undefined
  }, [session])

  useEffect(() => {
    if (!session) return undefined
    const controller = new AbortController()
    async function load() {
      try {
        const dealContext = await getBitrixDealContext()
        const channelResults = await Promise.allSettled(['hub', 'official'].map(async (item) => [item, await getAccounts(item, controller.signal)]))
        const available = { hub: [], official: [] }
        channelResults.forEach((result) => {
          if (result.status === 'fulfilled') available[result.value[0]] = result.value[1]
        })
        if (controller.signal.aborted) return
        setContext(dealContext)
        window.sessionStorage.setItem('wpphub.bitrix.deal.context', JSON.stringify(dealContext))
        setChannels(available)
        const phone = normalizeBrazilianPhone(dealContext.phone)
        if (!/^55\d{10,11}$/.test(phone)) throw new Error('O contato do negócio não possui um telefone brasileiro válido.')
        const linked = await getConversationLink(dealContext.dealId, controller.signal)
        const lookups = []
        for (const item of ['hub', 'official']) {
          for (const account of available[item]) lookups.push({ channel: item, account })
        }
        const histories = await Promise.allSettled(lookups.map(async (lookup) => ({ ...lookup, conversation: await getConversation(lookup.channel, phone, lookup.account.id, controller.signal) })))
        const found = histories
          .filter((result) => result.status === 'fulfilled' && result.value.conversation.messages.length)
          .map((result) => result.value)
          .sort((first, second) => new Date(second.conversation.messages.at(-1)?.timestamp).getTime() - new Date(first.conversation.messages.at(-1)?.timestamp).getTime())
        if (found.length || linked) {
          const linkedOption = linked && found.find((item) => item.channel === linked.channel && String(item.account.id) === String(linked.accountId))
          const selected = found[0] || linkedOption || {
            channel: linked.channel,
            account: available[linked.channel]?.find((account) => String(account.id) === String(linked.accountId)),
            conversation: { contact: { name: dealContext.contactName || 'Contato', phone }, messages: [] },
          }
          setConversationOptions(found)
          setConversation(selected.conversation)
          setLockedAccount(selected.account)
          setChannel(selected.channel)
          setAccountId(String(selected.account.id))
          if (!linked || linked.channel !== selected.channel || String(linked.accountId) !== String(selected.account.id)) {
            await saveConversationLink(dealContext.dealId, {
              contactId: dealContext.contactId,
              phone,
              channel: selected.channel,
              accountId: selected.account.id,
            })
          }
        } else {
          setConversationOptions([])
          const firstChannel = available.hub.length ? 'hub' : 'official'
          setChannel(firstChannel)
          setAccountId(String(available[firstChannel][0]?.id || ''))
          setConversation({ contact: { name: dealContext.contactName || 'Contato', phone }, messages: [] })
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [session])

  useEffect(() => {
    if (loading || !context || !conversation || !activeAccount) return undefined
    let refreshing = false
    let refreshController = null

    async function refreshConversation() {
      if (refreshing || document.hidden) return
      const current = conversationRef.current
      if (!current) return
      refreshing = true
      refreshController = new AbortController()
      try {
        const messagesWithTimestamp = current.messages.filter((message) => message.timestamp)
        const since = messagesWithTimestamp.at(-1)?.timestamp || ''
        const incoming = await getConversation(channel, current.contact.phone, activeAccount.id, refreshController.signal, since)
        if (!incoming.messages.length) return
        setConversation((latest) => latest ? mergeMessages(latest, incoming) : latest)
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('Não foi possível atualizar a conversa do Deal.', err)
      } finally {
        refreshing = false
      }
    }

    const intervalId = window.setInterval(refreshConversation, 3000)
    const refreshWhenVisible = () => { if (!document.hidden) refreshConversation() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      refreshController?.abort()
    }
  }, [activeAccount?.id, channel, context?.dealId, conversation?.contact.phone, loading])

  async function handleDeviceChange(nextChannel, nextAccountId) {
    if (!context || !conversation || !nextAccountId) return
    const account = channels[nextChannel].find((item) => String(item.id) === String(nextAccountId))
    if (!account) return
    setChannel(nextChannel)
    setAccountId(String(nextAccountId))
    setDeviceLoading(true)
    setError('')
    try {
      const nextConversation = await getConversation(nextChannel, conversation.contact.phone, account.id, undefined)
      setConversation(nextConversation)
      const hasHistory = nextConversation.messages.length > 0
      setLockedAccount(hasHistory ? account : null)
      setSwitchingDevice(!hasHistory)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeviceLoading(false)
    }
  }

  async function handleConversationChange(event) {
    const option = conversationOptions[Number(event.target.value)]
    if (!option || !context) return
    setDeviceLoading(true)
    setError('')
    try {
      setChannel(option.channel)
      setAccountId(String(option.account.id))
      setConversation(option.conversation)
      setLockedAccount(option.account)
      recordActivity({ eventType: 'conversation_selected', channel: option.channel, accountId: option.account.id, accountName: accountLabel(option.account), bitrixDealId: context.dealId })
      await saveConversationLink(context.dealId, {
        contactId: context.contactId,
        phone: option.conversation.contact.phone,
        channel: option.channel,
        accountId: option.account.id,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setDeviceLoading(false)
    }
  }

  async function handleSend(event) {
    event.preventDefault()
    if (!activeAccount || !conversation || !draft.trim() || sending || deviceLoading) return
    const text = draft.trim()
    setSending(true)
    setError('')
    try {
      const result = await sendMessage({ channel, phone: conversation.contact.phone, accountId: activeAccount.id, text }, undefined)
      await saveConversationLink(context.dealId, {
        contactId: context.contactId,
        phone: conversation.contact.phone,
        channel,
        accountId: activeAccount.id,
        conversationId: result.conversation_id || result.conversationId || null,
      })
      const message = { id: result.message_id || `local-${Date.now()}`, direction: 'outbound', text, timestamp: new Date().toISOString(), status: 'sent', optimistic: true }
      setConversation((current) => ({ ...current, messages: [...current.messages, message] }))
      setLockedAccount(activeAccount)
      setDraft('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
      window.requestAnimationFrame(() => {
        if (composerRef.current && !composerRef.current.disabled) composerRef.current.focus({ preventScroll: true })
      })
    }
  }

  async function handleMediaSend(event) {
    event.preventDefault()
    if (!activeAccount || !conversation || sending || deviceLoading) return
    setSending(true)
    setError('')
    try {
      const file = recordedAudio || mediaFile
      if (file && file.size > 20 * 1024 * 1024) throw new Error('O arquivo não pode ultrapassar 20 MB.')
      const fileBase64 = file ? await fileAsBase64(file) : ''
      const mime = (file?.type || (channel === 'official' ? 'audio/webm' : mediaType)).split(';')[0]
      const result = await sendMedia({ channel, phone: conversation.contact.phone, accountId: activeAccount.id, fileUrl: mediaUrl.trim(), fileBase64, name: file?.name || 'audio.webm', mime, caption: mediaCaption })
      const message = { id: result.message_id || result.wa_message_id || `local-${Date.now()}`, direction: 'outbound', text: mediaCaption, timestamp: new Date().toISOString(), status: 'sent', optimistic: true, attachment: { type: file?.type?.startsWith('image/') ? 'image' : file?.type?.startsWith('video/') ? 'video' : file?.type?.startsWith('audio/') ? 'audio' : 'document', name: file?.name || 'Mídia enviada', mime: file?.type || '', ready: false, url: '' } }
      setConversation((current) => ({ ...current, messages: [...current.messages, message] }))
      setLockedAccount(activeAccount)
      setMediaFile(null); setRecordedAudio(null); setMediaUrl(''); setMediaCaption(''); setMediaType('document'); setMediaOpen(false)
    } catch (err) { setError(err.message) } finally { setSending(false) }
  }

  async function handleTemplateSend(event) {
    event.preventDefault()
    const template = templates.find((item) => item.nome === selectedTemplate)
    if (!template || !context || !activeAccount) return
    setSending(true)
    setError('')
    try {
      const result = await sendTemplate({ accountId: activeAccount.id, phone: conversation.contact.phone, name: context.contactName, templateName: template.nome, requiresName: Number(template.variaveis || 0) === 1, title: `Abertura de conversa - ${context.dealTitle}` }, undefined)
      const firstName = String(context.contactName || '').trim().split(/\s+/)[0]
      const text = String(template.texto || '').replaceAll('{{1}}', firstName)
      setConversation((current) => ({ ...current, windowOpen: true, messages: [...current.messages, { id: result.wa_message_id || `template-${Date.now()}`, direction: 'outbound', text, timestamp: new Date().toISOString(), status: 'sent', optimistic: true }] }))
      setLockedAccount(activeAccount)
      setTemplates([])
      setSelectedTemplate('')
    } catch (err) { setError(err.message) } finally { setSending(false) }
  }

  async function toggleRecording() {
    if (recording) { mediaRecorderRef.current?.stop(); return }
    if (!activeAccount || channel !== 'official') { setMediaOpen(true); setError('A gravação de áudio funciona pela API Oficial. Na API Não Oficial, informe uma URL pública de áudio.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supportedMime = ['audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/webm'].find((mime) => MediaRecorder.isTypeSupported(mime)) || ''
      const recorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : undefined)
      recordingChunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data) }
      recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); const mime = recorder.mimeType || 'audio/webm'; const extension = mime.includes('ogg') ? 'ogg' : 'webm'; setRecordedAudio(new File([new Blob(recordingChunksRef.current, { type: mime })], `audio-gravado.${extension}`, { type: mime })); setRecording(false); setMediaOpen(true) }
      mediaRecorderRef.current = recorder; recorder.start(); setRecording(true); setMediaOpen(true)
    } catch { setError('Não foi possível acessar o microfone.') }
  }

  function handleDraftKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend(event)
    }
  }

  if (!session) return <AuthScreen onLogin={setSession} />
  if (loading) return <main className="bitrix-page"><div className="loader"><span /><p>Carregando negócio e conversa...</p></div></main>
  if (error && !context) return <main className="bitrix-page"><div className="empty-state"><div className="empty-icon"><X size={28} /></div><h2>Não foi possível carregar este Deal</h2><p>{error}</p></div></main>

  return <main className="bitrix-page">
    <header className="bitrix-header">
      <div><span className="eyebrow">Negócio Bitrix24</span><h1>{context?.dealTitle || 'Conversas do negócio'}</h1><p>{context?.contactName || 'Contato'} · {conversation?.contact.phone}</p></div>
      <div className="bitrix-header-actions"><a className="settings-button" href={`/settings?deal_id=${encodeURIComponent(context?.dealId || '')}`} aria-label="Configurações" title="Configurações"><SettingsIcon size={17} /></a><button className="bitrix-logout" type="button" onClick={() => { logout(); setSession(null) }}><LogOut size={15} />Sair</button></div>
    </header>
    <section className="bitrix-conversation">
      <div className="bitrix-conversation-bar">
        <div><strong>{conversationOptions.length > 1 ? 'Conversas encontradas' : showDeviceSelector ? 'Escolha o dispositivo' : 'Dispositivo da conversa'}</strong><span>{activeAccount ? accountLabel(activeAccount) : 'Nenhum dispositivo disponível'}</span></div>
        {conversationOptions.length > 1 && <div className="bitrix-conversation-picker"><label htmlFor="bitrix-conversation-choice">Conversa usada</label><select id="bitrix-conversation-choice" disabled={deviceLoading} value={conversationOptions.findIndex((item) => item.channel === channel && String(item.account.id) === String(accountId))} onChange={handleConversationChange}>{conversationOptions.map((item, index) => <option key={`${item.channel}-${item.account.id}`} value={index}>{CHANNEL_LABELS[item.channel]} · {accountLabel(item.account)}</option>)}</select></div>}
        {!showDeviceSelector && <div className="bitrix-device-status"><small>{CHANNEL_LABELS[channel]} · dispositivo fixado</small>{canSwitchDevice && <button type="button" onClick={() => setSwitchingDevice(true)}>Trocar dispositivo</button>}</div>}
        {showDeviceSelector && <div className="bitrix-selects"><select value={channel} disabled={deviceLoading} onChange={(event) => { const nextChannel = event.target.value; const nextAccountId = String(channels[nextChannel][0]?.id || ''); handleDeviceChange(nextChannel, nextAccountId) }}><option value="hub">WhatsApp Hub</option><option value="official">API Oficial</option></select><select value={accountId} disabled={deviceLoading} onChange={(event) => handleDeviceChange(channel, event.target.value)}><option value="">Selecione o dispositivo</option>{channels[channel].map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select></div>}
      </div>
      <MessageList conversation={conversation || { messages: [] }} channel={channel} />
      {error && <div className="error bitrix-error" role="alert"><X size={15} />{error}</div>}
      <form className="composer bitrix-composer" onSubmit={handleSend}>
        <input ref={fileInputRef} type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => { setMediaFile(event.target.files?.[0] || null); setRecordedAudio(null); setMediaOpen(true) }} />
        {channel === 'official' && conversation?.windowOpen === false && <div className="template-panel"><strong>Janela de 24 horas fechada</strong><p>Envie um modelo aprovado para iniciar uma nova conversa com este contato.</p>{templatesLoading ? <span className="template-loading">Carregando modelos...</span> : templates.length ? <><select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}><option value="">Selecione um modelo</option>{templates.map((template) => <option key={template.nome} value={template.nome}>{template.nome}</option>)}</select><div className="template-preview">{String(templates.find((template) => template.nome === selectedTemplate)?.texto || '').replaceAll('{{1}}', String(context?.contactName || '').trim().split(/\s+/)[0])}</div><button type="button" className="template-send-button" disabled={!selectedTemplate || sending} onClick={handleTemplateSend}>Enviar modelo e iniciar conversa</button></> : <span className="template-loading">Nenhum modelo disparável disponível para esta conta.</span>}</div>}
        {mediaOpen && <div className="media-panel"><div className="media-panel-title"><strong>Enviar mídia</strong><button type="button" onClick={() => setMediaOpen(false)}><X size={15} /></button></div><input value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder={channel === 'official' ? 'URL pública ou selecione um arquivo' : 'URL pública https://...'} /><input value={mediaFile?.name || recordedAudio?.name || ''} readOnly placeholder="Nenhum arquivo local selecionado" />{channel !== 'official' && <select value={mediaType} onChange={(event) => setMediaType(event.target.value)}><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="document">Documento</option></select>}<textarea value={mediaCaption} onChange={(event) => setMediaCaption(event.target.value.slice(0, channel === 'official' ? 1024 : 4096))} placeholder="Legenda (opcional)" rows="2" /><button type="button" className="media-send-button" onClick={handleMediaSend} disabled={sending || (!mediaUrl.trim() && !mediaFile && !recordedAudio)}>Enviar mídia</button><small>{channel === 'official' ? 'API Oficial: arquivo local ou URL pública.' : 'API Não Oficial: informe uma URL pública https.'}</small></div>}
        <div className="composer-row"><button type="button" className={`media-action ${recording ? 'recording' : ''}`} onClick={() => recording ? toggleRecording() : fileInputRef.current?.click()} disabled={!activeAccount || sending || conversation?.windowOpen === false} aria-label="Selecionar arquivo"><Paperclip size={18} /></button><button type="button" className={`media-action ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={!activeAccount || sending || conversation?.windowOpen === false} aria-label="Gravar áudio"><Mic size={18} /></button><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 4096))} onKeyDown={handleDraftKeyDown} placeholder={recording ? 'Gravando áudio...' : conversation?.windowOpen === false ? 'Envie um modelo para reabrir a conversa' : activeAccount ? 'Digite sua mensagem...' : 'Selecione um dispositivo para iniciar'} rows="2" disabled={!activeAccount || sending || recording || conversation?.windowOpen === false} /><span className="char-count">{draft.length}/4096</span><button type="submit" disabled={!activeAccount || !draft.trim() || sending || conversation?.windowOpen === false} aria-label="Enviar mensagem"><Send size={19} /></button></div>
        <span className="send-hint">A primeira mensagem cria a conversa no dispositivo selecionado.</span>
      </form>
    </section>
  </main>
}
