import { useEffect, useState } from 'react'
import { Download, FileText, Image as ImageIcon, Mic } from 'lucide-react'
import { getAttachment } from '../api'

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return ''
  const size = Number(bytes)
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 ** 2).toFixed(1)} MB`
}

export default function MessageAttachment({ attachment, channel }) {
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
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setSource(objectUrl) })
      .catch((err) => { if (err.name !== 'AbortError') setFailed(true) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment?.ready, attachment?.url, channel, supported])

  if (!supported) return null
  if (attachment.ready === false) return <div className="attachment-state"><AttachmentIcon size={18} />{capitalizedLabel} sendo processad{['imagem', 'figurinha'].includes(label) ? 'a' : 'o'}...</div>
  if (!attachment.url) return <div className="attachment-state error-state"><AttachmentIcon size={18} />{capitalizedLabel} sem URL disponível.</div>
  if (failed) return <div className="attachment-state error-state"><AttachmentIcon size={18} />Não foi possível carregar o {label}.</div>
  if (!source) return <div className="attachment-state"><AttachmentIcon size={18} />Carregando {label}...</div>
  if (attachment.type === 'video') return <figure className="message-attachment message-video"><video src={source} controls preload="metadata">Seu navegador não suporta reprodução de vídeo.</video><a href={source} download={attachment.name || 'video.mp4'} aria-label="Baixar vídeo"><Download size={15} />Baixar</a></figure>
  if (attachment.type === 'audio') return <figure className="message-attachment message-audio"><div className="audio-label"><Mic size={17} /><span>{attachment.name || 'Mensagem de áudio'}</span></div><audio src={source} controls preload="metadata">Seu navegador não suporta reprodução de áudio.</audio><a href={source} download={attachment.name || 'audio.ogg'} aria-label="Baixar áudio"><Download size={15} />Baixar</a></figure>
  if (attachment.type === 'document') return <figure className="message-attachment message-document"><FileText size={30} /><figcaption><strong>{attachment.name || 'Documento'}</strong><span>{[formatFileSize(attachment.bytes), attachment.mime].filter(Boolean).join(' · ')}</span></figcaption><a href={source} download={attachment.name || 'documento'} aria-label="Baixar documento"><Download size={16} />Baixar</a></figure>
  return <figure className={`message-attachment ${attachment.type === 'sticker' ? 'message-sticker' : ''}`}><img src={source} alt={attachment.name || 'Imagem enviada na conversa'} loading="lazy" /><a href={source} download={attachment.name || 'imagem'} aria-label="Baixar imagem"><Download size={15} />Baixar</a></figure>
}
