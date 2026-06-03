// DriverCards.jsx
// Cards flotantes que se superponen al mapa
// Offline: incentivo + botón conectar
// Online: estado + ganancias del día
// Activo: pedido en curso + pasos

import { useState } from "react";
import {
  WifiHigh, WifiSlash, Lightning, Package,
  CurrencyDollar, MapPin, CaretRight,
  CircleNotch, Warning, CheckCircle,
} from "@phosphor-icons/react";
import "./DriverCards.css";

// ── Formateo ───────────────────────────────────────────────
function fmt$(v) {
  return `$${(Number(v) || 0).toLocaleString("es-AR")}`;
}

// ── Dot de estado ──────────────────────────────────────────
function StatusDot({ status }) {
  const colors = {
    online:            "var(--color-online)",
    busy:              "var(--color-busy)",
    pending_admission: "var(--color-starting)",
    starting:          "var(--color-starting)",
    error:             "var(--color-error)",
    offline:           "var(--color-offline)",
  };
  return (
    <span
      className="driver-status-dot"
      style={{ background: colors[status] || colors.offline }}
    />
  );
}

// ──────────────────────────────────────────────────────────
// CARD OFFLINE — incentivo + botón conectar
// ──────────────────────────────────────────────────────────
export function OfflineCard({
  pedidosActivos = 0,
  gananciaUltima = 0,
  onConectar,
  conectando = false,
  errorConexion = "",
}) {
  return (
    <div className="dc-offline-card">

      {/* Incentivo */}
      {pedidosActivos > 0 && (
        <div className="dc-incentivo">
          <Lightning size={16} weight="fill" />
          <span>
            <strong>{pedidosActivos}</strong>{" "}
            {pedidosActivos === 1 ? "pedido sin repartidor" : "pedidos sin repartidor"} ahora
          </span>
        </div>
      )}

      {/* Última sesión */}
      {gananciaUltima > 0 && (
        <div className="dc-ultima-sesion">
          <CurrencyDollar size={14} weight="fill" />
          <span>Última sesión: <strong>{fmt$(gananciaUltima)}</strong></span>
        </div>
      )}

      {/* Error de conexión */}
      {errorConexion && (
        <div className="dc-error">
          <Warning size={14} weight="fill" />
          <span>{errorConexion}</span>
        </div>
      )}

      {/* Botón conectar */}
      <button
        type="button"
        className={`dc-conectar-btn ${conectando ? "dc-conectar-btn--loading" : ""}`}
        onClick={onConectar}
        disabled={conectando}
      >
        {conectando ? (
          <>
            <CircleNotch size={20} weight="bold" className="dc-spin" />
            <span>Conectando…</span>
          </>
        ) : (
          <>
            <WifiHigh size={20} weight="bold" />
            <span>Conectarme</span>
          </>
        )}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// STATUS CARD — cuando está online/busy
// ──────────────────────────────────────────────────────────
export function OnlineStatusCard({
  workStatus,
  gananciaHoy    = 0,
  pedidosHoy     = 0,
  onDesconectar,
}) {
  const [showDesconectar, setShowDesconectar] = useState(false);

  const labels = {
    online:            "Disponible",
    busy:              "En pedido",
    pending_admission: "Validando…",
    starting:          "Conectando…",
  };

  return (
    <>
      {/* Pill de estado arriba */}
      <div className="dc-status-pill" onClick={() => setShowDesconectar(v => !v)}>
        <StatusDot status={workStatus} />
        <span>{labels[workStatus] || workStatus}</span>
        <div className="dc-earnings-mini">
          <CurrencyDollar size={12} weight="fill" />
          <span>{fmt$(gananciaHoy)}</span>
        </div>
      </div>

      {/* Panel de desconexión cuando toca el pill */}
      {showDesconectar && (
        <div className="dc-desconectar-panel">
          <p>Hoy: <strong>{pedidosHoy} pedidos · {fmt$(gananciaHoy)}</strong></p>
          <button
            type="button"
            className="dc-desconectar-btn"
            onClick={() => { setShowDesconectar(false); onDesconectar?.(); }}
          >
            <WifiSlash size={16} weight="bold" />
            Dejar de trabajar
          </button>
          <button
            type="button"
            className="dc-volver-btn"
            onClick={() => setShowDesconectar(false)}
          >
            Seguir trabajando
          </button>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// PEDIDO ACTIVO CARD — mini card abajo durante la entrega
// ──────────────────────────────────────────────────────────

const STEP_LABELS = {
  go_to_pickup:    { label: "Ir al origen",   color: "#6366F1", icon: MapPin },
  started_pickup:  { label: "En camino",       color: "#6366F1", icon: MapPin },
  arrived_pickup:  { label: "Llegaste al origen", color: "#F59E0B", icon: CheckCircle },
  go_to_dropoff:   { label: "Ir al destino",   color: "#22C55E", icon: Package },
  arrived_dropoff: { label: "Llegaste al destino", color: "#22C55E", icon: CheckCircle },
  delivered:       { label: "Entregado ✓",     color: "#22C55E", icon: CheckCircle },
};

export function PedidoActivoCard({ pedido, onVerDetalle }) {
  if (!pedido) return null;

  const step   = pedido.delivery?.currentStep || pedido.currentStep || "go_to_pickup";
  const config = STEP_LABELS[step] || STEP_LABELS.go_to_pickup;
  const Icono  = config.icon;
  const addr   = step.includes("dropoff") || step === "delivered"
    ? (pedido.dropoff?.address || "Destino")
    : (pedido.pickup?.address  || "Origen");

  return (
    <div className="dc-pedido-activo-card" onClick={onVerDetalle}>
      <div className="dc-pedido-activo-card__step" style={{ background: `${config.color}18`, borderColor: `${config.color}40` }}>
        <Icono size={18} weight="fill" color={config.color} />
      </div>
      <div className="dc-pedido-activo-card__info">
        <p style={{ color: config.color }}>{config.label}</p>
        <small>{addr}</small>
      </div>
      <CaretRight size={18} weight="bold" color="rgba(240,246,252,0.4)" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ZONA SUGERIDA — aparece cuando está lejos de demanda
// ──────────────────────────────────────────────────────────
export function ZonaSugeridaCard({ zona }) {
  if (!zona) return null;
  return (
    <div className="dc-zona-sugerida">
      <MapPin size={14} weight="fill" color="#F97316" />
      <span>Acercate a <strong>{zona.label}</strong> — mayor demanda ahora</span>
    </div>
  );
}
