import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Solar Atlas workspace failure', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-fallback">
      <span aria-hidden="true">☉</span>
      <h1>Solar Atlas recovered the page boundary</h1>
      <p>工作区发生错误。你的场景仍保存在地址栏中；可以重载应用或返回首页。</p>
      <pre>{this.state.error.message}</pre>
      <div><button onClick={() => window.location.reload()}>Reload / 重载</button><button onClick={() => window.location.assign(import.meta.env.BASE_URL)}>Home / 首页</button></div>
    </main>
  }
}
