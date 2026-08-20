import { Component, type ErrorInfo, type ReactNode } from 'react'
import { uiActions, type AppRoute } from '../state/ui-store'

type Props = { children: ReactNode; route: AppRoute; title: string; description: string; retry: string; home: string }
type State = { error: Error | null }

export class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`Solar Atlas ${this.props.route} workspace failure`, error, info.componentStack) }
  componentDidUpdate(previous: Props) { if (previous.route !== this.props.route && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return <section className="workspace-error glass-panel" role="alert"><span aria-hidden="true">◌</span><h2>{this.props.title}</h2><p>{this.props.description}</p><pre>{this.state.error.message}</pre><div><button onClick={() => this.setState({ error: null })}>{this.props.retry}</button><button onClick={() => { this.setState({ error: null }); uiActions.navigate('home') }}>{this.props.home}</button></div></section>
  }
}
