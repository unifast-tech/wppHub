import { Fragment } from 'react'
import { Check, CheckCheck } from 'lucide-react'
import MessageAttachment from './MessageAttachment'

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatDateLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sem data'
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Hoje'
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function LinkifiedText({ text }) {
  if (!text) return null
  return text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi).map((part, index) => {
    if (!/^(?:https?:\/\/|www\.)/i.test(part)) return <Fragment key={`${index}-${part}`}>{part}</Fragment>
    const punctuation = part.match(/[),.;!?]+$/)?.[0] || ''
    const visibleUrl = punctuation ? part.slice(0, -punctuation.length) : part
    const href = /^www\./i.test(visibleUrl) ? `https://${visibleUrl}` : visibleUrl
    return <Fragment key={`${index}-${part}`}><a className="message-link" href={href} target="_blank" rel="noopener noreferrer">{visibleUrl}</a>{punctuation}</Fragment>
  })
}

function StatusIcon({ status }) {
  return ['read', 'seen', 'delivered'].includes(String(status).toLowerCase())
    ? <CheckCheck size={15} aria-label={String(status).toLowerCase() === 'delivered' ? 'Entregue' : 'Lida'} />
    : <Check size={15} aria-label="Enviada" />
}

export default function ConversationMessages({ thread, messagesRef }) {
  const messages = thread.conversation.messages
  return <div className="messages thread-messages" ref={messagesRef}>
    {messages.map((message, index) => {
      const currentDay = formatDateLabel(message.timestamp)
      const previousDay = index ? formatDateLabel(messages[index - 1].timestamp) : ''
      return <Fragment key={message.id}>
        {currentDay !== previousDay && <div className="date-chip">{currentDay}</div>}
        <div className={`message-row ${message.direction}`}><div className="bubble">
          {message.attachment && <MessageAttachment attachment={message.attachment} channel={thread.channel} />}
          <p><LinkifiedText text={message.text || (message.attachment ? '' : 'Mensagem sem conteúdo textual')} /></p>
          <span className="meta">{formatTime(message.timestamp)}{message.direction === 'outbound' && <StatusIcon status={message.status} />}</span>
          {message.reaction && <span className="message-reaction" title="Reação à mensagem">{message.reaction}</span>}
        </div></div>
      </Fragment>
    })}
  </div>
}
