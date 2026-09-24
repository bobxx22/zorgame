import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What broke: the screen (the rest keeps running) or the whole shell. */
  scope: 'screen' | 'shell'
}

interface State {
  error: Error | null
}

/**
 * A render error stays inside the boundary. The providers sit above it, so
 * the ether listener, the armed application and the session keep working
 * while one screen shows this notice instead of taking the whole page down.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Екран клієнта впав:', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash" role="alert">
        <p className="crash-h">{this.props.scope === 'screen' ? 'Цей екран не вдалося показати' : 'Клієнт натрапив на помилку'}</p>
        <p>
          Ефір і заготовлена заявка працюють далі. Спробуйте показати екран знову; якщо не допоможе - перезавантажте
          сторінку (заготовка це переживе).
        </p>
        <p className="crash-detail">
          <code>{error.message}</code>
        </p>
        <div className="acts">
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              this.setState({ error: null })
            }}
          >
            Показати знову
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              window.location.reload()
            }}
          >
            Перезавантажити сторінку
          </button>
        </div>
      </div>
    )
  }
}
