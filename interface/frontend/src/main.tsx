import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useSettingsStore } from "./stores/settings";

async function bootstrap(): Promise<void> {
  // Server configuration is authoritative. Do not render Ollama defaults or
  // allow a chat request until the browser has attempted to hydrate from it.
  await useSettingsStore.getState().initializeFromServer();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
