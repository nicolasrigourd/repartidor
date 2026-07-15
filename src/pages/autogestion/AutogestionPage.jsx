import { useEffect, useState } from "react";
import {
  ReceiptX, Wallet, ClockCounterClockwise, CaretDown, CheckCircle, WarningCircle,
  Coins, Warning,
} from "@phosphor-icons/react";
import { getHistorialBase } from "../../services/miCuentaService";
import "./AutogestionPage.css";

function fmt$(v) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function formatDia(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  return `${DIAS[fecha.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function HistorialDiaItem({ dia }) {
  const [abierto, setAbierto] = useState(false);

  const saldoPendiente = (Number(dia.nuevaDeuda) || 0) + (Number(dia.nuevaMulta) || 0);
  const pagado = Number(dia.totalPagado) || 0;
  const sinSaldo = saldoPendiente <= 0;

  return (
    <div className="ap-hist-item">
      <button className="ap-hist-item__head" onClick={() => setAbierto((v) => !v)}>
        <div className={`ap-hist-item__estado ${sinSaldo ? "ap-hist-item__estado--ok" : "ap-hist-item__estado--warn"}`}>
          {sinSaldo
            ? <CheckCircle size={16} weight="bold" />
            : <WarningCircle size={16} weight="bold" />}
        </div>
        <div className="ap-hist-item__info">
          <span className="ap-hist-item__fecha">{formatDia(dia.dateKey)}</span>
          <span className="ap-hist-item__resumen">
            Base {fmt$(dia.baseDelDia)}
            {sinSaldo ? ` · Pagado ${fmt$(pagado)}` : ` · Saldo ${fmt$(saldoPendiente)}`}
          </span>
        </div>
        <CaretDown size={16} weight="bold" className={`ap-hist-item__caret ${abierto ? "ap-hist-item__caret--open" : ""}`} />
      </button>

      {abierto && (
        <div className="ap-hist-item__detalle">
          <div className="ap-hist-detalle-row">
            <span>Base del día</span>
            <strong>{fmt$(dia.baseDelDia)}</strong>
          </div>
          {Number(dia.deudaAnterior) > 0 && (
            <div className="ap-hist-detalle-row">
              <span>Deuda anterior</span>
              <strong>{fmt$(dia.deudaAnterior)}</strong>
            </div>
          )}
          {Number(dia.multaAnterior) > 0 && (
            <div className="ap-hist-detalle-row">
              <span>Multa anterior</span>
              <strong>{fmt$(dia.multaAnterior)}</strong>
            </div>
          )}
          <div className="ap-hist-detalle-row">
            <span>Total pagado</span>
            <strong>{fmt$(dia.totalPagado)}</strong>
          </div>
          {dia.recargoAplicado > 0 && (
            <div className="ap-hist-detalle-row">
              <span>Recargo por atraso</span>
              <strong className="ap-warning">{fmt$(dia.recargoAplicado)}</strong>
            </div>
          )}
          <div className="ap-hist-detalle-row ap-hist-detalle-row--total">
            <span>{sinSaldo ? "Quedó saldado" : "Pasa como atraso"}</span>
            <strong className={sinSaldo ? "" : "ap-danger"}>{fmt$(saldoPendiente)}</strong>
          </div>

          {dia.pagosDelDia?.length > 0 && (
            <div className="ap-hist-pagos">
              <span className="ap-hist-pagos__title">Pagos registrados</span>
              {dia.pagosDelDia.map((p) => (
                <div className="ap-hist-pago" key={p.pagoId}>
                  <span>{p.hora || ""}</span>
                  <span>{p.tipoPago || ""}</span>
                  <strong>{fmt$(p.monto)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AutogestionPage({ ficha, repartidorId }) {
  const deuda = Number(ficha?.deudaActual) || 0;
  const multa = Number(ficha?.multaActual) || 0;
  const base  = Number(ficha?.baseActual)  || 0;
  const total = deuda + multa;

  const [historial, setHistorial] = useState(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [dias, setDias] = useState(7);

  useEffect(() => {
    let cancelado = false;
    setHistorial(null);
    getHistorialBase({ driverId: repartidorId, sucursal: ficha?.sucursal, dias }).then((res) => {
      if (!cancelado) setHistorial(res);
    });
    return () => { cancelado = true; };
  }, [repartidorId, ficha?.sucursal, dias]);

  const verMas = async () => {
    setCargandoMas(true);
    setDias((d) => d + 7);
  };

  useEffect(() => {
    if (historial !== null) setCargandoMas(false);
  }, [historial]);

  return (
    <div className="ap-root">
      <div className="ap-section">
        <span className="ap-section__title">
          <Wallet size={13} weight="bold" /> Mi cuenta
        </span>

        <div className="ap-montos">
          <div className="ap-monto">
            <span className="ap-monto__badge ap-monto__badge--base">
              <Coins size={18} weight="fill" />
            </span>
            <strong className="ap-monto__valor">{fmt$(base)}</strong>
            <span className="ap-monto__label">Base del día</span>
          </div>
          {deuda > 0 && (
            <div className="ap-monto">
              <span className="ap-monto__badge ap-monto__badge--danger">
                <Warning size={18} weight="fill" />
              </span>
              <strong className="ap-monto__valor">{fmt$(deuda)}</strong>
              <span className="ap-monto__label">Deuda</span>
            </div>
          )}
          {multa > 0 && (
            <div className="ap-monto">
              <span className="ap-monto__badge ap-monto__badge--warning">
                <Warning size={18} weight="fill" />
              </span>
              <strong className="ap-monto__valor">{fmt$(multa)}</strong>
              <span className="ap-monto__label">Multa</span>
            </div>
          )}
        </div>

        {total <= 0 ? (
          <div className="ap-status ap-status--ok">
            <CheckCircle size={18} weight="fill" />
            <span>Estás al día — no tenés deuda ni multas pendientes</span>
          </div>
        ) : (
          <div className="ap-status ap-status--pendiente">
            <WarningCircle size={18} weight="fill" />
            <span>Tenés <strong>{fmt$(total)}</strong> pendiente de pago</span>
          </div>
        )}

        <button className="ap-pay-btn" disabled={total <= 0}>
          {total > 0 ? `Pagar ${fmt$(total)}` : "Pagar"}
        </button>
      </div>

      <div className="ap-section">
        <span className="ap-section__title">
          <ClockCounterClockwise size={13} weight="bold" /> Historial
        </span>

        {historial === null && (
          <div className="ap-empty">
            <span>Cargando historial…</span>
          </div>
        )}

        {historial !== null && historial.length === 0 && (
          <div className="ap-empty">
            <ReceiptX size={28} weight="duotone" />
            <span>Todavía no hay días cerrados para mostrar acá.</span>
          </div>
        )}

        {historial !== null && historial.length > 0 && (
          <>
            <div className="ap-hist-list">
              {historial.map((dia) => (
                <HistorialDiaItem key={dia.dateKey} dia={dia} />
              ))}
            </div>
            <button className="ap-ver-mas" onClick={verMas} disabled={cargandoMas}>
              {cargandoMas ? "Cargando…" : "Ver más"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
