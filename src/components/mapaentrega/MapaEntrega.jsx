import { useEffect, useRef } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapaEntrega.css";

function crearIconoDestino(tipo = "pickup") {
  const clase = tipo === "pickup" ? "me-pin--pickup" : "me-pin--dropoff";
  const texto = tipo === "pickup" ? "O" : "D";
  return L.divIcon({
    className: `me-pin ${clase}`,
    html: `<span>${texto}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const iconoRepartidor = L.divIcon({
  className: "me-pin-repartidor",
  html: `<span></span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Sigue al repartidor en el mapa mientras se mueve, salvo que el usuario
// haya arrastrado el mapa a mano (ahí dejamos de forzar el centrado).
function SeguirRepartidor({ posicion, siguiendo }) {
  const map = useMap();

  useEffect(() => {
    if (!posicion || !siguiendo) return;
    map.panTo([posicion.lat, posicion.lng], { animate: true });
  }, [map, posicion, siguiendo]);

  return null;
}

// Ajusta el zoom/encuadre una sola vez cuando llega una ruta nueva.
function EncuadrarRuta({ polyline }) {
  const map = useMap();
  const yaEncuadroRef = useRef(null);

  useEffect(() => {
    if (!polyline || polyline.length < 2) return;
    const key = polyline.length + ":" + polyline[0].lat;
    if (yaEncuadroRef.current === key) return;
    yaEncuadroRef.current = key;

    const bounds = L.latLngBounds(polyline.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
  }, [map, polyline]);

  return null;
}

function MapaEntrega({ posicionActual, destino, tipoDestino = "pickup", polyline = [], siguiendo = true }) {
  const centroInicial = posicionActual
    ? [posicionActual.lat, posicionActual.lng]
    : destino
    ? [destino.lat, destino.lng]
    : [-27.783357, -64.264167];

  return (
    <div className="me-mapa">
      <MapContainer
        center={centroInicial}
        zoom={16}
        zoomControl={false}
        attributionControl={false}
        className="me-mapa__container"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {polyline.length > 1 && (
          <Polyline
            positions={polyline.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#2DD4BF", weight: 6, opacity: 0.9 }}
          />
        )}

        {destino && (
          <Marker position={[destino.lat, destino.lng]} icon={crearIconoDestino(tipoDestino)}>
            <Tooltip direction="top" offset={[0, -14]} opacity={1}>
              {tipoDestino === "pickup" ? "Retirar acá" : "Entregar acá"}
            </Tooltip>
          </Marker>
        )}

        {posicionActual && (
          <Marker position={[posicionActual.lat, posicionActual.lng]} icon={iconoRepartidor} />
        )}

        <SeguirRepartidor posicion={posicionActual} siguiendo={siguiendo} />
        <EncuadrarRuta polyline={polyline} />
      </MapContainer>
    </div>
  );
}

export default MapaEntrega;
