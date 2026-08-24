import { useEffect, useState } from 'react'
import { Activity as ActivityIcon, ArrowLeft, X } from 'lucide-react'
import AuthScreen from '../../auth-ui/AuthScreen'
import { getActivity, getAuthSession, onSessionExpired } from '../../auth'

export default function Activity() {
  const [session, setSession] = useState(() => getAuthSession())
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => onSessionExpired(() => setSession(null)), [])
  useEffect(() => { if (!session) return; getActivity().then(setItems).catch((err) => setError(err.message)).finally(() => setLoading(false)) }, [session])
  if (!session) return <AuthScreen onLogin={setSession} />
  if (session.user?.role !== 'admin' && session.user?.department !== 'Coordenação') return <main className="admin-page"><div className="empty-state"><ActivityIcon size={28} /><h2>Acesso restrito</h2><p>Somente administradores e Coordenação podem acessar a atividade.</p></div></main>
  return <main className="admin-page"><header className="admin-header"><div><span className="eyebrow">Auditoria</span><h1>Atividade</h1><p>Eventos importantes registrados nos últimos 180 dias.</p></div><button className="admin-back" type="button" onClick={() => window.history.back()}><ArrowLeft size={15} />Voltar</button></header>{error && <div className="error"><X size={15} />{error}</div>}{loading ? <div className="loader"><span /><p>Carregando atividade...</p></div> : <section className="activity-list">{items.length ? items.map((item) => <article className={`activity-item ${item.severity}`} key={item.id}><div><strong>{item.eventType}</strong><span>{item.actorName || item.actorEmail || 'Sistema'} · {new Date(item.createdAt).toLocaleString('pt-BR')}</span></div><small>{[item.channel, item.accountName, item.bitrixDealId ? `Deal #${item.bitrixDealId}` : ''].filter(Boolean).join(' · ') || 'Evento administrativo'}</small></article>) : <div className="empty-state"><ActivityIcon size={26} /><h2>Nenhuma atividade registrada</h2></div>}</section>}</main>
}
