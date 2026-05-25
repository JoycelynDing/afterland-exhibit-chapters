import {Component, StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type ErrorBoundaryState = {
  error: Error | null;
};

class RootErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    console.error('Afterland root render failed:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-[#120905] px-6 text-[#ead5b5]">
          <div className="max-w-3xl rounded-[24px] border border-[#6c4a24] bg-[rgba(24,13,8,0.9)] px-8 py-7 shadow-[0_22px_70px_rgba(0,0,0,0.45)] backdrop-blur-sm">
            <p className="mb-3 text-sm tracking-[0.18em] text-[#caa06d]">AFTERLAND ERROR</p>
            <p className="text-lg leading-8">页面加载失败，请刷新重试。</p>
            <p className="mt-3 text-sm leading-7 text-[#d4b28d]/80">
              {this.state.error.message || 'Unknown runtime error'}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
