import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Chặn trắng trang: lỗi render ở đâu chỉ hỏng vùng đó
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Lỗi giao diện:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <b>Giao diện gặp lỗi</b>
          <p>{error.message || 'Không rõ nguyên nhân'}</p>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Thử lại
          </button>
          <button className="ghost" onClick={() => location.reload()}>
            Tải lại trang
          </button>
        </div>
      </div>
    );
  }
}
