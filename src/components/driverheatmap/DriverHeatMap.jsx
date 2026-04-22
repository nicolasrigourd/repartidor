// src/components/driverheatmap/DriverHeatMap.jsx

import "./DriverHeatMap.css";

const DEFAULT_ZONES = [
  {
    id: "centro",
    label: "Centro",
    level: "high",
    message: "Zona recomendada",
    hint: "Mayor actividad probable",
    position: "leftTop",
    intensity: 8,
  },
  {
    id: "norte",
    label: "B° Norte",
    level: "medium",
    message: "Actividad moderada",
    hint: "Buena zona de espera",
    position: "rightMiddle",
    intensity: 5,
  },
  {
    id: "banda",
    label: "La Banda",
    level: "low",
    message: "En monitoreo",
    hint: "Mantenete disponible",
    position: "leftBottom",
    intensity: 2,
  },
];

function getWorkStatusCopy(workStatus) {
  if (workStatus === "busy") {
    return {
      mapLabel: "Pedido activo",
      mapHint: "Zeus está siguiendo tu recorrido",
      markerClass: "driver-heat-marker--busy",
    };
  }

  if (workStatus === "online") {
    return {
      mapLabel: "Disponible",
      mapHint: "Zeus te tendrá en cuenta para próximos matches",
      markerClass: "driver-heat-marker--online",
    };
  }

  if (workStatus === "starting") {
    return {
      mapLabel: "Activando GPS",
      mapHint: "Preparando tu disponibilidad",
      markerClass: "driver-heat-marker--starting",
    };
  }

  if (workStatus === "error") {
    return {
      mapLabel: "Revisar GPS",
      mapHint: "No pudimos confirmar tu ubicación",
      markerClass: "driver-heat-marker--error",
    };
  }

  return {
    mapLabel: "Offline",
    mapHint: "Conectate para recibir pedidos",
    markerClass: "driver-heat-marker--offline",
  };
}

function getGpsLabel(geoStatus) {
  if (geoStatus === "granted") return "GPS activo";
  if (geoStatus === "searching") return "Buscando GPS";
  if (geoStatus === "denied") return "GPS denegado";
  if (geoStatus === "unavailable") return "GPS no disponible";
  if (geoStatus === "error") return "Error GPS";
  return "GPS inactivo";
}

function getZonePositionClass(position) {
  const map = {
    leftTop: "driver-heat-zone--left-top",
    rightTop: "driver-heat-zone--right-top",
    leftMiddle: "driver-heat-zone--left-middle",
    rightMiddle: "driver-heat-zone--right-middle",
    leftBottom: "driver-heat-zone--left-bottom",
    rightBottom: "driver-heat-zone--right-bottom",
    center: "driver-heat-zone--center",
  };

  return map[position] || map.center;
}

function getZoneLevelClass(level) {
  const map = {
    veryHigh: "driver-heat-zone--very-high",
    high: "driver-heat-zone--high",
    medium: "driver-heat-zone--medium",
    low: "driver-heat-zone--low",
    monitor: "driver-heat-zone--monitor",
  };

  return map[level] || map.monitor;
}

export default function DriverHeatMap({
  ficha = {},
  repartidorId,
  nombreCompleto = "",
  workStatus = "offline",
  geoStatus = "idle",
  liveCoords = null,
  pedidoActivo = null,
  heatZones = DEFAULT_ZONES,
  onLogout,
  onSelectZone,
}) {
  const statusCopy = getWorkStatusCopy(workStatus);
  const gpsLabel = getGpsLabel(geoStatus);

  const hasLiveCoords = Boolean(liveCoords);
  const isOnline = workStatus === "online";
  const isBusy = workStatus === "busy";
  const hasPedidoActivo = Boolean(pedidoActivo);

  const avatarLetter = String(ficha?.nombre || nombreCompleto || "R")
    .charAt(0)
    .toUpperCase();

  const handleZoneClick = (zone) => {
    onSelectZone?.(zone);
  };

  return (
    <section
      className={`driver-heat-stage driver-heat-stage--${workStatus}`}
      aria-label="Mapa operativo del repartidor"
    >
      <div className="driver-heat-grid" aria-hidden="true" />
      <div className="driver-heat-glow driver-heat-glow--one" aria-hidden="true" />
      <div className="driver-heat-glow driver-heat-glow--two" aria-hidden="true" />
      <div className="driver-heat-route driver-heat-route--one" aria-hidden="true" />
      <div className="driver-heat-route driver-heat-route--two" aria-hidden="true" />

      {heatZones.map((zone) => (
        <button
          key={zone.id}
          type="button"
          className={`driver-heat-zone ${getZonePositionClass(
            zone.position
          )} ${getZoneLevelClass(zone.level)}`}
          onClick={() => handleZoneClick(zone)}
          title={zone.label}
        >
          <span className="driver-heat-zone-pulse" aria-hidden="true" />
          <strong>{zone.label}</strong>
          <span>{zone.message}</span>
        </button>
      ))}

      {hasPedidoActivo && (
        <>
          <div className="driver-order-pin driver-order-pin--origin">
            <strong>A</strong>
            <span>Origen</span>
          </div>

          <div className="driver-order-pin driver-order-pin--destination">
            <strong>B</strong>
            <span>Destino</span>
          </div>

          <div className="driver-active-route" aria-hidden="true" />
        </>
      )}

      <div
        className={`driver-heat-marker ${statusCopy.markerClass}`}
        aria-label="Ubicación del repartidor"
      >
        <span />
        <strong>
          {ficha?.movilidad || (isBusy ? "En pedido" : "Cadete")}
        </strong>
      </div>

      <header className="driver-floating-header">
        <div className="driver-avatar">
          {ficha?.fotoPerfil ? (
            <img src={ficha.fotoPerfil} alt={nombreCompleto || "Repartidor"} />
          ) : (
            <span>{avatarLetter}</span>
          )}
        </div>

        <div className="driver-header-info">
          <strong>{nombreCompleto || "Repartidor"}</strong>
          <span>
            ID {ficha?.id || repartidorId} · {ficha?.movilidad || "Movilidad"} ·{" "}
            {ficha?.sucursal || "Sucursal"}
          </span>
        </div>

        <button className="driver-header-logout" onClick={onLogout}>
          Salir
        </button>
      </header>

      <div className="driver-heat-status-card">
        <span
          className={`driver-heat-status-dot driver-heat-status-dot--${workStatus}`}
          aria-hidden="true"
        />
        <div>
          <strong>{statusCopy.mapLabel}</strong>
          <span>{statusCopy.mapHint}</span>
        </div>
      </div>

      <div className="driver-map-chip driver-map-chip--left">
        {gpsLabel}
      </div>

      <div className="driver-map-chip driver-map-chip--right">
        {hasLiveCoords ? "Ubicación enviada" : "Sin señal"}
      </div>

      {isOnline && !hasPedidoActivo && (
        <div className="driver-heat-suggestion">
          <span>Zona sugerida</span>
          <strong>
            {heatZones.find((z) => z.level === "high" || z.level === "veryHigh")
              ?.label || "En monitoreo"}
          </strong>
        </div>
      )}
    </section>
  );
}