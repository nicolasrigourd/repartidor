import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import { Package, CheckCircle, XCircle, MapPin } from "@phosphor-icons/react";
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

export default function PedidosPage() {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const historial = useLiveQuery(
    () => repartidorDb.historial.orderBy("createdAtMs").reverse().limit(100).toArray(),
    []
  );
  const statsHoy = useLiveQuery(() => repartidorDb.estadisticas.get(`hoy_${today}`),     [today]);
  const statsMes = useLiveQuery(() => repartidorDb.estadisticas.get(`mes_${thisMonth}`), [thisMonth]);

  const grouped = useMemo(() => {
    if (!historial) return [];
    const map = {};
    historial.forEach((p) => {
      const k = p.dateKey || "sin-fecha";
      if (!map[k]) map[k] = [];
      map[k].push(p);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [historial]);

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
      {!historial ? (
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
              <div key={order.id} className={`pp-item pp-item--${order.status}`}>
                <div className="pp-item__icon">
                  {order.status === "completed"
                    ? <CheckCircle size={20} weight="fill" color="#22c55e" />
                    : <XCircle    size={20} weight="fill" color="#ef4444" />}
                </div>
                <div className="pp-item__info">
                  <div className="pp-item__route">
                    <MapPin size={11} weight="fill" />
                    <span>
                      {order.pickup?.address || order.dropoff?.address || "Sin dirección"}
                    </span>
                  </div>
                  <span className="pp-item__time">{formatHour(order.createdAtMs)}</span>
                </div>
                <div className="pp-item__right">
                  {order.status === "completed"
                    ? <span className="pp-item__earn">{fmt$(order.earnings)}</span>
                    : <span className="pp-item__cancel">Cancelado</span>}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
