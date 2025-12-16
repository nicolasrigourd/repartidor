import { useEffect, useMemo, useState } from "react";
import "./modalpedidoasignado.css";

function ModalPedidoAsignado({ pedido, segundos = 20, onAceptar, onRechazar, onTimeout }) {
  const [restante, setRestante] = useState(segundos);

  const resumen = useMemo(() => {
    if (!pedido) return null;

    return {
      id: pedido.id || pedido?.offer?.orderId || "—",
      origen: pedido.origin || pedido?.customerDefaultAddress?.address || "—",
      destino: pedido.destination || pedido?.destination || "—",
      precio: pedido.price ?? pedido?.breakdown?.total ?? null,
      km: pedido.km ?? pedido?.breakdown?.km ?? null,
    };
  }, [pedido]);

  useEffect(() => {
    if (!pedido) return;

    setRestante(segundos);

    if (navigator.vibrate) navigator.vibrate(200);

    const interval = setInterval(() => {
      setRestante((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (onTimeout) onTimeout(pedido);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [segundos, pedido, onTimeout]);

  if (!pedido || !resumen) return null;

  const handleAceptar = () => onAceptar?.(pedido);
  const handleRechazar = () => onRechazar?.(pedido);

  return (
    <div className="pedido-modal-overlay">
      <div className="pedido-modal">
        <div className="pedido-modal-header">
          <h2>Nuevo pedido</h2>
        </div>

        <div className="pedido-modal-body">
          <p className="pedido-modal-text">
            Tenés {segundos}s para aceptar o rechazar.
          </p>

          <div className="pedido-resumen">
            <p><strong>ID:</strong> {resumen.id}</p>
            {resumen.precio != null && (
              <p><strong>Precio:</strong> ${Number(resumen.precio).toLocaleString("es-AR")}</p>
            )}
            {resumen.km != null && (
              <p><strong>Distancia:</strong> {Number(resumen.km).toFixed(2)} km</p>
            )}
            <p><strong>Origen:</strong> {resumen.origen}</p>
            <p><strong>Destino:</strong> {resumen.destino}</p>
          </div>

          <div className="pedido-contador">
            <span>Tiempo para responder</span>
            <div className="pedido-contador-num">{restante}s</div>
          </div>
        </div>

        <div className="pedido-modal-actions">
          <button className="pedido-btn-rechazar" onClick={handleRechazar}>
            Rechazar
          </button>
          <button className="pedido-btn-aceptar" onClick={handleAceptar}>
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalPedidoAsignado;
