import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Settings as SettingsIcon, X } from 'lucide-react'
import AuthScreen from '../../auth-ui/AuthScreen'
import { getAccountDepartments, getAdminUsers, getAuthSession, onSessionExpired, removeAccountDepartment, setAccountDepartment, updateAdminUser } from '../../auth'

const departments = ['Comercial B2C', 'Comercial B2B', 'Secretaria', 'Financeiro', 'Coordenação', 'Administrativo']
const channelLabels = { hub: 'WhatsApp Hub', official: 'API Oficial' }

export default function Settings() {
  const [session, setSession] = useState(() => getAuthSession())
  useEffect(() => onSessionExpired(() => setSession(null)), [])
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [accounts, setAccounts] = useState({ hub: [], official: [] })
  const [mappings, setMappings] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [userList, permissionData] = await Promise.all([getAdminUsers(), getAccountDepartments()])
      setUsers(userList)
      setAccounts(permissionData.accounts)
      setMappings(permissionData.mappings)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function approve(userId) {
    try { const user = await updateAdminUser(userId, { status: 'approved', active: true }); setUsers((current) => current.map((item) => item.id === user.id ? user : item)) } catch (err) { setError(err.message) }
  }

  async function assign(channel, account, department) {
    if (!department) return
    try {
      const mapping = await setAccountDepartment({ channel, accountId: account.id, accountName: account.name || account.nome || account.numero || '' , department })
      setMappings((current) => [...current.filter((item) => !(item.channel === mapping.channel && String(item.accountId) === String(mapping.accountId))), mapping])
    } catch (err) { setError(err.message) }
  }

  async function remove(channel, accountId) {
    try { await removeAccountDepartment(channel, accountId); setMappings((current) => current.filter((item) => !(item.channel === channel && String(item.accountId) === String(accountId)))) } catch (err) { setError(err.message) }
  }

  if (!session) return <AuthScreen onLogin={setSession} />
  if (session.user?.role !== 'admin') return <main className="admin-page"><div className="empty-state"><SettingsIcon size={28} /><h2>Acesso restrito</h2><p>Somente o administrador pode acessar as configurações.</p></div></main>

  return <main className="admin-page">
    <header className="admin-header"><div><span className="eyebrow">Configurações</span><h1>Usuários e permissões</h1><p>Controle os acessos e os dispositivos de cada setor.</p></div><button type="button" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign('/')} className="admin-back"><ArrowLeft size={15} />Voltar</button></header>
    <nav className="settings-tabs"><button className={tab === 'users' ? 'active' : ''} type="button" onClick={() => setTab('users')}>Usuários</button><button className={tab === 'permissions' ? 'active' : ''} type="button" onClick={() => setTab('permissions')}>Permissões</button><a className="settings-tab-link" href="/settings/activity">Atividade</a></nav>
    {error && <div className="error" role="alert"><X size={15} />{error}</div>}
    {loading ? <div className="loader"><span /><p>Carregando configurações...</p></div> : tab === 'users' ? <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Usuário</th><th>Departamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.department || 'Sem departamento'}</td><td><span className={`admin-status ${user.status}`}>{user.status === 'pending' ? 'Pendente' : user.status === 'approved' ? 'Aprovado' : 'Reprovado'}</span></td><td>{user.status === 'pending' && <button className="admin-inline-button" type="button" onClick={() => approve(user.id)}><Check size={14} />Aprovar</button>}</td></tr>)}</tbody></table></section> : <section className="permissions-grid">{['hub', 'official'].map((channel) => <article className="permission-section" key={channel}><header><strong>{channelLabels[channel]}</strong><span>Uma conta pode pertencer a apenas um setor.</span></header>{accounts[channel].map((account) => { const mapping = mappings.find((item) => item.channel === channel && String(item.accountId) === String(account.id)); return <div className="permission-row" key={account.id}><div><strong>{account.name || account.nome || account.numero || account.id}</strong><small>{account.numero || account.phone || account.id}</small></div><select value={mapping?.department || ''} onChange={(event) => event.target.value ? assign(channel, account, event.target.value) : remove(channel, account.id)}><option value="">Somente administradores</option>{departments.map((department) => <option key={department}>{department}</option>)}</select></div>})}</article>)}</section>}
  </main>
}
