import React, { useMemo } from "react";
import "./cardpedidoactivo.css";

function buildGoogleMapsUrl({ lat, lng, label }) {
  if (lat == null || lng == null) return null;
  const q = encodeURIComponent(`${lat},${lng}${label ? ` (${label})` : ""}`);
  return `https://www.google.com/maps?q=${q}`;
}

function buildGoogleMapsDirectionsUrl(from, to) {
  // from/to: {lat,lng}
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) return null;
  const origin = `${from.lat},${from.lng}`;
  const dest = `${to.lat},${to.lng}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    origin
  )}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}

function CardPedidoActivo({ pedido, onFinalizar }) {
  const data = useMemo(() => {
    if (!pedido) return null;

    const originText =
      pedido.origin ||
      pedido?.customerDefaultAddress?.address ||
      "—";

    const destinationText =
      pedido.destination ||
      pedido?.destination ||
      "—";

    const fromCoords =
      pedido.originCoords ||
      pedido?.customerDefaultAddress
        ? {
            lat: pedido?.originCoords?.lat ?? pedido?.customerDefaultAddress?.lat,
            lng: pedido?.originCoords?.lng ?? pedido?.customerDefaultAddress?.lng,
          }
        : null;

    const toCoords = pedido.destinationCoords
      ? { lat: pedido.destinationCoords.lat, lng: pedido.destinationCoords.lng }
      : null;

    const notesFrom =
      pedido?.notes?.origen ||
      pedido?.notesFrom ||
      (pedido?.notes?.notesFrom ?? "") ||
      "";

    const notesTo =
      pedido?.notes?.destino ||
      pedido?.notesTo ||
      (pedido?.notes?.notesTo ?? "") ||
      "";

    const recipientName = pedido?.recipient?.name || "—";
    const recipientPhone = pedido?.recipient?.phone || pedido?.contactTo || "—";

    const contactFrom = pedido?.contactFrom || "—";
    const contactTo = pedido?.contactTo || "—";

    const price = pedido?.price ?? pedido?.breakdown?.total ?? null;
    const km = pedido?.km ?? pedido?.breakdown?.km ?? null;

    const serviceType = pedido?.serviceType || pedido?.recipient?.serviceType || "—";
    const size = pedido?.size || pedido?.recipient?.size || "—";

    return {
      id: pedido.id || "—",
      originText,
      destinationText,
      notesFrom,
      notesTo,
      recipientName,
      recipientPhone,
      contactFrom,
      contactTo,
      price,
      km,
      serviceType,
      size,
      fromCoords,
      toCoords,
    };
  }, [pedido]);

  if (!pedido || !data) return null;

  const mapsOrigin = buildGoogleMapsUrl({
    lat: data.fromCoords?.lat,
    lng: data.fromCoords?.lng,
    label: "Origen",
  });

  const mapsDest = buildGoogleMapsUrl({
    lat: data.toCoords?.lat,
    lng: data.toCoords?.lng,
    label: "Destino",
  });

  const mapsDir = buildGoogleMapsDirectionsUrl(data.fromCoords, data.toCoords);

  const callNumber = (num) => {
    if (!num || num === "—") return;
    // En mobile abre la app de teléfono
    window.location.href = `tel:${String(num).replace(/\s/g, "")}`;
  };

  return (
    <section className="pedido-card">
      <div className="pedido-card-head">
        <div>
          <div className="pedido-card-title">Pedido activo</div>
          <div className="pedido-card-sub">ID: {data.id}</div>
        </div>

        <div className="pedido-card-metrics">
          {data.km != null && (
            <span className="badge">
              {Number(data.km).toFixed(2)} km
            </span>
          )}
          {data.price != null && (
            <span className="badge badge-green">
              ${Number(data.price).toLocaleString("es-AR")}
            </span>
          )}
        </div>
      </div>

      <div className="pedido-card-block">
        <div className="pedido-row">
          <span className="pedido-label">Origen</span>
          <span className="pedido-value">{data.originText}</span>
        </div>
        {data.notesFrom ? (
          <div className="pedido-notes">
            <span className="pedido-notes-label">Nota</span>
            <span className="pedido-notes-text">{data.notesFrom}</span>
          </div>
        ) : null}
      </div>

      <div className="pedido-card-block">
        <div className="pedido-row">
          <span className="pedido-label">Destino</span>
          <span className="pedido-value">{data.destinationText}</span>
        </div>
        {data.notesTo ? (
          <div className="pedido-notes">
            <span className="pedido-notes-label">Nota</span>
            <span className="pedido-notes-text">{data.notesTo}</span>
          </div>
        ) : null}
      </div>

      <div className="pedido-card-block">
        <div className="pedido-row">
          <span className="pedido-label">Destinatario</span>
          <span className="pedido-value">{data.recipientName}</span>
        </div>

        <div className="pedido-actions-grid">
          <button className="btn-ghost" onClick={() => callNumber(data.recipientPhone)}>
            Llamar destinatario
          </button>
          <button className="btn-ghost" onClick={() => callNumber(data.contactFrom)}>
            Llamar origen
          </button>
        </div>
      </div>

      <div className="pedido-card-block">
        <div className="pedido-meta">
          <div className="meta-item">
            <span className="meta-label">Servicio</span>
            <span className="meta-value">{data.serviceType}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Tamaño</span>
            <span className="meta-value">{data.size}</span>
          </div>
        </div>
      </div>

      <div className="pedido-card-footer">
        <div className="pedido-nav-grid">
          <a
            className={`btn-primary ${!mapsOrigin ? "is-disabled" : ""}`}
            href={mapsOrigin || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => !mapsOrigin && e.preventDefault()}
          >
            Ver origen
          </a>

          <a
            className={`btn-primary ${!mapsDest ? "is-disabled" : ""}`}
            href={mapsDest || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => !mapsDest && e.preventDefault()}
          >
            Ver destino
          </a>

          <a
            className={`btn-primary ${!mapsDir ? "is-disabled" : ""}`}
            href={mapsDir || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => !mapsDir && e.preventDefault()}
          >
            Ruta completa
          </a>
        </div>

        <button className="btn-danger" onClick={() => onFinalizar?.(pedido)}>
          Finalizar pedido
        </button>
      </div>
    </section>
  );
}

export default CardPedidoActivo;
