import { WifiSlash } from "@phosphor-icons/react";
import "./ModalSinConexion.css";

export default function ModalSinConexion({ open, onCerrar }) {
  if (!open) return null;

  return (
    <div className="sin-conexion-modal-overlay" role="dialog" aria-modal="true">
      <div className="sin-conexion-modal-card">
        <div className="sin-conexion-modal-icon">
          <WifiSlash size={26} weight="fill" />
        </div>

        <h2>Sin conexión a internet</h2>
        <p>
          Necesitás internet para conectarte y recibir pedidos. Activá tus datos
          móviles o conectate a una red WiFi y volvé a intentar.
        </p>

        <button className="sin-conexion-modal-btn" onClick={onCerrar}>
          Entendido
        </button>
      </div>
    </div>
  );
}
