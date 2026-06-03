// OfertaPantalla.jsx
// Pantalla COMPLETA de oferta — reemplaza el bottom sheet
// Diseño profesional: timer prominente, info clara, botones grandes

import { useEffect, useRef, useState } from "react";
import {
  MapPin, Clock, CurrencyDollar, ArrowRight,
  X, Check, Warning,
} from "@phosphor-icons/react";
import "./OfertaPantalla.css";

function fmt$(v) {
  return `$${(Number(v) || 0).toLocaleString("es-AR")}`;
}
function fmtKm(v) {
  const km = Number(v);
  return Number.isFinite(km) && km > 0 ? `${km.toFixed(1)} km` : "-";
}

// ── Anillo de countdown ────────────────────────────────────
function TimerRing({ remaining, total }) {
  const pct      = Math.max(0, remaining / total);
  const radius   = 36;
  const circ     = 2 * Math.PI * radius;
  const dashoff  = circ * (1 - pct);
  const color    = pct > 0.4 ? "#F59E0B" : "#EF4444";
  const secs     = Math.ceil(remaining);

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
          strokeDashoffset={dashoff}
          style={{ transform: "rotate(-90deg)", transformOrigin: "45px 45px", transition: "stroke-dashoffset 1s linear, stroke 0.3s" }}
        />
      </svg>
      <span className="op-timer-ring__secs" style={{ color }}>{secs}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────

export default function OfertaPantalla({
  oferta,
  ttlMs      = 20000,
  onAceptar,
  onRechazar,
}) {
  const [remaining, setRemaining] = useState(ttlMs);
  const startRef = useRef(Date.now());

  // Countdown
  useEffect(() => {
    startRef.current = Date.now();
    setRemaining(ttlMs);

    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const left    = Math.max(0, ttlMs - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(id);
    }, 250);

    return () => clearInterval(id);
  }, [oferta, ttlMs]);

  // Auto-rechazar cuando expira
  useEffect(() => {
    if (remaining <= 0) {
      onRechazar?.("expired");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  if (!oferta) return null;

  const order          = oferta.order || oferta;
  const serviceLabel   = order?.service?.label || order?.tipoTramite || "Envío";
  const precio         = order?.pricing?.price || order?.price;
  const distanciaKm    = order?.route?.distanceKm || order?.km;
  const pickupAddr     = order?.pickup?.address  || order?.origin  || "Origen";
  const dropoffAddr    = order?.dropoff?.address || order?.destination || "Destino";
  const requiresMoney  = order?.payment?.requiresMoney === true || Boolean(order?.payment?.cashAmount);
  const cashAmount     = order?.payment?.cashAmount || order?.payment?.requiredMoneyAmount || 0;
  const cashDirection  = order?.payment?.cashDirection;
  const paymentMethod  = order?.payment?.method;

  const isPagaCash = cashDirection === "driver_pays_pickup" && cashAmount > 0;

  return (
    <div className="op-overlay">
      <div className="op-screen">

        {/* Header — tipo + timer */}
        <div className="op-header">
          <div className="op-header__info">
            <p className="op-header__eyebrow">Nuevo pedido</p>
            <h2 className="op-header__title">{serviceLabel}</h2>
            {paymentMethod === "mercadopago" && (
              <span className="op-header__mp-badge">📱 MercadoPago</span>
            )}
          </div>
          <TimerRing remaining={remaining} total={ttlMs} />
        </div>

        {/* Métricas principales */}
        <div className="op-metrics">
          <div className="op-metric op-metric--price">
            <CurrencyDollar size={18} weight="fill" />
            <div>
              <span>Estimado</span>
              <strong>{precio ? fmt$(precio) : "-"}</strong>
            </div>
          </div>
          <div className="op-metric">
            <MapPin size={18} weight="fill" />
            <div>
              <span>Distancia</span>
              <strong>{fmtKm(distanciaKm)}</strong>
            </div>
          </div>
          {distanciaKm && (
            <div className="op-metric">
              <Clock size={18} weight="fill" />
              <div>
                <span>Est. tiempo</span>
                <strong>~{Math.round(Number(distanciaKm) * 3)} min</strong>
              </div>
            </div>
          )}
        </div>

        {/* Ruta */}
        <div className="op-route">
          <div className="op-route__point op-route__point--a">
            <span className="op-route__dot op-route__dot--a" />
            <div>
              <p className="op-route__label">Retirá en</p>
              <p className="op-route__addr">{pickupAddr}</p>
            </div>
          </div>
          <div className="op-route__line">
            <ArrowRight size={14} weight="bold" color="rgba(255,255,255,0.3)" />
          </div>
          <div className="op-route__point op-route__point--b">
            <span className="op-route__dot op-route__dot--b" />
            <div>
              <p className="op-route__label">Entregá en</p>
              <p className="op-route__addr">{dropoffAddr}</p>
            </div>
          </div>
        </div>

        {/* Alerta de efectivo si aplica */}
        {isPagaCash && (
          <div className="op-cash-alert">
            <Warning size={16} weight="fill" />
            <span>
              Debés pagar <strong>{fmt$(cashAmount)}</strong> para retirar el pedido.
              Asegurate de tener ese dinero disponible.
            </span>
          </div>
        )}

        {/* Botones */}
        <div className="op-actions">
          <button
            type="button"
            className="op-btn op-btn--reject"
            onClick={() => onRechazar?.("driver_rejected")}
          >
            <X size={24} weight="bold" />
            <span>Rechazar</span>
          </button>

          <button
            type="button"
            className="op-btn op-btn--accept"
            onClick={() => onAceptar?.()}
          >
            <Check size={24} weight="bold" />
            <span>Aceptar</span>
          </button>
        </div>

        {/* Nota */}
        <p className="op-note">
          La oferta expira automáticamente en {Math.ceil(ttlMs / 1000)} segundos
        </p>

      </div>
    </div>
  );
}
