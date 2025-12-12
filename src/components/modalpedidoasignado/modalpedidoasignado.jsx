import { useEffect, useState } from "react";
import "./modalpedidoasignado.css";

function ModalPedidoAsignado({ pedido, segundos = 20, onAceptar, onRechazar, onTimeout }) {
  const [restante, setRestante] = useState(segundos);

useEffect(() => {
  // ⬅️ si no hay pedido, no arrancamos timer
  if (!pedido) return;

  setRestante(segundos);

  if (navigator.vibrate) {
    navigator.vibrate(200);
  }

  const interval = setInterval(() => {
    setRestante((prev) => {
      if (prev <= 1) {
        clearInterval(interval);
        // ⬅️ ahora SÍ pasamos el pedido
        if (onTimeout) onTimeout(pedido);
        return 0;
      }
      return prev - 1;
    });
  }, 1000);

  return () => clearInterval(interval);
}, [segundos, pedido, onTimeout]);


  if (!pedido) return null; // si no hay pedido, no mostramos el modal

  const handleAceptar = () => {
    if (onAceptar) onAceptar(pedido);
  };

  const handleRechazar = () => {
    if (onRechazar) onRechazar(pedido);
  };

  return (
    <div className="pedido-modal-overlay">
      <div className="pedido-modal">
        <div className="pedido-modal-header">
          <h2>Nuevo pedido asignado</h2>
        </div>

        <div className="pedido-modal-body">
          <p className="pedido-modal-text">
            Te asignaron un nuevo trámite. Tenés unos segundos para aceptarlo
            antes de que vuelva al sistema.
          </p>

          {/* Acá después mostramos datos reales del pedido */}
          <div className="pedido-resumen">
            <p><strong>ID pedido:</strong> {pedido.id || "—"}</p>
            <p><strong>Origen:</strong> {pedido.origen || "Local"}</p>
            <p><strong>Destino:</strong> {pedido.destino || "Destino pendiente"}</p>
          </div>

          <div className="pedido-contador">
            <span>Tiempo para responder</span>
            <div className="pedido-contador-num">
              {restante}s
            </div>
          </div>
        </div>

        <div className="pedido-modal-actions">
          <button className="pedido-btn-rechazar" onClick={handleRechazar}>
            Rechazar
          </button>
          <button className="pedido-btn-aceptar" onClick={handleAceptar}>
            Aceptar pedido
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalPedidoAsignado;
