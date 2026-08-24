import { Fragment, useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronDown, Download, FileText, Image as ImageIcon, Inbox, Layers3, MessageCircle, Mic, Phone, RefreshCw, Search, Send, Settings as SettingsIcon, UserRound, Wifi, X } from 'lucide-react'
import AuthScreen from './auth-ui/AuthScreen'
import MessageAttachmentView from './components/MessageAttachment'
import ConversationMessagesView from './components/ConversationMessages'
import StudentSearchForm from './components/StudentSearchForm'
import ConversationCard from './components/ConversationCard'
import { getAuthSession, logout, onSessionExpired } from './auth'
import { ATTENDANT_NAME, cleanPhone, getAccounts, getAttachment, getConversation, getConversations, normalizeBrazilianPhone, sendMessage } from './api'

function formatPhone(value) {
  const digits = cleanPhone(value).slice(0, 13)
  const local = digits.startsWith('55') ? digits.slice(2) : digits
  const country = digits.startsWith('55') ? '+55 ' : ''
  if (local.length <= 2) return country + local
  const ddd = local.slice(0, 2)
  const number = local.slice(2)
  if (!number) return `${country}(${ddd}`
  const split = number.length > 8 ? 5 : 4
  return `${country}(${ddd}) ${number.slice(0, split)}${number.length > split ? `-${number.slice(split)}` : ''}`
}

function formatContactPhone(value) {
  return formatPhone(normalizeBrazilianPhone(String(value || '')))
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function StatusIcon({ status }) {
  return ['read', 'seen'].includes(String(status).toLowerCase())
    ? <CheckCheck size={15} aria-label="Lida" />
    : ['delivered'].includes(String(status).toLowerCase())
      ? <CheckCheck size={15} aria-label="Entregue" />
      : <Check size={15} aria-label="Enviada" />
}

function EmptyState({ searched }) {
  return <div className="empty-state">
    <div className="empty-icon"><MessageCircle size={32} /></div>
    <h2>{searched ? 'Nenhuma mensagem encontrada' : 'Consulte uma conversa'}</h2>
    <p>{searched ? 'Não há mensagens vinculadas a este número.' : 'Digite o telefone com DDD para visualizar o histórico de mensagens.'}</p>
  </div>
}

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return ''
  const size = Number(bytes)
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 ** 2).toFixed(1)} MB`
}

function LegacyMessageAttachment({ attachment, channel }) {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)
  const supported = ['image', 'sticker', 'video', 'audio', 'document'].includes(attachment?.type)
  const AttachmentIcon = attachment?.type === 'audio' ? Mic : attachment?.type === 'document' ? FileText : ImageIcon
  const label = attachment?.type === 'audio' ? 'áudio' : attachment?.type === 'document' ? 'documento' : attachment?.type === 'video' ? 'vídeo' : attachment?.type === 'sticker' ? 'figurinha' : 'imagem'
  const capitalizedLabel = `${label.charAt(0).toUpperCase()}${label.slice(1)}`

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
  if (attachment.ready === false) return <div className="attachment-state"><AttachmentIcon size={18} />{capitalizedLabel} sendo processad{['imagem', 'figurinha'].includes(label) ? 'a' : 'o'}...</div>
  if (!attachment.url) return <div className="attachment-state error-state"><AttachmentIcon size={18} />{capitalizedLabel} sem URL disponível.</div>
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
    <figcaption>
      <strong>{attachment.name || 'Documento'}</strong>
      <span>{[formatFileSize(attachment.bytes), attachment.mime].filter(Boolean).join(' · ')}</span>
    </figcaption>
    <a href={source} download={attachment.name || 'documento'} aria-label="Baixar documento"><Download size={16} />Baixar</a>
  </figure>
  return <figure className={`message-attachment ${attachment.type === 'sticker' ? 'message-sticker' : ''}`}>
    <img src={source} alt={attachment.name || 'Imagem enviada na conversa'} loading="lazy" />
    <a href={source} download={attachment.name || 'imagem'} aria-label="Baixar imagem"><Download size={15} />Baixar</a>
  </figure>
}

function mergeConversation(current, incoming) {
  if (!current) return incoming
  const unmatchedIncoming = [...incoming.messages]
  const reactionMessages = unmatchedIncoming.filter((message) => message.isReaction && message.reactionTargetId)
  const currentWithReactions = current.messages.map((message) => {
    const reaction = reactionMessages.find((item) => item.reactionTargetId === message.id)
    return reaction ? { ...message, reaction: reaction.reaction, reactionId: reaction.id } : message
  })
  const currentMessages = currentWithReactions.filter((message) => {
    if (!message.optimistic) return true
    const matchingIndex = unmatchedIncoming.findIndex((candidate) => (
      candidate.direction === 'outbound' && candidate.text === message.text
    ))
    if (matchingIndex === -1) return true
    unmatchedIncoming.splice(matchingIndex, 1)
    return false
  })
  const messagesById = new Map(currentMessages.map((message) => [message.id, message]))
  incoming.messages.filter((message) => !message.isReaction).forEach((message) => messagesById.set(message.id, message))
  const messages = [...messagesById.values()].sort((a, b) => {
    const first = new Date(a.timestamp).getTime()
    const second = new Date(b.timestamp).getTime()
    if (Number.isNaN(first) && Number.isNaN(second)) return 0
    if (Number.isNaN(first)) return 1
    if (Number.isNaN(second)) return -1
    return first - second
  })
  const incomingName = incoming.contact?.name
  return {
    ...current,
    ...incoming,
    contact: {
      ...current.contact,
      ...incoming.contact,
      name: !incomingName || incomingName === 'Contato' ? current.contact.name : incomingName,
    },
    messages,
    windowOpen: incoming.windowOpen ?? current.windowOpen,
  }
}

function threadActivity(thread) {
  return thread.conversation.messages.reduce((latest, message) => {
    const timestamp = new Date(message.timestamp).getTime()
    return Number.isNaN(timestamp) ? latest : Math.max(latest, timestamp)
  }, 0)
}

function formatDateLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sem data'
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const key = date.toDateString()
  if (key === today.toDateString()) return 'Hoje'
  if (key === yesterday.toDateString()) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function messagePreview(message) {
  if (message?.attachment?.type === 'image') return '🖼️ Imagem'
  if (message?.attachment?.type === 'audio') return '🎤 Áudio'
  if (message?.attachment?.type === 'document') return `📄 ${message.attachment.name || 'Documento'}`
  return message?.text || 'Mensagem sem conteúdo textual'
}

function LinkifiedText({ text }) {
  if (!text) return null
  const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi)
  return parts.map((part, index) => {
    if (!/^(?:https?:\/\/|www\.)/i.test(part)) return <Fragment key={`${index}-${part}`}>{part}</Fragment>
    const trailingPunctuation = part.match(/[),.;!?]+$/)?.[0] || ''
    const visibleUrl = trailingPunctuation ? part.slice(0, -trailingPunctuation.length) : part
    const href = /^www\./i.test(visibleUrl) ? `https://${visibleUrl}` : visibleUrl
    return <Fragment key={`${index}-${part}`}>
      <a className="message-link" href={href} target="_blank" rel="noopener noreferrer">{visibleUrl}</a>
      {trailingPunctuation}
    </Fragment>
  })
}

function LegacyConversationMessages({ thread, messagesRef }) {
  const messages = thread.conversation.messages
  return <div className="messages thread-messages" ref={messagesRef}>
    {messages.map((message, index) => {
      const currentDay = formatDateLabel(message.timestamp)
      const previousDay = index ? formatDateLabel(messages[index - 1].timestamp) : ''
      return <Fragment key={message.id}>
        {currentDay !== previousDay && <div className="date-chip">{currentDay}</div>}
        <div className={`message-row ${message.direction}`}>
          <div className="bubble">
            {message.attachment && <MessageAttachmentView attachment={message.attachment} channel={thread.channel} />}
            <p><LinkifiedText text={message.text || (message.attachment ? '' : 'Mensagem sem conteúdo textual')} /></p>
            <span className="meta">{formatTime(message.timestamp)}{message.direction === 'outbound' && <StatusIcon status={message.status} />}</span>
            {message.reaction && <span className="message-reaction" title="Reação à mensagem">{message.reaction}</span>}
          </div>
        </div>
      </Fragment>
    })}
  </div>
}

const conversationStatus = {
  queued: 'Na fila',
  in_service: 'Em atendimento',
  closed: 'Encerrada',
}

function safeTimestamp(value) {
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export default function App() {
  const [session, setSession] = useState(() => getAuthSession())
  useEffect(() => onSessionExpired(() => setSession(null)), [])
  const [activeView, setActiveView] = useState('student')
  const [phone, setPhone] = useState('')
  const [threads, setThreads] = useState([])
  const [expandedThreadId, setExpandedThreadId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [partialErrors, setPartialErrors] = useState([])
  const [searched, setSearched] = useState(false)
  const [searchStats, setSearchStats] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [sendingThreadId, setSendingThreadId] = useState('')
  const [sendErrors, setSendErrors] = useState({})
  const [inboxItems, setInboxItems] = useState([])
  const [inboxLoading, setInboxLoading] = useState(false)
  const [inboxError, setInboxError] = useState('')
  const [inboxPartialErrors, setInboxPartialErrors] = useState([])
  const [inboxReloadKey, setInboxReloadKey] = useState(0)
  const [selectedInboxId, setSelectedInboxId] = useState('')
  const [inboxThread, setInboxThread] = useState(null)
  const [inboxThreadLoading, setInboxThreadLoading] = useState(false)
  const [inboxDraft, setInboxDraft] = useState('')
  const [inboxSending, setInboxSending] = useState(false)
  const [inboxSendError, setInboxSendError] = useState('')
  const controllerRef = useRef(null)
  const inboxControllerRef = useRef(null)
  const messagesRef = useRef(null)
  const inboxMessagesRef = useRef(null)
  const threadsRef = useRef([])
  const inboxThreadRef = useRef(null)
  const readInboxIdsRef = useRef(new Set())
  const composerRef = useRef(null)
  const inboxComposerRef = useRef(null)
  const expandedThread = threads.find((thread) => thread.id === expandedThreadId) || null
  const selectedInboxItem = inboxItems.find((item) => item.id === selectedInboxId) || null

  useEffect(() => {
    const messagesElement = messagesRef.current
    if (messagesElement) messagesElement.scrollTo({ top: messagesElement.scrollHeight, behavior: 'smooth' })
  }, [expandedThreadId, expandedThread?.conversation.messages.length])
  useEffect(() => { threadsRef.current = threads }, [threads])
  useEffect(() => {
    const messagesElement = inboxMessagesRef.current
    if (messagesElement) messagesElement.scrollTo({ top: messagesElement.scrollHeight, behavior: 'smooth' })
  }, [selectedInboxId, inboxThread?.conversation.messages.length])
  useEffect(() => { inboxThreadRef.current = inboxThread }, [inboxThread])
  useEffect(() => {
    if (!selectedInboxId) return
    readInboxIdsRef.current.add(selectedInboxId)
    setInboxItems((items) => items.map((item) => (
      item.id === selectedInboxId && item.unreadCount > 0
        ? { ...item, unreadCount: 0 }
        : item
    )))
  }, [selectedInboxId])
  useEffect(() => () => {
    controllerRef.current?.abort()
    inboxControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!expandedThread) return undefined
    const { channel, account, conversation } = expandedThread

    let refreshing = false
    let refreshController = null
    const refreshConversation = async () => {
      if (refreshing || document.hidden) return
      refreshing = true
      refreshController = new AbortController()
      try {
        const currentThread = threadsRef.current.find((thread) => thread.id === expandedThreadId)
        if (!currentThread) return
        const messagesWithTimestamp = currentThread.conversation.messages.filter((message) => message.timestamp)
        const since = messagesWithTimestamp.at(-1)?.timestamp || ''
        const incoming = await getConversation(channel, conversation.contact.phone, account.id, refreshController.signal, since)
        setThreads((current) => current.map((thread) => thread.id === expandedThreadId
          ? { ...thread, conversation: mergeConversation(thread.conversation, incoming) }
          : thread))
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('Não foi possível atualizar a conversa automaticamente.', err)
      } finally {
        refreshing = false
      }
    }

    const intervalId = window.setInterval(refreshConversation, 5000)
    const refreshWhenVisible = () => { if (!document.hidden) refreshConversation() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshConversation)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshConversation)
      refreshController?.abort()
    }
  }, [expandedThreadId, expandedThread?.account.id, expandedThread?.channel, expandedThread?.conversation.contact.phone])

  useEffect(() => {
    if (activeView !== 'inbox') return undefined
    inboxControllerRef.current?.abort()
    const controller = new AbortController()
    inboxControllerRef.current = controller
    setInboxLoading(true)
    setInboxError('')
    setInboxPartialErrors([])

    async function loadInbox() {
      try {
        const accountGroups = await Promise.all(['hub', 'official'].map(async (channel) => ({ channel, accounts: await getAccounts(channel, controller.signal) })))
        const accountLookups = accountGroups.flatMap(({ channel, accounts }) => accounts.map((account) => ({ channel, account })))
        const results = await Promise.allSettled(accountLookups.map(async ({ channel, account }) => ({
          channel,
          account,
          conversations: await getConversations(channel, account.id, controller.signal),
        })))
        if (controller.signal.aborted) return

        const failures = []
        const items = []
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            if (result.reason?.name !== 'AbortError') failures.push(`${accountLookups[index]?.account.name || 'Conta'}: ${result.reason?.message || 'falha ao listar conversas'}`)
            return
          }
          result.value.conversations.forEach((conversation) => {
            const id = `${result.value.channel}:${result.value.account.id}:${conversation.phone}`
            items.push({
              ...conversation,
              id,
              unreadCount: readInboxIdsRef.current.has(id) ? 0 : conversation.unreadCount,
              channel: result.value.channel,
              account: result.value.account,
            })
          })
        })
        items.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
        setInboxItems(items)
        setInboxPartialErrors(failures)
        setSelectedInboxId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || '')
      } catch (err) {
        if (err.name !== 'AbortError') {
          setInboxItems([])
          setSelectedInboxId('')
          setInboxError(err.message)
        }
      } finally {
        if (!controller.signal.aborted) setInboxLoading(false)
      }
    }

    loadInbox()
    return () => controller.abort()
  }, [activeView, inboxReloadKey])

  useEffect(() => {
    if (activeView !== 'inbox' || !selectedInboxItem) {
      setInboxThread(null)
      return undefined
    }
    const controller = new AbortController()
    setInboxThreadLoading(true)
    setInboxSendError('')
    getConversation(selectedInboxItem.channel, selectedInboxItem.phone, selectedInboxItem.account.id, controller.signal)
      .then((conversation) => {
        const contactName = conversation.contact.name === 'Contato' ? selectedInboxItem.name : conversation.contact.name
        setInboxThread({
          id: selectedInboxItem.id,
          channel: selectedInboxItem.channel,
          account: selectedInboxItem.account,
          conversation: { ...conversation, contact: { ...conversation.contact, name: contactName } },
        })
      })
      .catch((err) => { if (err.name !== 'AbortError') setInboxError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setInboxThreadLoading(false) })
    return () => controller.abort()
  }, [activeView, selectedInboxId])

  useEffect(() => {
    if (activeView !== 'inbox' || !inboxThread) return undefined
    let refreshing = false
    let controller = null
    const refreshConversation = async () => {
      if (refreshing || document.hidden) return
      refreshing = true
      controller = new AbortController()
      try {
        const current = inboxThreadRef.current
        if (!current) return
        const messagesWithTimestamp = current.conversation.messages.filter((message) => message.timestamp)
        const since = messagesWithTimestamp.at(-1)?.timestamp || ''
        const incoming = await getConversation(current.channel, current.conversation.contact.phone, current.account.id, controller.signal, since)
        setInboxThread((latest) => latest ? { ...latest, conversation: mergeConversation(latest.conversation, incoming) } : latest)
        const latestMessage = incoming.messages.at(-1)
        if (latestMessage) {
          setInboxItems((items) => items.map((item) => item.id === current.id ? {
            ...item,
            lastMessage: messagePreview(latestMessage),
            lastDirection: latestMessage.direction === 'outbound' ? 'enviada' : 'recebida',
            lastTimestamp: latestMessage.timestamp,
          } : item))
        }
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('Não foi possível atualizar a caixa de conversa.', err)
      } finally {
        refreshing = false
      }
    }
    const intervalId = window.setInterval(refreshConversation, 5000)
    const refreshWhenVisible = () => { if (!document.hidden) refreshConversation() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshConversation)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshConversation)
      controller?.abort()
    }
  }, [activeView, inboxThread?.account.id, inboxThread?.conversation.contact.phone, selectedInboxId])

  async function handleSearch(event, phoneOverride = '') {
    event?.preventDefault?.()
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    setPartialErrors([])
    setSearched(true)
    setSearchStats(null)
    setThreads([])
    setExpandedThreadId('')
    setDrafts({})
    setSendErrors({})
    try {
      const normalizedPhone = normalizeBrazilianPhone(phoneOverride || phone)
      if (!/^55\d{10,11}$/.test(normalizedPhone)) throw new Error('Digite um telefone brasileiro válido, com DDD.')

      const channelResults = await Promise.allSettled(['hub', 'official'].map(async (channel) => ({
        channel,
        accounts: await getAccounts(channel, controller.signal),
      })))
      if (controller.signal.aborted) return

      const discoveryErrors = []
      const accountLookups = []
      channelResults.forEach((result, index) => {
        const channel = ['hub', 'official'][index]
        if (result.status === 'rejected') {
          if (result.reason?.name !== 'AbortError') discoveryErrors.push(`${channel === 'official' ? 'API Oficial' : 'WhatsApp Hub'}: ${result.reason?.message || 'falha ao carregar contas'}`)
          return
        }
        result.value.accounts.forEach((account) => accountLookups.push({ channel, account }))
      })

      const historyResults = await Promise.allSettled(accountLookups.map(async ({ channel, account }) => ({
        id: `${channel}:${account.id}`,
        channel,
        account,
        conversation: await getConversation(channel, normalizedPhone, account.id, controller.signal),
      })))
      if (controller.signal.aborted) return

      const historyErrors = []
      const foundThreads = []
      historyResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (result.value.conversation.messages.length) foundThreads.push(result.value)
          return
        }
        if (result.reason?.name !== 'AbortError') {
          const lookup = accountLookups[index]
          historyErrors.push(`${lookup?.account.name || 'Conta'}: ${result.reason?.message || 'falha ao consultar histórico'}`)
        }
      })
      foundThreads.sort((a, b) => threadActivity(b) - threadActivity(a))
      setThreads(foundThreads)
      setExpandedThreadId(foundThreads[0]?.id || '')
      setPartialErrors([...discoveryErrors, ...historyErrors])
      setSearchStats({
        accountsConsulted: accountLookups.length,
        channelsAvailable: channelResults.filter((result) => result.status === 'fulfilled').length,
      })
      if (!foundThreads.length && !accountLookups.length && discoveryErrors.length) {
        setError('Não foi possível consultar os canais de WhatsApp neste momento.')
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  async function handleSend(event, thread) {
    event.preventDefault()
    const draft = drafts[thread.id] || ''
    if (sendingThreadId || !draft.trim()) return
    const text = draft.trim()
    setSendingThreadId(thread.id)
    setSendErrors((current) => ({ ...current, [thread.id]: '' }))
    try {
      const result = await sendMessage({
        channel: thread.channel,
        phone: thread.conversation.contact.phone,
        accountId: thread.account.id,
        text,
        attendant: ATTENDANT_NAME,
      })
      setThreads((current) => current.map((item) => {
        if (item.id !== thread.id) return item
        const latestTimestamp = item.conversation.messages.reduce((maximum, message) => {
          const timestamp = new Date(message.timestamp).getTime()
          return Number.isNaN(timestamp) ? maximum : Math.max(maximum, timestamp)
        }, 0)
        const optimisticTimestamp = new Date(latestTimestamp ? latestTimestamp + 1 : Date.now()).toISOString()
        return {
          ...item,
          conversation: {
            ...item.conversation,
            messages: [...item.conversation.messages, {
              id: result.message_id || result.wa_message_id || `local-${Date.now()}`,
              direction: 'outbound',
              text,
              timestamp: optimisticTimestamp,
              status: 'sent',
              optimistic: true,
            }],
          },
        }
      }))
      setDrafts((current) => ({ ...current, [thread.id]: '' }))
    } catch (err) {
      const windowClosed = thread.channel === 'official'
        && (String(err.code).toUpperCase() === 'JANELA_FECHADA' || (err.status === 409 && !err.code))
      if (windowClosed) {
        setThreads((current) => current.map((item) => item.id === thread.id
          ? { ...item, conversation: { ...item.conversation, windowOpen: false } }
          : item))
      }
      setSendErrors((current) => ({ ...current, [thread.id]: err.message }))
    } finally {
      setSendingThreadId('')
      window.requestAnimationFrame(() => {
        if (composerRef.current && !composerRef.current.disabled) {
          composerRef.current.focus({ preventScroll: true })
        }
      })
    }
  }

  function handleDraftKeyDown(event, thread) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend(event, thread)
    }
  }

  async function handleInboxSend(event) {
    event.preventDefault()
    if (!inboxThread || inboxSending || !inboxDraft.trim()) return
    const text = inboxDraft.trim()
    setInboxSending(true)
    setInboxSendError('')
    try {
      const result = await sendMessage({
        channel: inboxThread.channel,
        phone: inboxThread.conversation.contact.phone,
        accountId: inboxThread.account.id,
        text,
        attendant: ATTENDANT_NAME,
      })
      const latestTimestamp = inboxThread.conversation.messages.reduce((maximum, message) => (
        Math.max(maximum, safeTimestamp(message.timestamp))
      ), 0)
      const optimisticTimestamp = new Date(latestTimestamp ? latestTimestamp + 1 : Date.now()).toISOString()
      const optimisticMessage = {
        id: result.message_id || result.wa_message_id || `local-${Date.now()}`,
        direction: 'outbound',
        text,
        timestamp: optimisticTimestamp,
        status: 'sent',
        optimistic: true,
      }
      setInboxThread((current) => current ? {
        ...current,
        conversation: {
          ...current.conversation,
          messages: [...current.conversation.messages, optimisticMessage],
        },
      } : current)
      setInboxItems((items) => items.map((item) => item.id === inboxThread.id ? {
        ...item,
        lastMessage: text,
        lastDirection: 'enviada',
        lastTimestamp: optimisticTimestamp,
      } : item))
      setInboxDraft('')
    } catch (err) {
      setInboxSendError(err.message)
    } finally {
      setInboxSending(false)
      window.requestAnimationFrame(() => inboxComposerRef.current?.focus({ preventScroll: true }))
    }
  }

  function handleInboxDraftKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleInboxSend(event)
    }
  }

  if (!session) return <AuthScreen onLogin={setSession} />

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><MessageCircle size={24} /></span><span>Campuzz <span>Conversas</span></span></div>
      <nav className="app-tabs" aria-label="Áreas de conversas">
        <button className={activeView === 'student' ? 'active' : ''} type="button" onClick={() => setActiveView('student')}><UserRound size={16} />Histórico do aluno</button>
        <button className={activeView === 'inbox' ? 'active' : ''} type="button" onClick={() => setActiveView('inbox')}><Inbox size={16} />Caixa de conversas</button>
      </nav>
      <div className="topbar-actions"><div className="connection"><Wifi size={15} /><span>{session.user?.name || 'Usuário'}</span></div><a className="settings-button" href="/settings" aria-label="Configurações" title="Configurações"><SettingsIcon size={17} /></a><button className="settings-button" type="button" aria-label="Sair" title="Sair" onClick={() => { logout(); setSession(null) }}><X size={17} /></button></div>
    </header>

    {activeView === 'student' ? <main>
      <section className="intro">
        <span className="eyebrow">Ficha do aluno</span>
        <h1>Conversas no WhatsApp</h1>
        <p>Consulte de uma vez todos os atendimentos vinculados ao telefone do aluno.</p>
        <StudentSearchForm phone={phone} onPhoneChange={setPhone} onSubmit={handleSearch} loading={loading} error={error} formatPhone={formatPhone} />
      </section>

      <section className="conversation-results" aria-busy={loading}>
        {loading && <div className="results-loader"><div className="loader"><span /><p>Consultando contas e históricos...</p></div></div>}

        {!loading && searched && <div className="results-summary">
          <div><Layers3 size={18} /><strong>{threads.length} {threads.length === 1 ? 'conversa encontrada' : 'conversas encontradas'}</strong></div>
          {searchStats && <span>{searchStats.accountsConsulted} contas consultadas em {searchStats.channelsAvailable} canais</span>}
        </div>}

        {!loading && partialErrors.length > 0 && <details className="partial-errors">
          <summary>{partialErrors.length} {partialErrors.length === 1 ? 'consulta não pôde ser concluída' : 'consultas não puderam ser concluídas'}</summary>
          <ul>{partialErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
        </details>}

        {!loading && searched && !threads.length && !error && <div className="empty-results"><EmptyState searched /></div>}

        {!loading && threads.map((thread) => {
          const expanded = thread.id === expandedThreadId
          const messages = thread.conversation.messages
          const latestMessage = messages.at(-1)
          const draft = drafts[thread.id] || ''
          return <ConversationCard key={thread.id} thread={thread} expanded={expanded} onToggle={() => setExpandedThreadId(expanded ? '' : thread.id)} draft={drafts[thread.id] || ''} onDraftChange={(value) => setDrafts((current) => ({ ...current, [thread.id]: value }))} sending={sendingThreadId === thread.id} sendError={sendErrors[thread.id]} onSend={handleSend} onDraftKeyDown={handleDraftKeyDown} messagesRef={messagesRef} composerRef={composerRef} formatContactPhone={formatContactPhone} formatTime={formatTime} messagePreview={messagePreview} />
        })}
      </section>
    </main> : <main className="inbox-page">
      <section className="inbox-intro">
        <div>
          <span className="eyebrow">WhatsApp Hub</span>
          <h1>Caixa de conversas</h1>
          <p>Atendimentos de todas as contas, identificados pelo número de origem.</p>
        </div>
        <button className="inbox-refresh" type="button" onClick={() => setInboxReloadKey((key) => key + 1)} disabled={inboxLoading}>
          <RefreshCw size={17} className={inboxLoading ? 'spinning' : ''} />{inboxLoading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </section>

      {inboxError && <div className="error" role="alert"><X size={16} />{inboxError}</div>}
      {inboxPartialErrors.length > 0 && <details className="partial-errors inbox-partial-errors">
        <summary>{inboxPartialErrors.length} {inboxPartialErrors.length === 1 ? 'conta não pôde ser consultada' : 'contas não puderam ser consultadas'}</summary>
        <ul>{inboxPartialErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
      </details>}

      <section className="inbox-layout" aria-busy={inboxLoading}>
        <aside className="inbox-list">
          <div className="inbox-list-header">
            <strong>Conversas</strong>
            <span>{inboxItems.length}</span>
          </div>
          <div className="inbox-list-scroll">
            {inboxLoading && !inboxItems.length && <div className="loader inbox-loader"><span /><p>Carregando conversas...</p></div>}
            {!inboxLoading && !inboxItems.length && <div className="inbox-list-empty"><Inbox size={25} /><span>Nenhuma conversa encontrada.</span></div>}
            {inboxItems.map((item) => <button
              className={`inbox-item ${item.id === selectedInboxId ? 'active' : ''}`}
              type="button"
              key={item.id}
              onClick={() => setSelectedInboxId(item.id)}
            >
              <span className="inbox-avatar">{item.name?.charAt(0).toUpperCase() || 'C'}</span>
              <span className="inbox-item-body">
                <span className="inbox-item-title"><strong>{item.name || formatContactPhone(item.phone)}</strong><time>{formatTime(item.lastTimestamp)}</time></span>
                <span className="inbox-item-preview">{item.lastDirection === 'enviada' ? 'Você: ' : ''}{item.lastMessage || 'Sem mensagem'}</span>
                <span className="inbox-item-details">
                  <small className="inbox-account">{item.account.name}</small>
                  <small className={`inbox-status ${item.status || 'queued'}`}>{conversationStatus[item.status] || item.status || 'Na fila'}</small>
                  {item.unreadCount > 0 && <small className="unread-count">{item.unreadCount}</small>}
                </span>
              </span>
            </button>)}
          </div>
        </aside>

        <div className="inbox-chat">
          {inboxThreadLoading && <div className="loader"><span /><p>Carregando histórico...</p></div>}
          {!inboxThreadLoading && !inboxThread && <div className="empty-state"><div className="empty-icon"><MessageCircle size={30} /></div><h2>Selecione uma conversa</h2><p>Escolha um contato para visualizar o histórico completo.</p></div>}
          {!inboxThreadLoading && inboxThread && <>
            <header className="inbox-chat-header">
              <span className="avatar">{inboxThread.conversation.contact.name?.charAt(0).toUpperCase() || 'C'}</span>
              <div className="inbox-contact-title">
                <strong>{inboxThread.conversation.contact.name}</strong>
                <span>{formatContactPhone(inboxThread.conversation.contact.phone)}</span>
              </div>
              <div className="inbox-origin">
                <strong>{inboxThread.account.name}</strong>
                <span>{conversationStatus[selectedInboxItem?.status] || selectedInboxItem?.status || 'Na fila'}{selectedInboxItem?.attending ? ` · ${selectedInboxItem.attending}` : ''}</span>
              </div>
            </header>
            <ConversationMessages thread={inboxThread} messagesRef={inboxMessagesRef} />
            <form className="composer" onSubmit={handleInboxSend}>
              {inboxSendError && <div className="send-error" role="alert"><X size={14} />{inboxSendError}</div>}
              <div className="composer-row">
                <textarea ref={inboxComposerRef} value={inboxDraft} onChange={(event) => setInboxDraft(event.target.value.slice(0, 4096))} onKeyDown={handleInboxDraftKeyDown} placeholder={`Responder por ${inboxThread.account.name}`} aria-label="Mensagem" rows="1" disabled={inboxSending} />
                <span className={`char-count ${inboxDraft.length > 3900 ? 'near-limit' : ''}`}>{inboxDraft.length}/4096</span>
                <button type="submit" disabled={inboxSending || !inboxDraft.trim()} aria-label="Enviar mensagem"><Send size={19} /></button>
              </div>
              <span className="send-hint">Resposta enviada pelo WhatsApp Hub · Enter para enviar</span>
            </form>
          </>}
        </div>
      </section>
    </main>}
    <footer>Campuzz <span>•</span> Histórico integrado de conversas</footer>
  </div>
}
