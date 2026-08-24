import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App'
import BitrixDeal from './integrations/bitrix/deal/BitrixDeal'
import BitrixInstall from './integrations/bitrix/install/BitrixInstall'
import Users from './integrations/admin/Users'
import Settings from './integrations/admin/Settings'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/integrations/bitrix/deal" element={<BitrixDeal />} />
        <Route path="/integrations/bitrix/install" element={<BitrixInstall />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
