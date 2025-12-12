import { useRegisterSW } from "virtual:pwa-register/react";
import "./pwaupdate.css";

export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-bar">
      <span>Hay una actualización disponible</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="pwa-update-btn"
      >
        Actualizar
      </button>
    </div>
  );
}
