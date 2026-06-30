import { BatteryWarning } from "@phosphor-icons/react";
import "./ModalBateriaBaja.css";

export default function ModalBateriaBaja({ open, level, onCerrar }) {
  if (!open) return null;

  return (
    <div className="bateria-modal-overlay" role="dialog" aria-modal="true">
      <div className="bateria-modal-card">
        <div className="bateria-modal-icon">
          <BatteryWarning size={26} weight="fill" />
        </div>

        <h2>Batería muy baja para conectarte</h2>
        <p>
          Tu batería está en <strong>{level}%</strong>. Quedarte sin batería en medio de un
          pedido puede ser peligroso — cargá tu dispositivo antes de empezar a trabajar.
        </p>

        <button className="bateria-modal-btn" onClick={onCerrar}>
          Entendido
        </button>
      </div>
    </div>
  );
}
