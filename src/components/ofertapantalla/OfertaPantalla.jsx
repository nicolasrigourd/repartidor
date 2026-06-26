import { useEffect, useRef, useState } from "react";
import {
  CurrencyDollar, MapPinLine, Warning, X, Check, Bell,
} from "@phosphor-icons/react";
import "./OfertaPantalla.css";

function fmt$(v) {
  return `$${(Number(v) || 0).toLocaleString("es-AR")}`;
}
function fmtKm(v) {
  const km = Number(v);
  return Number.isFinite(km) && km > 0 ? `${km.toFixed(1)} km` : null;
}
function fmtMin(min, km) {
  const m = Number(min);
  if (Number.isFinite(m) && m > 0) return `~${Math.round(m)} min`;
  const k = Number(km);
  if (Number.isFinite(k) && k > 0) return `~${Math.round(k * 3)} min`;
  return null;
}

// ── Anillo de countdown ────────────────────────────────────
function TimerRing({ remaining, total }) {
  const pct    = Math.max(0, remaining / total);
  const radius = 32;
  const circ   = 2 * Math.PI * radius;
  const color  = pct > 0.4 ? "#2DD4BF" : "#FB7185";
  const secs   = Math.ceil(remaining / 1000);

  return (
    <div className="op-timer-ring">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r={radius} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6"/>
        <circle
          cx="38" cy="38" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transform: "rotate(-90deg)", transformOrigin: "38px 38px", transition: "stroke-dashoffset 0.25s linear, stroke 0.3s" }}
        />
      </svg>
      <span className="op-timer-ring__secs" style={{ color }}>{secs}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Pantalla de oferta — a propósito NO muestra direcciones, nombres
// ni teléfonos del cliente: esa info recién aparece en PedidoActivo,
// una vez aceptado. Diseño a pantalla completa, tipografía grande y
// alto contraste: el repartidor la tiene que poder leer de un vistazo,
// con sol de frente o con la funda puesta.

export default function OfertaPantalla({ oferta, ttlMs = 20000, onAceptar, onRechazar }) {
  const [remaining, setRemaining] = useState(ttlMs);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setRemaining(ttlMs);
    const id = setInterval(() => {
      const left = Math.max(0, ttlMs - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [oferta, ttlMs]);

  useEffect(() => {
    if (remaining <= 0) onRechazar?.("expired");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const ofertaKey = oferta?.orderId || oferta?.id || null;

  useEffect(() => {
    if (!ofertaKey) return;
    const audio = new Audio("/sounds/oferta.mp3");
    audio.play().catch(() => {});
  }, [ofertaKey]);

  if (!oferta) return null;

  // ── Todos los campos desde la RAÍZ del offer payload ──
  const serviceLabel  = oferta.service?.label || "Envío";
  const precio        = oferta.pricing?.price;
  const surcharge     = oferta.pricing?.surcharge;
  const distanciaKm   = oferta.route?.distanceKm;

  const driverDistanciaKm    = oferta.driverDistanceKm;
  const driverDistanciaLabel = fmtKm(driverDistanciaKm);
  const driverEtaLabel       = fmtMin(null, driverDistanciaKm);

  const paymentMethod = oferta.payment?.method;
  const requiresMoney = oferta.payment?.requiresMoney === true || oferta.payment?.requiresCashHandling === true;
  const cashAmount    = oferta.payment?.requiredMoneyAmount || 0;

  const isMercadoPago   = paymentMethod === "mercadopago";
  const totalConRecargo = surcharge > 0 && precio > 0 ? precio + surcharge : null;

  return (
    <div className="op-overlay">
      <div className="op-screen">

        {/* Header — tipo + timer */}
        <div className="op-header">
          <div className="op-header__info">
            <p className="op-header__eyebrow">
              <Bell size={14} weight="fill" className="op-header__bell" /> Nuevo pedido
            </p>
            <h2 className="op-header__title">{serviceLabel}</h2>
            {isMercadoPago && (
              <span className="op-header__badge op-header__badge--mp">📱 MercadoPago</span>
            )}
          </div>
          <TimerRing remaining={remaining} total={ttlMs} />
        </div>

        {/* Hero — distancia/tiempo al punto de retiro: lo más grande de la pantalla */}
        <div className="op-hero">
          <span className="op-hero__label">
            <MapPinLine size={18} weight="fill" /> ESTÁS A
          </span>
          <div className="op-hero__numbers">
            {driverDistanciaLabel && <strong>{driverDistanciaLabel}</strong>}
            {driverDistanciaLabel && driverEtaLabel && <span className="op-hero__dot">·</span>}
            {driverEtaLabel && <strong>{driverEtaLabel}</strong>}
            {!driverDistanciaLabel && !driverEtaLabel && <strong>—</strong>}
          </div>
          <span className="op-hero__sub">del punto de retiro</span>
        </div>

        {/* Métricas secundarias — sin direcciones, solo ganancia y viaje */}
        <div className="op-stats">
          <div className="op-stat op-stat--turquoise">
            <span className="op-stat__label">
              <CurrencyDollar size={16} weight="fill" /> Ganancia
            </span>
            <strong className="op-stat__value">{precio != null ? fmt$(precio) : "—"}</strong>
            {totalConRecargo && <em className="op-stat__extra">+ {fmt$(surcharge)} recargo</em>}
          </div>
          {fmtKm(distanciaKm) && (
            <div className="op-stat op-stat--lilac">
              <span className="op-stat__label">
                <MapPinLine size={16} weight="fill" /> Viaje total
              </span>
              <strong className="op-stat__value">{fmtKm(distanciaKm)}</strong>
            </div>
          )}
        </div>

        {/* Alerta efectivo — genérica, sin datos del cliente */}
        {requiresMoney && cashAmount > 0 && (
          <div className="op-cash-alert">
            <Warning size={20} weight="fill" />
            <span>
              Necesitás <strong>{fmt$(cashAmount)}</strong> en efectivo para este pedido.
            </span>
          </div>
        )}

        {/* Botones */}
        <div className="op-actions">
          <button type="button" className="op-btn op-btn--reject" onClick={() => onRechazar?.("driver_rejected")}>
            <X size={22} weight="bold" />
            <span>Rechazar</span>
          </button>
          <button type="button" className="op-btn op-btn--accept" onClick={() => onAceptar?.()}>
            <Check size={26} weight="bold" />
            <span>Aceptar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
