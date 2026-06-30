import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, update, remove } from "firebase/database";
import {
  ArrowLeft, MapPin, Phone, CaretDown, CaretUp,
  Warning, NavigationArrow, CurrencyDollar,
} from "@phosphor-icons/react";

import { db, rtdb } from "../../firebaseconfig";
import { openNativeNavigation } from "../../services/nativeNavigation";
import "./pedidoactivo.css";

function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function getGpsThresholdM(distanceKm) {
  if (!distanceKm || distanceKm < 2) return 100;
  if (distanceKm < 5) return 250;
  return 500;
}

function getHeartbeatMs(distanceKm) {
  if (!distanceKm || distanceKm < 2) return 20_000;
  if (distanceKm < 5) return 30_000;
  return 45_000;
}

const STEP_CONFIG = {
  go_to_pickup: {
    badge: "Pedido asignado",
    title: "Pedido listo para comenzar",
    subtitle: "Revisá origen, destino, notas e importe antes de iniciar el recorrido.",
    actionLabel: "Listo, comprendido",
    nextStep: "started_pickup",
    nextStatus: "started_pickup",
    routeTarget: "pickup",
    openMapOnAdvance: true,
    collapseOnAdvance: true,
    buttonVariant: "start",
    helperText: "Al confirmar se abrirá la ruta al punto de retiro.",
    deliveryTimeField: "startedPickupAt",
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
    deliveryTimeField: "arrivedPickupAt",
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
    deliveryTimeField: "pickedUpAt",
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
    deliveryTimeField: "arrivedDropoffAt",
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
    deliveryTimeField: "finishedAt",
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
    deliveryTimeField: null,
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

function getPointCoords(point = {}, legacyCoords = {}) {
  return {
    lat: safeNumber(point?.coords?.lat ?? point?.lat ?? legacyCoords?.lat),
    lng: safeNumber(point?.coords?.lng ?? point?.lng ?? legacyCoords?.lng),
  };
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

// El campo "floor" no siempre es un número de piso: Nodo Operador lo separa
// en dos campos cortos (floor="2", apartment="B"), pero la app Cliente usa
// un solo campo de texto libre ("local 4", "casa del fondo") y deja
// apartment vacío. Por eso "Piso" solo se antepone cuando hay apartment
// (ahí sabemos que floor es realmente un número) — si no, se muestra tal
// cual lo escribió el cliente, ya autodescriptivo.
function formatFloorInfo(floor, apartment) {
  if (floor && apartment) return `Piso ${floor}, Depto ${apartment}`;
  if (floor) return floor;
  if (apartment) return `Depto ${apartment}`;
  return "";
}

function normalizePedido(pedido) {
  if (!pedido) return null;

  const pickup = pedido?.pickup || {};
  const dropoff = pedido?.dropoff || {};
  const delivery = pedido?.delivery || {};
  const pricing = pedido?.pricing || {};
  const payment = pedido?.payment || {};
  const route = pedido?.route || {};
  const service = pedido?.service || {};

  const pickupAddress =
    pickup.address ||
    pickup.input ||
    pedido?.origin ||
    pedido?.originInput ||
    pedido?.customerDefaultAddress?.address ||
    "—";

  const dropoffAddress =
    dropoff.address ||
    dropoff.input ||
    pedido?.destination ||
    pedido?.destinationInput ||
    pedido?.destinationAddress?.address ||
    "—";

  const pickupCoords = getPointCoords(pickup, {
    lat: pedido?.originCoords?.lat ?? pedido?.customerDefaultAddress?.lat,
    lng: pedido?.originCoords?.lng ?? pedido?.customerDefaultAddress?.lng,
  });

  const dropoffCoords = getPointCoords(dropoff, {
    lat: pedido?.destinationCoords?.lat ?? pedido?.destinationAddress?.lat,
    lng: pedido?.destinationCoords?.lng ?? pedido?.destinationAddress?.lng,
  });

  const notesFrom =
    pickup.notes ||
    pedido?.notes?.origen ||
    pedido?.notesFrom ||
    "";

  const notesTo =
    dropoff.notes ||
    pedido?.notes?.destino ||
    pedido?.notesTo ||
    "";

  const recipientName =
    pedido?.recipient?.name ||
    dropoff?.contact?.fullName ||
    pedido?.customerName ||
    pedido?.userName ||
    "—";

  const recipientPhone =
    pedido?.recipient?.phone ||
    dropoff?.contact?.phone ||
    pedido?.contactTo ||
    pedido?.customerPhone ||
    "—";

  const contactFrom =
    pickup?.contact?.phone ||
    pedido?.contactFrom ||
    pedido?.customerPhone ||
    "—";

  const contactFromName =
    pickup?.contact?.fullName ||
    pedido?.customer?.name ||
    pedido?.customerName ||
    "—";

  const paymentMethod = payment.method || pedido?.paymentMethod || "cash";

  const requiresCashHandling =
    payment.requiresCashHandling === true ||
    pedido?.requiresCashHandling === true;

  // "driver_pays_pickup": el repartidor adelanta plata para retirar (ej.
  // compras) — distinto de cobrarle al cliente al entregar.
  const cashDirection = payment.cashDirection || "none";
  const pickupCashAmount = Number(payment.cashAmount) || 0;

  const price =
    pricing.price ??
    payment.amount ??
    pedido?.price ??
    pedido?.breakdown?.total ??
    null;

  const km =
    route.distanceKm ??
    pedido?.km ??
    pedido?.breakdown?.km ??
    null;

  const currentStep =
    delivery.currentStep ||
    pedido?.currentStep ||
    pedido?.statusOperativo ||
    "go_to_pickup";

  return {
    id: pedido?._docId || pedido?.orderId || pedido?.id || "—",
    status: pedido?.status || "assigned",
    currentStep,

    pickupAddress: normalizeText(pickupAddress),
    dropoffAddress: normalizeText(dropoffAddress),
    pickupCoords,
    dropoffCoords,
    pickupFloor: normalizeText(pickup.floor, ""),
    pickupApartment: normalizeText(pickup.apartment, ""),
    dropoffFloor: normalizeText(dropoff.floor, ""),
    dropoffApartment: normalizeText(dropoff.apartment, ""),
    notesFrom: normalizeText(notesFrom, ""),
    notesTo: normalizeText(notesTo, ""),

    recipientName: normalizeText(recipientName),
    recipientPhone: normalizeText(recipientPhone),
    contactFrom: normalizeText(contactFrom),
    contactFromName: normalizeText(contactFromName),

    price,
    km,
    paymentMethod,
    requiresCashHandling,
    cashDirection,
    pickupCashAmount,
    description: normalizeText(pedido?.description, ""),

    serviceType: normalizeText(service.label || service.type || pedido?.serviceType, "Envío"),
    serviceTypeId: service.type || "",
    productList: Array.isArray(pedido?.productList) ? pedido.productList : [],
    size: normalizeText(pedido?.size, "—"),

    assignedDriverId:
      pedido?.assignedDriverId ||
      pedido?.assignment?.assignedDriverId ||
      pedido?.assignedCadeteId ||
      pedido?.cadeteId ||
      null,
  };
}

function PedidoActivo({ repartidorId: propRepartidorId, user }) {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const [pedido, setPedido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingStep, setUpdatingStep] = useState(false);
  const [error, setError] = useState("");
  // Arranca expandido: el repartidor tiene que leer la comanda completa
  // antes de salir. Se colapsa solo cuando confirma un paso marcado
  // como collapseOnAdvance (ver STEP_CONFIG), dejando a la vista el
  // destino del próximo tramo en grande.
  const [isExpanded, setIsExpanded] = useState(true);

  const lastGpsWriteRef = useRef(null);
  const gpsHeartbeatRef = useRef(null);
  const routeDistKmRef  = useRef(null);

  const ficha = user?.ficha || user || {};

  const cadeteId = useMemo(() => {
    return String(
      propRepartidorId ||
        ficha?.driverId ||
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

  // GPS en tiempo real hacia driversLive/RTDB — throttle por distancia + heartbeat
  useEffect(() => {
    if (!navigator.geolocation) return;

    const writeRtdb = (coords) => {
      if (!cadeteId) return;
      lastGpsWriteRef.current = coords;
      update(ref(rtdb, `driversLive/${cadeteId}`), {
        lat: coords.lat, lng: coords.lng,
        currentLat: coords.lat, currentLng: coords.lng,
        lastSeen: Date.now(),
      }).catch(() => {});
    };

    const resetHeartbeat = (coords) => {
      if (gpsHeartbeatRef.current) clearInterval(gpsHeartbeatRef.current);
      gpsHeartbeatRef.current = setInterval(
        () => writeRtdb(coords),
        getHeartbeatMs(routeDistKmRef.current)
      );
    };

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        const moved = haversineM(lastGpsWriteRef.current, coords);
        if (moved >= getGpsThresholdM(routeDistKmRef.current)) {
          writeRtdb(coords);
          resetHeartbeat(coords);
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    return () => {
      navigator.geolocation.clearWatch(id);
      if (gpsHeartbeatRef.current) clearInterval(gpsHeartbeatRef.current);
    };
  }, [cadeteId]);

  const data = useMemo(() => normalizePedido(pedido), [pedido]);

  useEffect(() => { routeDistKmRef.current = data?.km ?? null; }, [data]);

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

  const openMapForStep = useCallback(
    (routeTarget) => {
      if (!data) return;

      const coords  = routeTarget === "dropoff" ? data.dropoffCoords  : data.pickupCoords;
      const address = routeTarget === "dropoff" ? data.dropoffAddress : data.pickupAddress;

      openNativeNavigation({ lat: coords?.lat, lng: coords?.lng, address });
    },
    [data]
  );

  const updateActiveOrderMirror = useCallback(
    async (payload) => {
      if (!cadeteId || !orderId) return;

      try {
        await update(ref(rtdb, `driverActiveOrders/${cadeteId}/${orderId}`), {
          ...payload,
          updatedAtMs: Date.now(),
        });
      } catch (err) {
        console.warn("⚠️ No se pudo actualizar driverActiveOrders:", err);
      }
    },
    [cadeteId, orderId]
  );

  const releaseDriver = useCallback(
    async (nowMs) => {
      if (!cadeteId) return;

      try {
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
      } catch (err) {
        console.warn("⚠️ No se pudo liberar repartidor:", err);
      }
    },
    [cadeteId]
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
          status: "completed",

          updatedAt: serverTimestamp(),
          updatedAtMs: nowMs,

          "delivery.currentStep": "delivered",
          "delivery.operationalStatus": "delivered",
          "delivery.finishedAt": serverTimestamp(),
          "delivery.finishedAtMs": nowMs,

          // Compatibilidad temporal.
          currentStep: "delivered",
          statusOperativo: "delivered",
          finishedAt: serverTimestamp(),
          finishedAtMs: nowMs,
          lastUpdate: serverTimestamp(),
        });

        await updateActiveOrderMirror({
          status: "delivered",
          currentStep: "delivered",
          operationalStatus: "delivered",
          finishedAtMs: nowMs,
        });

        if (cadeteId) {
          try {
            await remove(ref(rtdb, `driverActiveOrders/${cadeteId}/${orderId}`));
          } catch (err) {
            console.warn("⚠️ No se pudo remover driverActiveOrders:", err);
          }
        }

        await releaseDriver(nowMs);

        navigate("/", { replace: true });
        return;
      }

      const timestampField = currentConfig.deliveryTimeField || "stepUpdatedAt";

      await updateDoc(orderRef, {
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs,

        [`delivery.${timestampField}`]: serverTimestamp(),
        "delivery.currentStep": nextStep,
        "delivery.operationalStatus": nextStatus,

        // Compatibilidad temporal.
        currentStep: nextStep,
        statusOperativo: nextStatus,
        [timestampField]: serverTimestamp(),
        lastUpdate: serverTimestamp(),
      });

      await updateActiveOrderMirror({
        currentStep: nextStep,
        operationalStatus: nextStatus,
        statusOperativo: nextStatus,
        [timestampField]: nowMs,
      });

      if (currentConfig.openMapOnAdvance) {
        setTimeout(() => {
          openMapForStep(currentConfig.routeTarget);
        }, 250);
      }

      if (currentConfig.collapseOnAdvance) {
        setIsExpanded(false);
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
    releaseDriver,
  ]);

  // ── Destino actual según el paso ──────────────────────────
  const isGoingToPickup = ["go_to_pickup", "started_pickup", "arrived_pickup"].includes(step);
  const currentDestination = isGoingToPickup
    ? (data?.pickupCoords?.lat  ? data.pickupCoords  : null)
    : (data?.dropoffCoords?.lat ? data.dropoffCoords : null);
  const currentAddress = isGoingToPickup ? data?.pickupAddress : data?.dropoffAddress;
  const currentFloorInfo = isGoingToPickup
    ? formatFloorInfo(data?.pickupFloor, data?.pickupApartment)
    : formatFloorInfo(data?.dropoffFloor, data?.dropoffApartment);
  const currentNotes = isGoingToPickup ? data?.notesFrom : data?.notesTo;
  const currentContactName  = isGoingToPickup ? data?.contactFromName : data?.recipientName;
  const currentContactPhone = isGoingToPickup ? data?.contactFrom     : data?.recipientPhone;
  const currentStopLabel = isGoingToPickup ? "Retirar de" : "Llevar a";
  const canNavigate = Boolean(
    currentDestination?.lat != null || (currentAddress && currentAddress !== "—")
  );

  const pickupFloorInfo  = formatFloorInfo(data?.pickupFloor, data?.pickupApartment);
  const dropoffFloorInfo = formatFloorInfo(data?.dropoffFloor, data?.dropoffApartment);

  // ── Progreso de pasos ──────────────────────────────────────
  const STEP_ORDER = ["go_to_pickup", "started_pickup", "arrived_pickup", "go_to_dropoff", "arrived_dropoff"];
  const stepIndex  = STEP_ORDER.indexOf(step);

  // Los teléfonos se habilitan recién al llegar a cada parada — evita
  // llamadas o mensajes del repartidor al cliente antes de estar ahí.
  const pickupPhoneUnlocked  = step === "delivered" || stepIndex >= STEP_ORDER.indexOf("arrived_pickup");
  const dropoffPhoneUnlocked = step === "delivered" || stepIndex >= STEP_ORDER.indexOf("arrived_dropoff");
  const currentPhoneUnlocked = isGoingToPickup ? pickupPhoneUnlocked : dropoffPhoneUnlocked;

  // "Debés cobrar" — solo en el último tramo antes de finalizar, y solo
  // si el pago es en efectivo (con MercadoPago no hay nada que cobrar).
  const showCollectCashBanner =
    step === "arrived_dropoff" && data.paymentMethod !== "mercadopago" && Number(data.price) > 0;

  // "Debés pagar" — al llegar al origen (recién ahí, no antes a ciegas),
  // solo si el pedido requiere que el repartidor adelante plata para retirar.
  const showPayAtPickupBanner =
    step === "arrived_pickup" && data.cashDirection === "driver_pays_pickup" && data.pickupCashAmount > 0;
  const pickupCashLabel = formatMoney(data.pickupCashAmount);

  // ── Loading / Error ────────────────────────────────────────
  if (loading) {
    return (
      <div className="pa-root">
        <div className="pa-loading">
          <span className="pa-spinner" />
          <p>Cargando pedido...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="pa-root pa-root--error">
        <button className="pa-back-btn-standalone" onClick={() => navigate("/", { replace: true })}>
          <ArrowLeft size={20} weight="bold" />
        </button>
        <h2>No pudimos abrir el pedido</h2>
        <p>{error}</p>
        <button className="pa-error-retry" onClick={() => navigate("/", { replace: true })}>
          Volver al inicio
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="pa-root">

      {/* ── TOP HUD — progreso + volver ─────────────────── */}
      <div className="pa-top-hud">
        <button className="pa-hud-btn" onClick={() => navigate("/", { replace: true })}>
          <ArrowLeft size={20} weight="bold" />
        </button>

        <div className="pa-step-progress">
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`pa-step-dot ${
                i < stepIndex  ? "pa-step-dot--done"   :
                i === stepIndex ? "pa-step-dot--active" : ""
              }`}
            />
          ))}
        </div>

        <div className="pa-hud-id">
          <span>Pedido</span>
          <strong>{data.id.slice(-6)}</strong>
        </div>
      </div>

      {/* ── PANEL INFERIOR ──────────────────────────────── */}
      <div className={`pa-panel ${isExpanded ? "pa-panel--expanded" : ""}`}>

        {/* Handle — tap para expandir/colapsar */}
        <button
          className="pa-panel-handle-btn"
          onClick={() => setIsExpanded(v => !v)}
          aria-label={isExpanded ? "Colapsar detalles" : "Ver detalles"}
        >
          <div className="pa-panel-handle" />
        </button>

        <div className="pa-panel-scroll">
          <div className="pa-step-badge">{stepConfig.badge}</div>
          {data.description && <p className="pa-description">{data.description}</p>}

          {!isExpanded ? (
            /* ── Vista colapsada — foco en la parada actual ── */
            <div className="pa-stop pa-stop--focused">
              <span className="pa-stop__label">{currentStopLabel}</span>
              <p className="pa-stop__address">{currentAddress || "—"}</p>
              {currentFloorInfo && <p className="pa-stop__floor">{currentFloorInfo}</p>}
              {currentNotes && <p className="pa-stop__notes">📝 {currentNotes}</p>}

              {(currentContactName !== "—" || currentContactPhone !== "—") && (
                <div className="pa-stop__contact">
                  <span className="pa-stop__contact-name">{currentContactName}</span>
                  {currentContactPhone !== "—" && currentPhoneUnlocked && (
                    <button className="pa-stop__call" onClick={() => callPhone(currentContactPhone)}>
                      <Phone size={13} weight="fill" /> {currentContactPhone}
                    </button>
                  )}
                  {currentContactPhone !== "—" && !currentPhoneUnlocked && (
                    <span className="pa-stop__call-locked">📞 Disponible al llegar</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ── Vista expandida — comanda completa ── */
            <div className="pa-comanda">

              {/* RETIRAR DE */}
              <div className="pa-stop pa-stop--pickup">
                <span className="pa-stop__label">
                  {data.serviceTypeId === "compras" ? "Retirar / comprar en" : "Retirar de"}
                </span>
                <div className="pa-stop__address-row">
                  <p className="pa-stop__address">{data.pickupAddress}</p>
                  {mapsPickup && (
                    <a href={mapsPickup} target="_blank" rel="noreferrer" className="pa-mini-map-btn">
                      <MapPin size={14} weight="fill" />
                    </a>
                  )}
                </div>
                {pickupFloorInfo && <p className="pa-stop__floor">{pickupFloorInfo}</p>}
                {data.notesFrom && <p className="pa-stop__notes">📝 {data.notesFrom}</p>}
                {data.serviceTypeId === "compras" && data.productList.length > 0 && (
                  <ul className="pa-cart-list">
                    {data.productList.map((item, i) => (
                      <li key={i}>🛒 {item}</li>
                    ))}
                  </ul>
                )}
                {(data.contactFromName !== "—" || data.contactFrom !== "—") && (
                  <div className="pa-stop__contact">
                    <span className="pa-stop__contact-name">{data.contactFromName}</span>
                    {data.contactFrom !== "—" && pickupPhoneUnlocked && (
                      <button className="pa-stop__call" onClick={() => callPhone(data.contactFrom)}>
                        <Phone size={13} weight="fill" /> {data.contactFrom}
                      </button>
                    )}
                    {data.contactFrom !== "—" && !pickupPhoneUnlocked && (
                      <span className="pa-stop__call-locked">📞 Disponible al llegar</span>
                    )}
                  </div>
                )}
              </div>

              {/* LLEVAR A */}
              <div className="pa-stop pa-stop--dropoff">
                <span className="pa-stop__label">Llevar a</span>
                <div className="pa-stop__address-row">
                  <p className="pa-stop__address">{data.dropoffAddress}</p>
                  {mapsDropoff && (
                    <a href={mapsDropoff} target="_blank" rel="noreferrer" className="pa-mini-map-btn">
                      <MapPin size={14} weight="fill" />
                    </a>
                  )}
                </div>
                {dropoffFloorInfo && <p className="pa-stop__floor">{dropoffFloorInfo}</p>}
                {data.notesTo && <p className="pa-stop__notes">📝 {data.notesTo}</p>}
                {(data.recipientName !== "—" || data.recipientPhone !== "—") && (
                  <div className="pa-stop__contact">
                    <span className="pa-stop__contact-name">{data.recipientName}</span>
                    {data.recipientPhone !== "—" && dropoffPhoneUnlocked && (
                      <button className="pa-stop__call" onClick={() => callPhone(data.recipientPhone)}>
                        <Phone size={13} weight="fill" /> {data.recipientPhone}
                      </button>
                    )}
                    {data.recipientPhone !== "—" && !dropoffPhoneUnlocked && (
                      <span className="pa-stop__call-locked">📞 Disponible al llegar</span>
                    )}
                  </div>
                )}
              </div>

              {/* Alerta efectivo */}
              {data.requiresCashHandling && (
                <div className="pa-cash-alert">
                  <Warning size={15} weight="fill" />
                  <span>Pedido con manejo de dinero — verificá el importe</span>
                </div>
              )}

              {/* Resumen — precio, distancia y pago, justo antes de los botones */}
              <div className="pa-summary">
                <div className="pa-summary-item">
                  <span>Importe</span>
                  <strong>{priceLabel || "—"}</strong>
                </div>
                <div className="pa-summary-item">
                  <span>Distancia</span>
                  <strong>{data.km != null ? `${Number(data.km).toFixed(1)} km` : "—"}</strong>
                </div>
                <div className="pa-summary-item">
                  <span>Pago</span>
                  <strong>
                    {data.paymentMethod === "mercadopago" ? "MercadoPago" : "Efectivo"}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Aviso de cobro — último tramo antes de finalizar, solo si es efectivo */}
          {showCollectCashBanner && (
            <div className="pa-collect-alert">
              <CurrencyDollar size={18} weight="fill" />
              <span>Debés cobrar <strong>{priceLabel}</strong></span>
            </div>
          )}

          {/* Aviso de pago — al llegar al origen, si el repartidor debe adelantar plata */}
          {showPayAtPickupBanner && (
            <div className="pa-pay-alert">
              <CurrencyDollar size={18} weight="fill" />
              <span>Acá debés pagar <strong>{pickupCashLabel}</strong></span>
            </div>
          )}

          {/* Toggle expandir */}
          <button className="pa-expand-toggle" onClick={() => setIsExpanded(v => !v)}>
            {isExpanded
              ? <><CaretDown size={14} weight="bold" /> Vista enfocada</>
              : <><CaretUp   size={14} weight="bold" /> Ver comanda completa</>}
          </button>

          {error && <div className="pa-inline-error">{error}</div>}
        </div>

        {/* Botones de acción — siempre fijos al fondo */}
        <div className="pa-panel-ctas">
          {canNavigate && (
            <button
              type="button"
              className="pa-maps-btn"
              onClick={() =>
                openNativeNavigation({
                  lat: currentDestination?.lat,
                  lng: currentDestination?.lng,
                  address: currentAddress,
                })
              }
            >
              <NavigationArrow size={16} weight="fill" />
              Navegar
            </button>
          )}
          <button
            className={`pa-action-btn ${stepConfig.buttonVariant === "done" ? "pa-action-btn--done" : ""}`}
            onClick={handleAdvanceStep}
            disabled={updatingStep}
          >
            {updatingStep ? "Actualizando…" : stepConfig.actionLabel}
          </button>
        </div>

      </div>
    </div>
  );
}

export default PedidoActivo;