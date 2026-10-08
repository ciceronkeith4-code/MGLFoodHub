import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import { CatalogProvider } from './hooks/useCatalog'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CatalogProvider>
        <App />
        <Toaster
          position="top-center"
          offset={{ top: 84 }}
          mobileOffset={{ top: 76, left: 12, right: 12 }}
          richColors
          closeButton
          toastOptions={{ style: { fontFamily: 'Inter, sans-serif', borderRadius: '14px' } }}
        />
      </CatalogProvider>
    </BrowserRouter>
  </StrictMode>,
)
