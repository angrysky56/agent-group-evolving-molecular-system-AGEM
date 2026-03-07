import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-danger)",
          background: "var(--surface-sunken)",
          fontFamily: "var(--font-mono)",
        }}>
          <h2>Something went wrong.</h2>
          <details style={{ whiteSpace: "pre-wrap", marginTop: "1rem", textAlign: "left", background: "var(--surface-raised)", padding: "1rem", borderRadius: "8px" }}>
            {this.state.error && this.state.error.toString()}
          </details>
          <button 
            onClick={() => this.setState({ hasError: false })}
            style={{ 
              marginTop: "2rem", 
              padding: "0.5rem 1rem", 
              background: "var(--brand-primary)", 
              color: "white", 
              border: "none", 
              borderRadius: "4px", 
              cursor: "pointer" 
            }}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
