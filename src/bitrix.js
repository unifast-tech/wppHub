const BITRIX_SDK_URL = 'https://api.bitrix24.com/api/v1/'

let sdkPromise

function loadSdk() {
  if (window.BX24) return Promise.resolve(window.BX24)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${BITRIX_SDK_URL}"]`)
    const script = existingScript || document.createElement('script')
    script.onload = () => window.BX24 ? resolve(window.BX24) : reject(new Error('O SDK do Bitrix24 não foi inicializado.'))
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK do Bitrix24.'))
    if (!existingScript) {
      script.src = BITRIX_SDK_URL
      script.async = true
      document.head.appendChild(script)
    }
  })
  return sdkPromise
}

function initSdk(sdk) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('O Bitrix24 não respondeu ao inicializar o SDK.')), 10000)
    try {
      sdk.init(() => {
        window.clearTimeout(timeoutId)
        resolve()
      })
    } catch (error) {
      window.clearTimeout(timeoutId)
      reject(error)
    }
  })
}

function callMethod(sdk, method, params) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(`O Bitrix24 não respondeu à chamada ${method}.`)), 15000)
    try {
      sdk.callMethod(method, params, (result) => {
        window.clearTimeout(timeoutId)
        if (result.error()) {
          reject(new Error(result.error_description() || `O Bitrix24 recusou a chamada ${method}.`))
          return
        }
        resolve(result.data())
      })
    } catch (error) {
      window.clearTimeout(timeoutId)
      reject(error)
    }
  })
}

function readPlacementOptions(placement) {
  const value = placement?.options ?? placement?.PLACEMENT_OPTIONS ?? placement?.placement_options ?? {}
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return {} }
}

function firstPhone(fields) {
  const phones = Array.isArray(fields) ? fields.filter((field) => field?.typeId === 'PHONE' || field?.TYPE_ID === 'PHONE') : []
  const priority = { MOBILE: 0, WORK: 1, OTHER: 2, HOME: 3 }
  phones.sort((first, second) => (priority[first.valueType ?? first.VALUE_TYPE] ?? 99) - (priority[second.valueType ?? second.VALUE_TYPE] ?? 99))
  return phones[0]?.value ?? phones[0]?.VALUE ?? ''
}

export async function getBitrixDealContext() {
  const sdk = await loadSdk()
  await initSdk(sdk)
  const queryDealId = new URLSearchParams(window.location.search).get('deal_id') || ''
  const cachedContext = window.sessionStorage.getItem('wpphub.bitrix.deal.context')
  const fallbackContext = cachedContext ? (() => { try { return JSON.parse(cachedContext) } catch { return null } })() : null
  const placement = window.__BITRIX_PLACEMENT_CONTEXT__ || (queryDealId ? { options: { ID: queryDealId } } : null) || (fallbackContext ? { options: { ID: fallbackContext.dealId } } : null) || await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('O Bitrix24 não forneceu o contexto deste Deal.')), 10000)
    try {
      sdk.placement.info((info) => {
        window.clearTimeout(timeoutId)
        resolve(info)
      })
    } catch (error) {
      window.clearTimeout(timeoutId)
      reject(error)
    }
  })
  const options = readPlacementOptions(placement)
  const dealId = options.ID || options.id || placement?.ID || queryDealId || fallbackContext?.dealId || ''
  if (!dealId) throw new Error('Não foi possível identificar o negócio aberto no Bitrix24.')

  const dealResult = await callMethod(sdk, 'crm.item.get', { entityTypeId: 2, id: dealId })
  const deal = dealResult?.item ?? dealResult
  const contactId = deal?.contactIds?.[0] ?? deal?.CONTACT_ID ?? deal?.contactId ?? ''
  let contact = null
  if (contactId) {
    const contactResult = await callMethod(sdk, 'crm.item.get', { entityTypeId: 3, id: contactId })
    contact = contactResult?.item ?? contactResult
  }

  return {
    dealId: String(dealId),
    dealTitle: deal?.title || deal?.TITLE || `Negócio #${dealId}`,
    contactId: String(contactId),
    contactName: contact?.name || (contact?.NAME ? [contact.NAME, contact.LAST_NAME].filter(Boolean).join(' ') : ''),
    phone: firstPhone(contact?.fm) || firstPhone(contact?.PHONE),
  }
}

export async function resizeBitrixWindow(height = 860) {
  const sdk = await loadSdk()
  await initSdk(sdk)
  if (typeof sdk.resizeWindow === 'function') sdk.resizeWindow(window.innerWidth, height)
}

export async function bindDealMessagesPlacement() {
  const sdk = await loadSdk()
  await initSdk(sdk)
  const appInfo = await callMethod(sdk, 'app.info', {})
  if (appInfo?.INSTALLED === true) return
  try {
    await callMethod(sdk, 'placement.bind', {
      PLACEMENT: 'CRM_DEAL_DETAIL_TAB',
      HANDLER: `${window.location.origin}/integrations/bitrix/deal`,
      TITLE: 'Mensagens',
    })
  } catch (error) {
    const message = String(error.message || '').toLowerCase()
    if (!message.includes('handler already binded') && !message.includes('handler already bound')) throw error
  }
  if (typeof sdk.installFinish !== 'function') throw new Error('O SDK do Bitrix24 não disponibilizou BX24.installFinish().')
  sdk.installFinish()
}
