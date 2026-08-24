import { Phone, Search, X } from 'lucide-react'

export default function StudentSearchForm({ phone, onPhoneChange, onSubmit, loading, error, formatPhone }) {
  return <form className="search-form" onSubmit={onSubmit}>
    <label htmlFor="phone">Telefone do aluno</label>
    <div className="search-row">
      <div className="input-wrap"><Phone size={19} /><input id="phone" value={phone} onChange={(event) => onPhoneChange(formatPhone(event.target.value))} placeholder="(11) 99999-9999" inputMode="tel" autoComplete="tel" /><span className="country">BR</span></div>
      <button type="submit" disabled={loading}><Search size={18} />{loading ? 'Consultando canais...' : 'Ver histórico'}</button>
    </div>
    {error && <div className="error" role="alert"><X size={16} />{error}</div>}
  </form>
}
