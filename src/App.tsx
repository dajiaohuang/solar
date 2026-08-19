import './App.css'
import { AppProviders } from './app/providers'
import { AppShell } from './app/AppShell'
import { AppErrorBoundary } from './app/AppErrorBoundary'

export default function App() {
  return <AppErrorBoundary><AppProviders><AppShell /></AppProviders></AppErrorBoundary>
}
