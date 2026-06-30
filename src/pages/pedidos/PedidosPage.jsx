import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import { Package, CheckCircle, XCircle, MapPin, Trash } from "@phosphor-icons/react";
import "./PedidosPage.css";

function formatDateLabel(dateKey) {
  if (!dateKey) return "Sin fecha";
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateKey === today)     return "Hoy";
  if (dateKey === yesterday) return "Ayer";
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

function fmt$(v) {
  return `$${(Number(v) || 0).toLocaleString("es-AR")}`;
}

function formatHour(ms) {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function paymentLabel(payment) {
  const method = payment?.method;
  return method === "mercadopago" ? "MercadoPago" : "Efectivo";
}

const SWIPE_THRESHOLD = 90;
const SWIPE_MAX_DRAG  = 120;
const SWIPE_OUT       = 400;

// Deslizar para ocultar — solo pedidos de días anteriores (no el de hoy).
// No borra nada de Firestore, solo guarda el id en "historialOcultos" para
// filtrarlo siempre del listado local.
function SwipeablePedidoItem({ order, disabled, onHide, children }) {
  const [dragX, setDragX]       = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef   = useRef(0);
  const draggingRef = useRef(false);

  const handleTouchStart = (e) => {
    if (disabled) return;
    startXRef.current = e.touches[0].clientX;
    draggingRef.current = true;
    setDragging(true);
  };

  const handleTouchMove = (e) => {
    if (disabled || !draggingRef.current) return;
    const dx = e.touches[0].clientX - startXRef.current;
    setDragX(Math.max(-SWIPE_MAX_DRAG, Math.min(SWIPE_MAX_DRAG, dx)));
  };

  const handleTouchEnd = () => {
    if (disabled || !draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);

    if (Math.abs(dragX) >= SWIPE_THRESHOLD) {
      setDragX(dragX > 0 ? SWIPE_OUT : -SWIPE_OUT);
      setTimeout(() => onHide(order.id), 180);
    } else {
      setDragX(0);
    }
  };

  return (
    <div className="pp-swipe-wrap">
      {!disabled && (
        <div className="pp-swipe-bg">
          <Trash size={18} weight="fill" />
          <span>Quitar de la lista</span>
        </div>
      )}
      <div
        className="pp-swipe-content"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 0.2s ease",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default function PedidosPage() {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const historial = useLiveQuery(
    () => repartidorDb.historial.orderBy("createdAtMs").reverse().limit(100).toArray(),
    []
  );
  const ocultos = useLiveQuery(() => repartidorDb.historialOcultos.toArray(), []);
  const statsHoy = useLiveQuery(() => repartidorDb.estadisticas.get(`hoy_${today}`),     [today]);
  const statsMes = useLiveQuery(() => repartidorDb.estadisticas.get(`mes_${thisMonth}`), [thisMonth]);

  const ocultosSet = useMemo(
    () => new Set((ocultos || []).map((o) => o.id)),
    [ocultos]
  );

  const visibleHistorial = useMemo(() => {
    if (!historial) return historial;
    return historial.filter((o) => !ocultosSet.has(o.id));
  }, [historial, ocultosSet]);

  const grouped = useMemo(() => {
    if (!visibleHistorial) return [];
    const map = {};
    visibleHistorial.forEach((p) => {
      const k = p.dateKey || "sin-fecha";
      if (!map[k]) map[k] = [];
      map[k].push(p);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [visibleHistorial]);

  const [undoToast, setUndoToast] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const handleHide = useCallback(async (id) => {
    await repartidorDb.historialOcultos.put({ id });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ id });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast((prev) => {
      if (prev?.id) repartidorDb.historialOcultos.delete(prev.id).catch(() => {});
      return null;
    });
  }, []);

  return (
    <div className="pp-root">
      {/* Barra de stats */}
      <div className="pp-stats">
        <div className="pp-stat">
          <strong>{statsHoy?.pedidosCompletados ?? 0}</strong>
          <span>Hoy</span>
        </div>
        <div className="pp-stat pp-stat--green">
          <strong>{fmt$(statsHoy?.gananciaTotal)}</strong>
          <span>Ganancia hoy</span>
        </div>
        <div className="pp-stat">
          <strong>{statsMes?.pedidosCompletados ?? 0}</strong>
          <span>Este mes</span>
        </div>
        <div className="pp-stat pp-stat--green">
          <strong>{fmt$(statsMes?.gananciaTotal)}</strong>
          <span>Mes $</span>
        </div>
      </div>

      {/* Lista */}
      {!visibleHistorial ? (
        <div className="pp-empty"><Package size={32} weight="thin" /><span>Cargando...</span></div>
      ) : grouped.length === 0 ? (
        <div className="pp-empty">
          <Package size={36} weight="thin" />
          <span>Sin pedidos todavía</span>
          <small>Tus entregas completadas aparecerán aquí.</small>
        </div>
      ) : (
        grouped.map(([dateKey, orders]) => (
          <div key={dateKey} className="pp-group">
            <div className="pp-group__header">
              <span className="pp-group__date">{formatDateLabel(dateKey)}</span>
              <span className="pp-group__count">
                {orders.filter(o => o.status === "completed").length} completados
              </span>
            </div>
            {orders.map((order) => (
              <SwipeablePedidoItem
                key={order.id}
                order={order}
                disabled={dateKey === today}
                onHide={handleHide}
              >
                <div className={`pp-item pp-item--${order.status}`}>
                  <div className="pp-item__icon">
                    {order.status === "completed"
                      ? <CheckCircle size={20} weight="fill" color="#22c55e" />
                      : <XCircle    size={20} weight="fill" color="#ef4444" />}
                  </div>
                  <div className="pp-item__info">
                    <div className="pp-item__route">
                      <MapPin size={11} weight="fill" />
                      <span>
                        {order.originName || order.pickup?.address || "Origen"}
                        {" → "}
                        {order.destinationName || order.dropoff?.address || "Destino"}
                      </span>
                    </div>
                    <div className="pp-item__meta">
                      <span className="pp-item__type">{order.orderType || "Envío"}</span>
                      <span className="pp-item__time">{formatHour(order.createdAtMs)}</span>
                    </div>
                  </div>
                  <div className="pp-item__right">
                    {order.status === "completed"
                      ? <span className="pp-item__earn">{fmt$(order.earnings)}</span>
                      : <span className="pp-item__cancel">Cancelado</span>}
                    <span className="pp-item__payment">{paymentLabel(order.payment)}</span>
                  </div>
                </div>
              </SwipeablePedidoItem>
            ))}
          </div>
        ))
      )}

      {undoToast && (
        <div className="pp-undo-toast">
          <span>Pedido quitado de la lista</span>
          <button onClick={handleUndo}>Deshacer</button>
        </div>
      )}
    </div>
  );
}
