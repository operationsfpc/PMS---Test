import { SrfPage } from "@features/srf/srf-page";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <SrfPage />
  </StrictMode>,
);
