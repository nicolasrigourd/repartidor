import { Warning, X } from "@phosphor-icons/react";
import "./ModalDeudaPago.css";

function formatMoney(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(num);
}

export default function ModalDeudaPago({ open, deuda = 0, multa = 0, loading = false, onPagar, onCancelar }) {
  if (!open) return null;

  const total = Number(deuda || 0) + Number(multa || 0);

  return (
    <div className="deuda-modal-overlay" role="dialog" aria-modal="true">
      <div className="deuda-modal-card">
        <button className="deuda-modal-close" onClick={onCancelar} aria-label="Cerrar">
          <X size={18} weight="bold" />
        </button>

        <div className="deuda-modal-icon">
          <Warning size={26} weight="fill" />
        </div>

        <h2>Tenés pagos pendientes</h2>
        <p>Para conectarte y recibir pedidos primero tenés que regularizar tu situación.</p>

        <div className="deuda-modal-breakdown">
          <div className="deuda-modal-row">
            <span>Deuda actual</span>
            <strong>{formatMoney(deuda)}</strong>
          </div>

          <div className="deuda-modal-row">
            <span>Multa actual</span>
            <strong>{formatMoney(multa)}</strong>
          </div>

          <div className="deuda-modal-row deuda-modal-row--total">
            <span>Total a pagar</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        </div>

        <button
          className="deuda-modal-btn deuda-modal-btn--mp"
          onClick={onPagar}
          disabled={loading}
        >
          {loading ? "Procesando pago..." : "Pagar con MercadoPago"}
        </button>

        <button
          className="deuda-modal-btn deuda-modal-btn--cancel"
          onClick={onCancelar}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
