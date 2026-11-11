import "./zodConfig"; // before any module builds a schema
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Showcase from "./dev/Showcase";
import "./index.css";
import "./devlog";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {import.meta.env.DEV && /showcase|reel/.test(location.search) ? <Showcase /> : <App />}
  </React.StrictMode>,
);
