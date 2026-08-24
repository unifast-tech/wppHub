import { useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { login, registerUser } from '../auth'

const departments = ['Comercial B2C', 'Comercial B2B', 'Secretaria', 'Financeiro', 'Coordenação', 'Administrativo']

export default function AuthScreen({ onLogin }) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

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
      } else onLogin(await login(email, password))
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return <main className="bitrix-page bitrix-login-page">
    <section className="bitrix-login-panel">
      <span className="bitrix-brand"><MessageCircle size={19} />WppHub</span>
      <h1>{registering ? 'Criar acesso' : 'Acesse suas conversas'}</h1>
      <p>{registering ? 'Seu cadastro será enviado para aprovação do administrador.' : 'Entre para abrir a mensageria.'}</p>
      <form onSubmit={handleSubmit} className="bitrix-login-form">
        {registering && <><label htmlFor="auth-name">Nome completo</label><input id="auth-name" value={name} onChange={(event) => setName(event.target.value)} required /></>}
        <label htmlFor="auth-email">E-mail</label><input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        {registering && <><label htmlFor="auth-department">Departamento</label><select id="auth-department" value={department} onChange={(event) => setDepartment(event.target.value)} required><option value="">Selecione</option>{departments.map((item) => <option key={item}>{item}</option>)}</select></>}
        <label htmlFor="auth-password">Senha</label><input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        {registering && <><small className="bitrix-form-hint">Mínimo de 8 caracteres, com letras e números.</small><label htmlFor="auth-confirmation">Confirmar senha</label><input id="auth-confirmation" type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></>}
        {success && <div className="bitrix-form-success">{success}</div>}
        {error && <div className="error" role="alert"><X size={15} />{error}</div>}
        <button type="submit" disabled={loading}>{loading ? 'Aguarde...' : registering ? 'Solicitar cadastro' : 'Entrar'}</button>
      </form>
      <button className="bitrix-mode-toggle" type="button" onClick={() => { setRegistering((value) => !value); setError(''); setSuccess('') }}>{registering ? 'Já tenho acesso' : 'Criar novo acesso'}</button>
    </section>
  </main>
}
