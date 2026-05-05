import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, update } from "firebase/database";

import { db, rtdb } from "../../firebaseconfig";
import "./pedidoactivo.css";

const STEP_CONFIG = {
  go_to_pickup: {
    badge: "Pedido asignado",
    title: "Pedido listo para comenzar",
    subtitle: "Revisá origen, destino, notas e importe antes de iniciar el recorrido.",
    actionLabel: "Comenzar",
    nextStep: "started_pickup",
    nextStatus: "started_pickup",
    routeTarget: "pickup",
    openMapOnAdvance: true,
    buttonVariant: "start",
    helperText: "Al comenzar se abrirá la ruta al punto de retiro.",
  },

  started_pickup: {
    badge: "En camino al origen",
    title: "Dirigite al punto de retiro",
    subtitle: "Cuando llegues al origen, volvé a Zeus y confirmá tu llegada.",
    actionLabel: "Llegué al origen",
    nextStep: "arrived_pickup",
    nextStatus: "arrived_pickup",
    routeTarget: "pickup",
    openMapOnAdvance: false,
    buttonVariant: "pickup",
    helperText: "Confirmá solo cuando estés en el punto de retiro.",
  },

  arrived_pickup: {
    badge: "En origen",
    title: "Retirá el pedido",
    subtitle: "Verificá los datos, revisá las notas y confirmá cuando tengas el pedido.",
    actionLabel: "Pedido retirado",
    nextStep: "go_to_dropoff",
    nextStatus: "picked_up",
    routeTarget: "dropoff",
    openMapOnAdvance: true,
    buttonVariant: "picked",
    helperText: "Al confirmar el retiro se abrirá la ruta al destino.",
  },

  go_to_dropoff: {
    badge: "En camino al destino",
    title: "Dirigite al domicilio del cliente",
    subtitle: "Cuando llegues al destino, volvé a Zeus y confirmá tu llegada.",
    actionLabel: "Llegué al destino",
    nextStep: "arrived_dropoff",
    nextStatus: "arrived_dropoff",
    routeTarget: "dropoff",
    openMapOnAdvance: false,
    buttonVariant: "dropoff",
    helperText: "Confirmá solo cuando estés en el domicilio de entrega.",
  },

  arrived_dropoff: {
    badge: "En destino",
    title: "Entregá el pedido",
    subtitle: "Verificá el cobro si corresponde y finalizá la entrega.",
    actionLabel: "Finalizar pedido",
    nextStep: "delivered",
    nextStatus: "delivered",
    routeTarget: "dropoff",
    openMapOnAdvance: false,
    buttonVariant: "finish",
    helperText: "Finalizá únicamente cuando el pedido esté entregado.",
  },

  delivered: {
    badge: "Finalizado",
    title: "Pedido entregado",
    subtitle: "Este pedido ya fue finalizado.",
    actionLabel: "Volver al inicio",
    nextStep: null,
    nextStatus: null,
    routeTarget: "dropoff",
    openMapOnAdvance: false,
    buttonVariant: "done",
    helperText: "",
  },
};

function normalizeText(value, fallback = "—") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function hasCoords(coords) {
  return (
    coords &&
    Number.isFinite(Number(coords.lat)) &&
    Number.isFinite(Number(coords.lng))
  );
}

function buildGoogleMapsPointUrl({ lat, lng, address, label }) {
  if (lat != null && lng != null) {
    const q = encodeURIComponent(`${lat},${lng}${label ? ` (${label})` : ""}`);
    return `https://www.google.com/maps?q=${q}`;
  }

  if (address && address !== "—") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      address
    )}`;
  }

  return null;
}

function buildGoogleMapsDirectionsUrl(from, to) {
  if (!hasCoords(from) || !hasCoords(to)) return null;

  const origin = `${from.lat},${from.lng}`;
  const destination = `${to.lat},${to.lng}`;

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    origin
  )}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

function buildGoogleMapsDestinationUrl(to, fallbackAddress = "") {
  if (hasCoords(to)) {
    const destination = `${to.lat},${to.lng}`;

    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      destination
    )}&travelmode=driving`;
  }

  if (fallbackAddress && fallbackAddress !== "—") {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      fallbackAddress
    )}&travelmode=driving`;
  }

  return null;
}

function formatMoney(value) {
  if (value == null || value === "") return null;

  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(num);
}

function callPhone(number) {
  const cleaned = String(number || "").replace(/\s/g, "").trim();

  if (!cleaned || cleaned === "—") return;

  window.location.href = `tel:${cleaned}`;
}

function normalizePedido(pedido) {
  if (!pedido) return null;

  const pickupAddress =
    pedido?.pickup?.address ||
    pedido?.origin ||
    pedido?.originInput ||
    pedido?.customerDefaultAddress?.address ||
    "—";

  const dropoffAddress =
    pedido?.dropoff?.address ||
    pedido?.destination ||
    pedido?.destinationInput ||
    pedido?.destinationAddress?.address ||
    "—";

  const pickupCoords = {
    lat: safeNumber(
      pedido?.pickup?.lat ??
        pedido?.originCoords?.lat ??
        pedido?.customerDefaultAddress?.lat
    ),
    lng: safeNumber(
      pedido?.pickup?.lng ??
        pedido?.originCoords?.lng ??
        pedido?.customerDefaultAddress?.lng
    ),
  };

  const dropoffCoords = {
    lat: safeNumber(
      pedido?.dropoff?.lat ??
        pedido?.destinationCoords?.lat ??
        pedido?.destinationAddress?.lat
    ),
    lng: safeNumber(
      pedido?.dropoff?.lng ??
        pedido?.destinationCoords?.lng ??
        pedido?.destinationAddress?.lng
    ),
  };

  const notesFrom =
    pedido?.pickup?.notes ||
    pedido?.notes?.origen ||
    pedido?.notesFrom ||
    "";

  const notesTo =
    pedido?.dropoff?.notes ||
    pedido?.notes?.destino ||
    pedido?.notesTo ||
    "";

  const recipientName =
    pedido?.recipient?.name ||
    pedido?.customerName ||
    pedido?.userName ||
    "—";

  const recipientPhone =
    pedido?.recipient?.phone ||
    pedido?.contactTo ||
    pedido?.customerPhone ||
    "—";

  const contactFrom =
    pedido?.contactFrom ||
    pedido?.pickup?.phone ||
    pedido?.customerPhone ||
    "—";

  const paymentMethod =
    pedido?.payment?.method ||
    pedido?.paymentMethod ||
    "cash";

  const requiresCashHandling =
    pedido?.payment?.requiresCashHandling === true ||
    pedido?.requiresCashHandling === true;

  const price =
    pedido?.payment?.price ??
    pedido?.price ??
    pedido?.breakdown?.total ??
    null;

  const km = pedido?.km ?? pedido?.breakdown?.km ?? null;

  const currentStep =
    pedido?.currentStep ||
    pedido?.statusOperativo ||
    "go_to_pickup";

  return {
    id: pedido?._docId || pedido?.orderId || pedido?.id || "—",
    status: pedido?.status || "asignado",
    currentStep,

    pickupAddress: normalizeText(pickupAddress),
    dropoffAddress: normalizeText(dropoffAddress),
    pickupCoords,
    dropoffCoords,
    notesFrom: normalizeText(notesFrom, ""),
    notesTo: normalizeText(notesTo, ""),

    recipientName: normalizeText(recipientName),
    recipientPhone: normalizeText(recipientPhone),
    contactFrom: normalizeText(contactFrom),

    price,
    km,
    paymentMethod,
    requiresCashHandling,

    serviceType: normalizeText(pedido?.serviceType, "Envío"),
    size: normalizeText(pedido?.size, "—"),

    assignedCadeteId: pedido?.assignedCadeteId || pedido?.cadeteId || null,
  };
}

function PedidoActivo({ repartidorId: propRepartidorId, user }) {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const [pedido, setPedido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingStep, setUpdatingStep] = useState(false);
  const [error, setError] = useState("");

  const ficha = user?.ficha || user || {};

  const cadeteId = useMemo(() => {
    return String(
      propRepartidorId ||
        ficha?.cadeteId ||
        ficha?.id ||
        ficha?.repartidorId ||
        ""
    ).trim();
  }, [propRepartidorId, ficha]);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setError("No se encontró el ID del pedido.");
      return;
    }

    const orderRef = doc(db, "orders", orderId);

    const unsubscribe = onSnapshot(
      orderRef,
      (snap) => {
        setLoading(false);

        if (!snap.exists()) {
          setPedido(null);
          setError("El pedido no existe o ya no está disponible.");
          return;
        }

        setError("");
        setPedido({
          ...snap.data(),
          _docId: snap.id,
        });
      },
      (err) => {
        console.error("❌ Error escuchando pedido activo:", err);
        setLoading(false);
        setError("No pudimos cargar el pedido activo.");
      }
    );

    return () => unsubscribe();
  }, [orderId]);

  const data = useMemo(() => normalizePedido(pedido), [pedido]);

  const step = data?.currentStep || "go_to_pickup";
  const stepConfig = STEP_CONFIG[step] || STEP_CONFIG.go_to_pickup;

  const priceLabel = formatMoney(data?.price);

  const mapsPickup = useMemo(() => {
    if (!data) return null;

    return buildGoogleMapsPointUrl({
      lat: data.pickupCoords?.lat,
      lng: data.pickupCoords?.lng,
      address: data.pickupAddress,
      label: "Origen",
    });
  }, [data]);

  const mapsDropoff = useMemo(() => {
    if (!data) return null;

    return buildGoogleMapsPointUrl({
      lat: data.dropoffCoords?.lat,
      lng: data.dropoffCoords?.lng,
      address: data.dropoffAddress,
      label: "Destino",
    });
  }, [data]);

  const mapsFullRoute = useMemo(() => {
    if (!data) return null;

    return buildGoogleMapsDirectionsUrl(data.pickupCoords, data.dropoffCoords);
  }, [data]);

  const getStepNavigationUrl = useCallback(
    (routeTarget) => {
      if (!data) return null;

      if (routeTarget === "dropoff") {
        return (
          buildGoogleMapsDestinationUrl(data.dropoffCoords, data.dropoffAddress) ||
          mapsDropoff
        );
      }

      return (
        buildGoogleMapsDestinationUrl(data.pickupCoords, data.pickupAddress) ||
        mapsPickup
      );
    },
    [data, mapsDropoff, mapsPickup]
  );

  const openMapForStep = useCallback(
    (routeTarget) => {
      const url = getStepNavigationUrl(routeTarget);

      if (!url) return;

      window.open(url, "_blank", "noopener,noreferrer");
    },
    [getStepNavigationUrl]
  );

  const updateActiveOrderMirror = useCallback(
    async (payload) => {
      if (!cadeteId || !orderId) return;

      try {
        await update(ref(rtdb, `driverActiveOrders/${cadeteId}/${orderId}`), {
          ...payload,
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.warn("⚠️ No se pudo actualizar driverActiveOrders:", err);
      }
    },
    [cadeteId, orderId]
  );

  const handleAdvanceStep = useCallback(async () => {
    if (!data || !orderId || updatingStep) return;

    const currentConfig =
      STEP_CONFIG[data.currentStep] || STEP_CONFIG.go_to_pickup;

    if (data.currentStep === "delivered") {
      navigate("/", { replace: true });
      return;
    }

    const nextStep = currentConfig.nextStep;
    const nextStatus = currentConfig.nextStatus;

    if (!nextStep) return;

    setUpdatingStep(true);
    setError("");

    const nowMs = Date.now();

    try {
      const orderRef = doc(db, "orders", orderId);

      if (nextStep === "delivered") {
        await updateDoc(orderRef, {
          status: "finalizado",
          currentStep: "delivered",
          statusOperativo: "delivered",
          finishedAt: serverTimestamp(),
          finishedAtMs: nowMs,
          lastUpdate: serverTimestamp(),
        });

        await updateActiveOrderMirror({
          status: "delivered",
          currentStep: "delivered",
          statusOperativo: "delivered",
          finishedAt: nowMs,
        });

        if (cadeteId) {
          await update(ref(rtdb, `driversLive/${cadeteId}`), {
            availableForOffers: true,
            estadoCadete: "disponible",
            workStatus: "idle",
            currentOrderId: null,
            currentOfferOrderId: null,
            currentOfferExpiresAt: null,
            presenceReason: "order_finished_from_active_page",
            lastSeen: nowMs,
          });

          await update(ref(rtdb, `onlineAdmissionRequests/${cadeteId}`), {
            estadoCadete: "disponible",
            workStatus: "idle",
            currentOrderId: null,
            lastSeen: nowMs,
          });
        }

        navigate("/", { replace: true });
        return;
      }

      const timeFieldByStatus = {
        started_pickup: "startedPickupAt",
        arrived_pickup: "arrivedPickupAt",
        picked_up: "pickedUpAt",
        arrived_dropoff: "arrivedDropoffAt",
      };

      const timestampField = timeFieldByStatus[nextStatus] || "stepUpdatedAt";

      await updateDoc(orderRef, {
        currentStep: nextStep,
        statusOperativo: nextStatus,
        [timestampField]: serverTimestamp(),
        lastUpdate: serverTimestamp(),
      });

      await updateActiveOrderMirror({
        currentStep: nextStep,
        statusOperativo: nextStatus,
        [timestampField]: nowMs,
      });

      if (currentConfig.openMapOnAdvance) {
        setTimeout(() => {
          openMapForStep(currentConfig.routeTarget);
        }, 250);
      }
    } catch (err) {
      console.error("❌ Error avanzando paso del pedido:", err);
      setError("No pudimos actualizar el estado del pedido. Intentá nuevamente.");
    } finally {
      setUpdatingStep(false);
    }
  }, [
    data,
    orderId,
    updatingStep,
    updateActiveOrderMirror,
    cadeteId,
    navigate,
    openMapForStep,
  ]);

  if (loading) {
    return (
      <main className="pedido-activo-page">
        <div className="pedido-activo-loading">
          <span className="pedido-activo-spinner" />
          <p>Cargando pedido activo...</p>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="pedido-activo-page">
        <div className="pedido-activo-error">
          <h2>No pudimos abrir el pedido</h2>
          <p>{error}</p>
          <button type="button" onClick={() => navigate("/", { replace: true })}>
            Volver al inicio
          </button>
        </div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="pedido-activo-page">
      <section className={`pedido-activo-hero pedido-activo-hero--${stepConfig.buttonVariant}`}>
        <div className="pedido-activo-topbar">
          <button
            type="button"
            className="pedido-activo-back"
            onClick={() => navigate("/", { replace: true })}
          >
            ←
          </button>

          <div>
            <span>Modo pedido</span>
            <strong>ID {data.id}</strong>
          </div>
        </div>

        <div className="pedido-activo-status">
          <span>{stepConfig.badge}</span>
          <h1>{stepConfig.title}</h1>
          <p>{stepConfig.subtitle}</p>
        </div>

        <div className="pedido-activo-main-actions pedido-activo-main-actions--single">
          <button
            type="button"
            className={`pedido-activo-primary-btn pedido-activo-primary-btn--${stepConfig.buttonVariant}`}
            onClick={handleAdvanceStep}
            disabled={updatingStep}
          >
            {updatingStep ? "Actualizando..." : stepConfig.actionLabel}
          </button>
        </div>

        {stepConfig.helperText && (
          <p className="pedido-activo-action-helper">{stepConfig.helperText}</p>
        )}
      </section>

      {error && <div className="pedido-activo-inline-error">{error}</div>}

      <section className="pedido-activo-summary">
        <article>
          <span>Importe</span>
          <strong>{priceLabel || "—"}</strong>
        </article>

        <article>
          <span>Distancia</span>
          <strong>
            {data.km != null ? `${Number(data.km).toFixed(2)} km` : "—"}
          </strong>
        </article>

        <article>
          <span>Pago</span>
          <strong>
            {data.paymentMethod === "digital" ? "Digital" : "Efectivo"}
          </strong>
        </article>
      </section>

      {data.requiresCashHandling && (
        <section className="pedido-activo-cash-alert">
          <strong>Pedido con manejo de dinero</strong>
          <span>Verificá el importe antes de finalizar la entrega.</span>
        </section>
      )}

      <section className="pedido-activo-route-card">
        <div className="pedido-activo-route-point">
          <div className="pedido-activo-route-icon">A</div>
          <div>
            <span>Origen</span>
            <strong>{data.pickupAddress}</strong>
            {data.notesFrom && <p>{data.notesFrom}</p>}
          </div>
        </div>

        <div className="pedido-activo-route-line" />

        <div className="pedido-activo-route-point">
          <div className="pedido-activo-route-icon pedido-activo-route-icon--dest">
            B
          </div>
          <div>
            <span>Destino</span>
            <strong>{data.dropoffAddress}</strong>
            {data.notesTo && <p>{data.notesTo}</p>}
          </div>
        </div>
      </section>

      <section className="pedido-activo-contact-card">
        <div>
          <span>Destinatario</span>
          <strong>{data.recipientName}</strong>
          <p>{data.recipientPhone}</p>
        </div>

        <div className="pedido-activo-contact-actions">
          <button
            type="button"
            onClick={() => callPhone(data.recipientPhone)}
            disabled={!data.recipientPhone || data.recipientPhone === "—"}
          >
            Llamar cliente
          </button>

          <button
            type="button"
            onClick={() => callPhone(data.contactFrom)}
            disabled={!data.contactFrom || data.contactFrom === "—"}
          >
            Llamar origen
          </button>
        </div>
      </section>

      <section className="pedido-activo-info-grid">
        <article>
          <span>Servicio</span>
          <strong>{data.serviceType}</strong>
        </article>

        <article>
          <span>Tamaño</span>
          <strong>{data.size}</strong>
        </article>
      </section>

      <section className="pedido-activo-map-actions">
        <a
          className={!mapsPickup ? "is-disabled" : ""}
          href={mapsPickup || "#"}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => !mapsPickup && e.preventDefault()}
        >
          Ver origen
        </a>

        <a
          className={!mapsDropoff ? "is-disabled" : ""}
          href={mapsDropoff || "#"}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => !mapsDropoff && e.preventDefault()}
        >
          Ver destino
        </a>

        <a
          className={!mapsFullRoute ? "is-disabled" : ""}
          href={mapsFullRoute || "#"}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => !mapsFullRoute && e.preventDefault()}
        >
          Ruta completa
        </a>
      </section>
    </main>
  );
}

export default PedidoActivo;