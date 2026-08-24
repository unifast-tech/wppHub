import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Trash2, UserRound, X } from 'lucide-react'
import { deleteAdminUser, getAdminUsers, getAuthSession, resetAdminUserPassword, updateAdminUser } from '../../auth'

const departments = ['Comercial B2C', 'Comercial B2B', 'Secretaria', 'Financeiro', 'Coordenação', 'Administrativo']

export default function Users() {
  const [session] = useState(() => getAuthSession())
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState(null)

  async function loadUsers() {
    setLoading(true)
    setError('')
    try { setUsers(await getAdminUsers()) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  useEffect(() => { loadUsers() }, [])

  async function update(userId, changes) {
    try {
      const updated = await updateAdminUser(userId, changes)
      setUsers((current) => current.map((user) => user.id === updated.id ? updated : user))
    } catch (err) { setError(err.message) }
  }

  async function remove(user) {
    if (!window.confirm(`Excluir o usuário ${user.name}?`)) return
    try { await deleteAdminUser(user.id); setUsers((current) => current.filter((item) => item.id !== user.id)) } catch (err) { setError(err.message) }
  }

  async function resetPassword(user) {
    try { setTemporaryPassword(await resetAdminUserPassword(user.id)) } catch (err) { setError(err.message) }
  }

  if (!session || session.user?.role !== 'admin') return <main className="admin-page"><div className="empty-state"><UserRound size={28} /><h2>Acesso restrito</h2><p>Entre com a conta administradora para acessar este painel.</p></div></main>

  return <main className="admin-page">
    <header className="admin-header"><div><span className="eyebrow">Administração</span><h1>Usuários da aplicação</h1><p>Aprove acessos e gerencie os departamentos da equipe.</p></div><button type="button" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign('/')} className="admin-back"><ArrowLeft size={15} />Voltar</button></header>
    {error && <div className="error" role="alert"><X size={15} />{error}</div>}
    {temporaryPassword && <div className="admin-reset-notice">Senha temporária para <strong>{temporaryPassword.email}</strong>: <code>{temporaryPassword.temporaryPassword}</code><button type="button" onClick={() => setTemporaryPassword(null)}>Fechar</button></div>}
    <section className="admin-table-wrap">
      {loading ? <div className="loader"><span /><p>Carregando usuários...</p></div> : <table className="admin-table"><thead><tr><th>Usuário</th><th>Departamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
        <td><strong>{user.name}</strong><small>{user.email}</small></td>
        <td><select value={user.department || ''} onChange={(event) => update(user.id, { department: event.target.value })}><option value="">Sem departamento</option>{departments.map((department) => <option key={department}>{department}</option>)}</select></td>
        <td><span className={`admin-status ${user.status}`}>{user.status === 'pending' ? 'Pendente' : user.status === 'approved' ? 'Aprovado' : 'Reprovado'}</span></td>
        <td><div className="admin-actions">{user.status !== 'approved' && <button type="button" title="Aprovar" onClick={() => update(user.id, { status: 'approved', active: true })}><Check size={15} /></button>}{user.status === 'pending' && <button type="button" title="Reprovar" onClick={() => update(user.id, { status: 'rejected', active: false })}><X size={15} /></button>}{user.email !== 'admin@unifast.com.br' && <><button type="button" title={user.active ? 'Bloquear' : 'Desbloquear'} onClick={() => update(user.id, { active: !user.active })}><span>{user.active ? 'Bloq.' : 'Ativ.'}</span></button><button type="button" title="Redefinir senha" onClick={() => resetPassword(user)}>Senha</button><button type="button" title="Excluir" onClick={() => remove(user)}><Trash2 size={15} /></button></>}</div></td>
      </tr>)}</tbody></table>}
    </section>
  </main>
}
