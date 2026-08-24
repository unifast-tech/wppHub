import { ChevronDown, Layers3, Send, X } from 'lucide-react'
import ConversationMessages from './ConversationMessages'

const channelLabel = { official: 'Meta · Oficial', hub: 'Hub · Evolution' }

export default function ConversationCard({
  thread,
  expanded,
  onToggle,
  draft,
  onDraftChange,
  sending,
  sendError,
  onSend,
  onDraftKeyDown,
  messagesRef,
  composerRef,
  formatContactPhone,
  formatTime,
  messagePreview,
}) {
  const messages = thread.conversation.messages
  const latestMessage = messages.at(-1)
  const officialWindowClosed = thread.channel === 'official' && thread.conversation.windowOpen === false

  return <article className={`thread-card ${expanded ? 'expanded' : ''}`}>
    <button className="thread-header" type="button" onClick={onToggle} aria-expanded={expanded}>
      <span className={`thread-avatar ${thread.channel}`}>{thread.account.name?.charAt(0).toUpperCase() || 'W'}</span>
      <span className="thread-main">
        <span className="thread-title"><strong>{thread.account.name}</strong><span className={`channel-badge ${thread.channel}`}>{channelLabel[thread.channel]}</span></span>
        <span className="thread-preview">{messagePreview(latestMessage)}</span>
      </span>
      <span className="thread-meta"><time>{formatTime(latestMessage?.timestamp)}</time><small>{messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}</small></span>
      <ChevronDown className="thread-chevron" size={19} />
    </button>
    {expanded && <div className="thread-content">
      <div className="thread-contact"><span>{thread.conversation.contact.name}</span><small>{formatContactPhone(thread.conversation.contact.phone)}</small></div>
      <ConversationMessages thread={thread} messagesRef={messagesRef} />
      <form className="composer" onSubmit={(event) => onSend(event, thread)}>
        {officialWindowClosed && <div className="window-warning">Janela de 24 horas encerrada. Aguarde o contato enviar uma nova mensagem para responder.</div>}
        {sendError && <div className="send-error" role="alert"><X size={14} />{sendError}</div>}
        <div className="composer-row">
          <textarea ref={composerRef} value={draft} onChange={(event) => onDraftChange(event.target.value.slice(0, 4096))} onKeyDown={(event) => onDraftKeyDown(event, thread)} placeholder={officialWindowClosed ? 'Envio indisponível fora da janela de 24h' : `Responder por ${thread.account.name}`} aria-label="Mensagem" rows="1" disabled={sending || officialWindowClosed} />
          <span className={`char-count ${draft.length > 3900 ? 'near-limit' : ''}`}>{draft.length}/4096</span>
          <button type="submit" disabled={sending || !draft.trim() || officialWindowClosed} aria-label="Enviar mensagem"><Send size={19} /></button>
        </div>
        <span className="send-hint">Resposta enviada por {thread.channel === 'official' ? 'API Oficial' : 'WhatsApp Hub'} · Enter para enviar</span>
      </form>
    </div>}
  </article>
}
