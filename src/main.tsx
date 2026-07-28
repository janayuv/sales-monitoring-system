import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UpdaterProvider } from "./context/UpdaterContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <UpdaterProvider>
      <App />
    </UpdaterProvider>
  </React.StrictMode>,
);
