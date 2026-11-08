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
const STRICT_STORAGE_KEY = 'react_strict_mode'
const readStrictFlag = () => {
  try {
    const saved = localStorage.getItem(STRICT_STORAGE_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch (e) {}
  return import.meta.env.DEV || import.meta.env.VITE_STRICT_MODE === '1'
}

const strictMode = readStrictFlag()

const mount = (el) => {
  if(strictMode){
    const app=<StrictMode><App /></StrictMode>
  }else{
    const app=<App />
  }

  createRoot(el).render(app)
}

const rootEl = document.getElementById(ROOT_ID)
if (!rootEl) {
  console.error(`挂载节点 #${ROOT_ID} 不存在，看看index.html＞﹏＜喵` )
} else {
  mount(rootEl)
}
