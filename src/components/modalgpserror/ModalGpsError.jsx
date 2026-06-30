import { MapPinLine } from "@phosphor-icons/react";
import "./ModalGpsError.css";

export default function ModalGpsError({ open, message, onCerrar }) {
  if (!open) return null;

  return (
    <div className="gps-error-modal-overlay" role="dialog" aria-modal="true">
      <div className="gps-error-modal-card">
        <div className="gps-error-modal-icon">
          <MapPinLine size={26} weight="fill" />
        </div>

        <h2>No pudimos activar tu ubicación</h2>
        <p>{message}</p>

        <button className="gps-error-modal-btn" onClick={onCerrar}>
          Entendido
        </button>
      </div>
    </div>
  );
}
