import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const EditorRoundtripTest = lazy(() => import('./editor-test/EditorRoundtripTest.tsx'))

const useEditorTest =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('editor-test') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useEditorTest ? (
      <Suspense fallback={<div style={{ padding: 24 }}>Loading editor test…</div>}>
        <EditorRoundtripTest />
      </Suspense>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
)
