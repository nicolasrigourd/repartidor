import { ReceiptX, Wallet, ClockCounterClockwise } from "@phosphor-icons/react";
import "./AutogestionPage.css";

function fmt$(v) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

export default function AutogestionPage({ ficha }) {
  const deuda = Number(ficha?.deudaActual) || 0;
  const multa = Number(ficha?.multaActual) || 0;
  const base  = Number(ficha?.baseActual)  || 0;
  const total = deuda + multa;

  return (
    <div className="ap-root">
      <div className="ap-section">
        <span className="ap-section__title">
          <Wallet size={13} weight="bold" /> Mi cuenta
        </span>
        <div className="ap-rows">
          <div className="ap-row">
            <span>Deuda actual</span>
            <strong className={deuda > 0 ? "ap-danger" : ""}>{fmt$(deuda)}</strong>
          </div>
          <div className="ap-row">
            <span>Multa actual</span>
            <strong className={multa > 0 ? "ap-warning" : ""}>{fmt$(multa)}</strong>
          </div>
          <div className="ap-row">
            <span>Base del día</span>
            <strong>{fmt$(base)}</strong>
          </div>
          <div className="ap-row ap-row--total">
            <span>Total a pagar</span>
            <strong>{fmt$(total)}</strong>
          </div>
        </div>

        <button className="ap-pay-btn" disabled>
          Pagar
        </button>
      </div>

      <div className="ap-section">
        <span className="ap-section__title">
          <ClockCounterClockwise size={13} weight="bold" /> Historial
        </span>
        <div className="ap-empty">
          <ReceiptX size={28} weight="duotone" />
          <span>Acá vas a ver el historial de tus pagos y estados de deuda.</span>
        </div>
      </div>
    </div>
  );
}
