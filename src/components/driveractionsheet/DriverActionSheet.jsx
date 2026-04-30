import { useEffect, useMemo, useRef, useState } from "react";
import "./DriverActionSheet.css";

const SHEET_COLLAPSED = "collapsed";
const SHEET_PEEK = "peek";
const SHEET_EXPANDED = "expanded";

function formatMoney(value) {
  if (value == null || value === "") return null;

  const num = Number(value);
  if (Number.isNaN(num)) return null;

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(num);
}

function getPedidoResumen(pedido) {
  if (!pedido) return null;

  return {
    id: pedido.orderId || pedido.id || pedido?._docId || "—",
    origen:
      pedido?.pickup?.address ||
      pedido.originInput ||
      pedido.origin ||
      pedido?.customerDefaultAddress?.address ||
      pedido?.customerSnapshot?.direccion ||
      "Origen no informado",
    destino:
      pedido?.dropoff?.address ||
      pedido.destinationInput ||
      pedido.destination ||
      pedido?.destinationAddress?.address ||
      "Destino no informado",
    precio: pedido.price ?? pedido?.breakdown?.total ?? null,
    km: pedido.km ?? pedido?.breakdown?.km ?? null,
    tipo: pedido.type || pedido.serviceType || pedido.tipo || "Envío",
  };
}

function getStatusCopy({ workStatus, geoStatus, pedidoOfertado, pedidoActivo }) {
  if (pedidoOfertado) {
    return {
      title: "Nueva oferta de Zeus",
      subtitle: "Respondé antes de que expire el tiempo.",
      pill: "Oferta",
      tone: "offer",
      collapsed: "Nueva oferta",
    };
  }

  if (pedidoActivo) {
    return {
      title: "Pedido activo",
      subtitle: "Tenés un envío asignado en curso.",
      pill: "En curso",
      tone: "active",
      collapsed: "Pedido activo",
    };
  }

  if (workStatus === "online") {
    return {
      title: "Zeus monitoreando",
      subtitle: "Mantenete disponible cerca de zonas recomendadas.",
      pill: "Disponible",
      tone: "online",
      collapsed: "Zeus monitoreando",
    };
  }

  if (workStatus === "starting") {
    return {
      title: "Activando GPS",
      subtitle: "Estamos preparando tu disponibilidad.",
      pill: "Conectando",
      tone: "starting",
      collapsed: "Activando GPS",
    };
  }

  if (workStatus === "error" || geoStatus === "denied" || geoStatus === "error") {
    return {
      title: "Revisar ubicación",
      subtitle: "Necesitamos GPS activo para asignarte pedidos.",
      pill: "Revisar",
      tone: "error",
      collapsed: "GPS pendiente",
    };
  }

  return {
    title: "Sin pedido activo",
    subtitle: "Conectate para que Zeus pueda considerarte.",
    pill: "Offline",
    tone: "idle",
    collapsed: "Sin pedido activo",
  };
}

function getNextSheetMode(currentMode, direction) {
  if (direction === "up") {
    if (currentMode === SHEET_COLLAPSED) return SHEET_PEEK;
    if (currentMode === SHEET_PEEK) return SHEET_EXPANDED;
    return SHEET_EXPANDED;
  }

  if (direction === "down") {
    if (currentMode === SHEET_EXPANDED) return SHEET_PEEK;
    if (currentMode === SHEET_PEEK) return SHEET_COLLAPSED;
    return SHEET_COLLAPSED;
  }

  return currentMode;
}

function getOfferKey(pedido) {
  if (!pedido) return "";

  const orderId = pedido?.orderId || pedido?.id || pedido?._docId || "";
  const offeredAt = pedido?.offeredAt || "";

  return `${orderId}__${offeredAt}`;
}

function getRemainingSeconds(pedido, fallbackSeconds) {
  if (!pedido?.expiresAt) return fallbackSeconds;

  const diffMs = Number(pedido.expiresAt) - Date.now();
  const diffSeconds = Math.ceil(diffMs / 1000);

  return Math.max(0, diffSeconds);
}

function DriverActionSheet({
  workStatus = "offline",
  geoStatus = "idle",
  geoError = "",
  pedidoOfertado = null,
  pedidoActivo = null,
  segundosOferta = 20,
  onAceptarOferta,
  onRechazarOferta,
  onTimeoutOferta,
  onFinalizarPedido,
}) {
  const [sheetMode, setSheetMode] = useState(SHEET_PEEK);
  const [restante, setRestante] = useState(segundosOferta);

  const dragRef = useRef({
    startY: 0,
    currentY: 0,
    dragging: false,
  });

  const processedOfferKeyRef = useRef("");
  const announcedOfferKeyRef = useRef("");
  const timeoutHandledKeyRef = useRef("");
  const intervalRef = useRef(null);
  const audioRef = useRef(null);

  const resumenOferta = useMemo(
    () => getPedidoResumen(pedidoOfertado),
    [pedidoOfertado]
  );

  const resumenActivo = useMemo(
    () => getPedidoResumen(pedidoActivo),
    [pedidoActivo]
  );

  const activeOfferKey = useMemo(
    () => getOfferKey(pedidoOfertado),
    [pedidoOfertado]
  );

  const statusCopy = useMemo(
    () =>
      getStatusCopy({
        workStatus,
        geoStatus,
        pedidoOfertado,
        pedidoActivo,
      }),
    [workStatus, geoStatus, pedidoOfertado, pedidoActivo]
  );

  useEffect(() => {
    audioRef.current = new Audio("/sounds/oferta.mp3");
    audioRef.current.preload = "auto";

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pedidoOfertado || !activeOfferKey) {
      processedOfferKeyRef.current = "";
      announcedOfferKeyRef.current = "";
      timeoutHandledKeyRef.current = "";
      setRestante(segundosOferta);

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      return;
    }

    const initialRemaining = getRemainingSeconds(pedidoOfertado, segundosOferta);
    setRestante(initialRemaining);

    if (announcedOfferKeyRef.current !== activeOfferKey) {
      announcedOfferKeyRef.current = activeOfferKey;
      timeoutHandledKeyRef.current = "";

      setSheetMode(SHEET_EXPANDED);

      if (navigator.vibrate) {
        try {
          navigator.vibrate([250, 120, 250]);
        } catch (error) {
          console.warn("⚠️ Vibración no disponible:", error);
        }
      }

      if (audioRef.current) {
        try {
          audioRef.current.currentTime = 0;
          const playPromise = audioRef.current.play();

          if (playPromise?.catch) {
            playPromise.catch((error) => {
              console.warn("⚠️ No se pudo reproducir el sonido de oferta:", error);
            });
          }
        } catch (error) {
          console.warn("⚠️ Error reproduciendo sonido de oferta:", error);
        }
      }

      console.log("[SHEET] nueva oferta detectada", {
        activeOfferKey,
        pedidoOfertado,
      });
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      const nextRemaining = getRemainingSeconds(pedidoOfertado, segundosOferta);
      setRestante(nextRemaining);

      if (nextRemaining <= 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        if (
          activeOfferKey &&
          timeoutHandledKeyRef.current !== activeOfferKey &&
          processedOfferKeyRef.current !== activeOfferKey
        ) {
          timeoutHandledKeyRef.current = activeOfferKey;
          processedOfferKeyRef.current = activeOfferKey;

          console.log("[SHEET] timeout oferta", {
            activeOfferKey,
            pedidoOfertado,
          });

          onTimeoutOferta?.(pedidoOfertado);
        }
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeOfferKey, pedidoOfertado, segundosOferta, onTimeoutOferta]);

  useEffect(() => {
    if (pedidoActivo) {
      setSheetMode(SHEET_PEEK);
    }
  }, [pedidoActivo]);

  const handlePointerDown = (event) => {
    if (event.target.closest(".driver-action-btn")) return;

    dragRef.current = {
      startY: event.clientY,
      currentY: event.clientY,
      dragging: true,
    };
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current.dragging) return;
    dragRef.current.currentY = event.clientY;
  };

  const handlePointerUp = () => {
    if (!dragRef.current.dragging) return;

    const diff = dragRef.current.currentY - dragRef.current.startY;
    const threshold = 28;

    if (diff < -threshold) {
      setSheetMode((current) => getNextSheetMode(current, "up"));
    }

    if (diff > threshold) {
      setSheetMode((current) => getNextSheetMode(current, "down"));
    }

    dragRef.current.dragging = false;
  };

  const handleSheetTap = (event) => {
    if (event.target.closest(".driver-action-btn")) return;

    if (sheetMode === SHEET_COLLAPSED) {
      setSheetMode(SHEET_PEEK);
    }
  };

  const handleAceptarOferta = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!pedidoOfertado || !activeOfferKey) return;

    if (processedOfferKeyRef.current === activeOfferKey) {
      console.log("[SHEET] aceptar ignorado, oferta ya procesada", {
        activeOfferKey,
      });
      return;
    }

    processedOfferKeyRef.current = activeOfferKey;

    console.log("[SHEET] aceptar oferta", {
      activeOfferKey,
      pedidoOfertado,
    });

    onAceptarOferta?.(pedidoOfertado);
  };

  const handleRechazarOferta = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!pedidoOfertado || !activeOfferKey) return;

    if (processedOfferKeyRef.current === activeOfferKey) {
      console.log("[SHEET] rechazo ignorado, oferta ya procesada", {
        activeOfferKey,
      });
      return;
    }

    processedOfferKeyRef.current = activeOfferKey;

    console.log("[SHEET] rechazar oferta", {
      activeOfferKey,
      pedidoOfertado,
    });

    onRechazarOferta?.(pedidoOfertado);
  };

  const handleFinalizarPedido = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!pedidoActivo) return;

    console.log("[SHEET] finalizar pedido", {
      pedidoActivo,
    });

    onFinalizarPedido?.(pedidoActivo);
  };

  const renderOferta = () => {
    if (!pedidoOfertado || !resumenOferta) return null;

    return (
      <div className="driver-action-offer">
        <div className="driver-action-offer-top">
          <div>
            <span className="driver-action-kicker">Oferta entrante</span>
            <h2>Nuevo pedido</h2>
          </div>

          <div className="driver-action-timer">
            <span>Tiempo</span>
            <strong>{restante}s</strong>
          </div>
        </div>

        <div className="driver-action-offer-summary">
          <div>
            <span>Tipo</span>
            <strong>{resumenOferta.tipo}</strong>
          </div>

          {resumenOferta.precio != null && (
            <div>
              <span>Importe</span>
              <strong>{formatMoney(resumenOferta.precio)}</strong>
            </div>
          )}

          {resumenOferta.km != null && (
            <div>
              <span>Distancia</span>
              <strong>{Number(resumenOferta.km).toFixed(2)} km</strong>
            </div>
          )}
        </div>

        <div className="driver-action-route">
          <div>
            <span>A</span>
            <p>
              <strong>Origen</strong>
              {resumenOferta.origen}
            </p>
          </div>

          <div>
            <span>B</span>
            <p>
              <strong>Destino</strong>
              {resumenOferta.destino}
            </p>
          </div>
        </div>

        <div className="driver-action-buttons">
          <button
            type="button"
            className="driver-action-btn driver-action-btn--reject"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleRechazarOferta}
          >
            Rechazar
          </button>

          <button
            type="button"
            className="driver-action-btn driver-action-btn--accept"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleAceptarOferta}
          >
            Aceptar
          </button>
        </div>
      </div>
    );
  };

  const renderPedidoActivo = () => {
    if (!pedidoActivo || !resumenActivo) return null;

    return (
      <div className="driver-action-active-order">
        <div className="driver-action-active-top">
          <div>
            <span className="driver-action-kicker">Pedido asignado</span>
            <h2>Pedido activo</h2>
          </div>

          <span className="driver-action-live-badge">En curso</span>
        </div>

        <div className="driver-action-route">
          <div>
            <span>A</span>
            <p>
              <strong>Origen</strong>
              {resumenActivo.origen}
            </p>
          </div>

          <div>
            <span>B</span>
            <p>
              <strong>Destino</strong>
              {resumenActivo.destino}
            </p>
          </div>
        </div>

        <div className="driver-action-offer-summary">
          <div>
            <span>Tipo</span>
            <strong>{resumenActivo.tipo}</strong>
          </div>

          {resumenActivo.precio != null && (
            <div>
              <span>Importe</span>
              <strong>{formatMoney(resumenActivo.precio)}</strong>
            </div>
          )}

          {resumenActivo.km != null && (
            <div>
              <span>Distancia</span>
              <strong>{Number(resumenActivo.km).toFixed(2)} km</strong>
            </div>
          )}
        </div>

        <button
          type="button"
          className="driver-action-btn driver-action-btn--finish"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleFinalizarPedido}
        >
          Finalizar pedido
        </button>
      </div>
    );
  };

  const renderEmpty = () => {
    return (
      <div className="driver-action-empty">
        <div className="driver-action-empty-icon">
          <span />
        </div>

        <div className="driver-action-empty-text">
          <strong>{statusCopy.title}</strong>
          <span>{geoError || statusCopy.subtitle}</span>
        </div>
      </div>
    );
  };

  return (
    <section
      className={`driver-action-sheet driver-action-sheet--${statusCopy.tone} driver-action-sheet--${sheetMode}`}
      aria-label="Estado de pedidos Zeus"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleSheetTap}
    >
      <div className="driver-action-handle" />

      <div className="driver-action-collapsed">
        <div className="driver-action-collapsed-left">
          <span
            className={`driver-action-dot driver-action-dot--${statusCopy.tone}`}
            aria-hidden="true"
          />
          <div>
            <strong>{statusCopy.collapsed}</strong>
            <span>{statusCopy.pill}</span>
          </div>
        </div>

        <span className="driver-action-collapsed-hint">
          {pedidoOfertado ? `${restante}s` : "Deslizá"}
        </span>
      </div>

      <div className="driver-action-content">
        <div className="driver-action-header">
          <div>
            <span className="driver-action-kicker">Zeus Engine</span>
            <h2>{statusCopy.title}</h2>
            <p>{geoError || statusCopy.subtitle}</p>
          </div>

          <span className={`driver-action-pill driver-action-pill--${statusCopy.tone}`}>
            {statusCopy.pill}
          </span>
        </div>

        {pedidoOfertado && renderOferta()}
        {!pedidoOfertado && pedidoActivo && renderPedidoActivo()}
        {!pedidoOfertado && !pedidoActivo && renderEmpty()}
      </div>
    </section>
  );
}

export default DriverActionSheet;