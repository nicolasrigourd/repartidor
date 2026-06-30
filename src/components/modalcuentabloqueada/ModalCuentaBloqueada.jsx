import { Prohibit } from "@phosphor-icons/react";
import "./ModalCuentaBloqueada.css";

export default function ModalCuentaBloqueada({ open, reason, onCerrar }) {
  if (!open) return null;

  return (
    <div className="cuenta-bloqueada-modal-overlay" role="dialog" aria-modal="true">
      <div className="cuenta-bloqueada-modal-card">
        <div className="cuenta-bloqueada-modal-icon">
          <Prohibit size={26} weight="fill" />
        </div>

        <h2>No podés conectarte</h2>
        <p>
          {reason} Comunicate con la central para más información.
        </p>

        <button className="cuenta-bloqueada-modal-btn" onClick={onCerrar}>
          Entendido
        </button>
      </div>
    </div>
  );
}
