import { useEffect, useRef, useState } from "react";
import {
  MapPin, Clock, CurrencyDollar, ArrowDown,
  X, Check, Warning, Phone, SealPercent,
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
  const radius = 36;
  const circ   = 2 * Math.PI * radius;
  const color  = pct > 0.4 ? "#F59E0B" : "#EF4444";
  const secs   = Math.ceil(remaining / 1000);

  return (
    <div className="op-timer-ring">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6"/>
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transform: "rotate(-90deg)", transformOrigin: "45px 45px", transition: "stroke-dashoffset 0.25s linear, stroke 0.3s" }}
        />
      </svg>
      <span className="op-timer-ring__secs" style={{ color }}>{secs}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────

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

  if (!oferta) return null;

  // ── Todos los campos desde la RAÍZ del offer payload ──
  const serviceLabel  = oferta.service?.label || "Envío";
  const precio        = oferta.pricing?.price;
  const surcharge     = oferta.pricing?.surcharge;
  const distanciaKm   = oferta.route?.distanceKm;
  const durationMin   = oferta.route?.durationMin;

  const pickupAddr    = oferta.pickup?.address || "Origen";
  const pickupPhone   = oferta.pickup?.contact?.phone;
  const pickupNotes   = oferta.pickup?.notes;
  const pickupFloor   = [oferta.pickup?.floor, oferta.pickup?.apartment].filter(Boolean).join(" ");

  const dropoffAddr   = oferta.dropoff?.address || "Destino";
  const dropoffName   = oferta.dropoff?.contact?.fullName || oferta.recipient?.name;
  const dropoffPhone  = oferta.dropoff?.contact?.phone   || oferta.recipient?.phone;
  const dropoffNotes  = oferta.dropoff?.notes;

  const paymentMethod     = oferta.payment?.method;
  const requiresMoney     = oferta.payment?.requiresMoney === true || oferta.payment?.requiresCashHandling === true;
  const cashAmount        = oferta.payment?.requiredMoneyAmount || 0;

  const isMercadoPago = paymentMethod === "mercadopago";
  const totalConRecargo = surcharge > 0 && precio > 0 ? precio + surcharge : null;

  return (
    <div className="op-overlay">
      <div className="op-screen">

        {/* Header — tipo + timer */}
        <div className="op-header">
          <div className="op-header__info">
            <p className="op-header__eyebrow">Nuevo pedido</p>
            <h2 className="op-header__title">{serviceLabel}</h2>
            {isMercadoPago && (
              <span className="op-header__badge op-header__badge--mp">📱 MercadoPago</span>
            )}
          </div>
          <TimerRing remaining={remaining} total={ttlMs} />
        </div>

        {/* Métricas */}
        <div className="op-metrics">
          <div className="op-metric op-metric--price">
            <CurrencyDollar size={18} weight="fill" />
            <div>
              <span>Precio</span>
              <strong>{precio != null ? fmt$(precio) : "—"}</strong>
              {totalConRecargo && <em>+ {fmt$(surcharge)} recargo</em>}
            </div>
          </div>
          {fmtKm(distanciaKm) && (
            <div className="op-metric">
              <MapPin size={18} weight="fill" />
              <div>
                <span>Distancia</span>
                <strong>{fmtKm(distanciaKm)}</strong>
              </div>
            </div>
          )}
          {fmtMin(durationMin, distanciaKm) && (
            <div className="op-metric">
              <Clock size={18} weight="fill" />
              <div>
                <span>Tiempo est.</span>
                <strong>{fmtMin(durationMin, distanciaKm)}</strong>
              </div>
            </div>
          )}
        </div>

        {/* Ruta */}
        <div className="op-route">
          {/* Pickup */}
          <div className="op-route__point">
            <div className="op-route__dot op-route__dot--a" />
            <div className="op-route__detail">
              <p className="op-route__label">Retirá en</p>
              <p className="op-route__addr">{pickupAddr}</p>
              {pickupFloor   && <p className="op-route__sub">Piso/Dpto: {pickupFloor}</p>}
              {pickupNotes   && <p className="op-route__sub op-route__sub--note">📝 {pickupNotes}</p>}
              {pickupPhone   && (
                <p className="op-route__sub op-route__sub--phone">
                  <Phone size={11} weight="fill" /> {pickupPhone}
                </p>
              )}
            </div>
          </div>

          <div className="op-route__connector">
            <ArrowDown size={14} weight="bold" color="rgba(255,255,255,0.25)" />
          </div>

          {/* Dropoff */}
          <div className="op-route__point">
            <div className="op-route__dot op-route__dot--b" />
            <div className="op-route__detail">
              <p className="op-route__label">Entregá a</p>
              {dropoffName   && <p className="op-route__name">{dropoffName}</p>}
              <p className="op-route__addr">{dropoffAddr}</p>
              {dropoffNotes  && <p className="op-route__sub op-route__sub--note">📝 {dropoffNotes}</p>}
              {dropoffPhone  && (
                <p className="op-route__sub op-route__sub--phone">
                  <Phone size={11} weight="fill" /> {dropoffPhone}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Alerta efectivo */}
        {requiresMoney && cashAmount > 0 && (
          <div className="op-cash-alert">
            <Warning size={16} weight="fill" />
            <span>
              Necesitás <strong>{fmt$(cashAmount)}</strong> en efectivo para retirar el pedido.
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
            <Check size={22} weight="bold" />
            <span>Aceptar</span>
          </button>
        </div>

        <p className="op-note">La oferta expira en {Math.ceil(ttlMs / 1000)} segundos</p>
      </div>
    </div>
  );
}
