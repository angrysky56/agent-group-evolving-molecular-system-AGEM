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
        <div
          style={{
            padding: "2rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--error)",
            background: "var(--bg-secondary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <h2>The view encountered an unexpected error.</h2>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              marginTop: "0.5rem",
            }}
          >
            The component details are shown below. You can try recovering the
            view using the action button.
          </p>
          <details
            style={{
              whiteSpace: "pre-wrap",
              marginTop: "1.5rem",
              textAlign: "left",
              background: "var(--bg-tertiary)",
              padding: "1rem",
              borderRadius: "8px",
              fontSize: "12px",
              fontFamily: "var(--font-mono)",
              border: "1px solid var(--glass-border)",
            }}
          >
            {this.state.error && this.state.error.toString()}
          </details>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: "2rem",
              padding: "0.5rem 1rem",
              background: "var(--accent-primary)",
              color: "var(--bg-void)",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
            }}
          >
            Reload Component
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
