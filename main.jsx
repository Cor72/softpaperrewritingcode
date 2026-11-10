import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import './styles.css'
import './workspace.css'
import './inspector.css'
import './account/account.css'
import './workspaceRefinement.css'
import './anyBuilder.css'

const ROOT_ID = 'root'
const STRICT_FLAG_KEY = 'react_strict_mode'

const readStrictFlag = () => {
  try {
    const saved = localStorage.getItem(STRICT_FLAG_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch (err) {}
  return import.meta.env.DEV || import.meta.env.VITE_STRICT_MODE === '1'
}

const rootEl = document.getElementById(ROOT_ID)
if (!rootEl) {
  console.error(`挂载节点 #${ROOT_ID} 不存在，看看 index.html＞﹏＜喵`)
} else {
  const app = readStrictFlag() ? <StrictMode><App /></StrictMode> : <App />
  createRoot(rootEl).render(app)
}
