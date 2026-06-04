import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import { Warning, TrendUp, Wallet } from "@phosphor-icons/react";
import "./BilleteraPage.css";

function fmt$(v) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

export default function BilleteraPage({ ficha }) {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const statsHoy   = useLiveQuery(() => repartidorDb.estadisticas.get(`hoy_${today}`),     [today]);
  const statsMes   = useLiveQuery(() => repartidorDb.estadisticas.get(`mes_${thisMonth}`), [thisMonth]);
  const statsTotal = useLiveQuery(() => repartidorDb.estadisticas.get("total"),             []);

  const hayDeuda = (ficha?.deudaActual || 0) > 0;
  const hayMulta = (ficha?.multaActual || 0) > 0;

  return (
    <div className="bp-root">
      {/* Hero — disponible */}
      <div className="bp-hero">
        <Wallet size={28} weight="fill" color="rgba(240,246,252,0.3)" />
        <span className="bp-hero__label">Dinero disponible</span>
        <strong className="bp-hero__amount">{fmt$(ficha?.dineroDisponible)}</strong>
        {(ficha?.dineroEnCuenta || 0) > 0 && (
          <span className="bp-hero__sub">+ {fmt$(ficha.dineroEnCuenta)} en cuenta</span>
        )}
      </div>

      {/* Alertas */}
      {(hayDeuda || hayMulta) && (
        <div className="bp-alerts">
          {hayDeuda && (
            <div className="bp-alert bp-alert--danger">
              <Warning size={15} weight="fill" />
              <span>Deuda: <strong>{fmt$(ficha.deudaActual)}</strong></span>
            </div>
          )}
          {hayMulta && (
            <div className="bp-alert bp-alert--warning">
              <Warning size={15} weight="fill" />
              <span>Multa: <strong>{fmt$(ficha.multaActual)}</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Estado del día */}
      <div className="bp-section">
        <span className="bp-section__title">Estado del día</span>
        <div className="bp-cards">
          <div className="bp-card">
            <span>Base hoy</span>
            <strong>{fmt$(ficha?.baseActual)}</strong>
          </div>
          <div className="bp-card bp-card--green">
            <span>Ganancia hoy</span>
            <strong>{fmt$(statsHoy?.gananciaTotal)}</strong>
          </div>
          <div className="bp-card">
            <span>Pedidos hoy</span>
            <strong>{statsHoy?.pedidosCompletados ?? 0}</strong>
          </div>
        </div>
      </div>

      {/* Ganancias */}
      <div className="bp-section">
        <span className="bp-section__title">
          <TrendUp size={13} weight="bold" /> Ganancias
        </span>
        <div className="bp-rows">
          <div className="bp-row">
            <span>Este mes</span>
            <strong>{fmt$(statsMes?.gananciaTotal)}</strong>
          </div>
          <div className="bp-row">
            <span>Pedidos este mes</span>
            <strong>{statsMes?.pedidosCompletados ?? 0}</strong>
          </div>
          <div className="bp-row bp-row--total">
            <span>Total histórico</span>
            <strong>{fmt$(statsTotal?.gananciaTotal)}</strong>
          </div>
          <div className="bp-row bp-row--total">
            <span>Pedidos totales</span>
            <strong>{statsTotal?.pedidosCompletados ?? 0}</strong>
          </div>
        </div>
      </div>

      {/* Deudas y multas */}
      <div className="bp-section">
        <span className="bp-section__title">Obligaciones</span>
        <div className="bp-rows">
          <div className="bp-row">
            <span>Deuda actual</span>
            <strong className={hayDeuda ? "bp-danger" : ""}>{fmt$(ficha?.deudaActual)}</strong>
          </div>
          <div className="bp-row">
            <span>Multa actual</span>
            <strong className={hayMulta ? "bp-warning" : ""}>{fmt$(ficha?.multaActual)}</strong>
          </div>
          <div className="bp-row">
            <span>Base del día</span>
            <strong>{fmt$(ficha?.baseActual)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
