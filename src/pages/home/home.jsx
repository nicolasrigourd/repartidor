import { useEffect, useMemo, useRef, useState } from "react";
import "./home.css";

import BottomBar from "../../components/bottombar/bottombar";
import CardPedidoActivo from "../../components/cardpedidoactivo/cardpedidoactivo";
import DriverHeatMap from "../../components/driverheatmap/DriverHeatMap";
import DriverActionSheet from "../../components/driveractionsheet/DriverActionSheet";

import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { ref, set, update, onValue, off, get, remove } from "firebase/database";
import { db, rtdb } from "../../firebaseconfig";

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

function HoldToConfirmButton({
  className = "",
  onStartHold,
  onCancelHold,
  onConfirm,
  holdMs = 3000,
  children,
  holdingText = "Mantené presionado...",
}) {
  const timeoutRef = useRef(null);
  const [isHolding, setIsHolding] = useState(false);

  const clearHold = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setIsHolding(false);
    onCancelHold?.();
  };

  const handlePointerDown = (event) => {
    event.preventDefault();

    if (timeoutRef.current) return;

    if (event.currentTarget.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    setIsHolding(true);
    onStartHold?.();

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setIsHolding(false);
      onConfirm?.();
    }, holdMs);
  };

  const handlePointerUp = () => clearHold();
  const handlePointerLeave = () => clearHold();

  useEffect(() => {
    return () => clearHold();
  }, []);

  return (
    <button
      type="button"
      className={`${className} driver-hold-button ${
        isHolding ? "driver-hold-button--holding" : ""
      }`}
      style={{ "--hold-ms": `${holdMs}ms` }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onClick={(event) => event.preventDefault()}
    >
      <span className="driver-hold-fill" aria-hidden="true" />
      <span className="driver-hold-label">
        {isHolding ? holdingText : children}
      </span>
    </button>
  );
}

function Home({ repartidorId, user, onLogout }) {
  const ficha = user?.ficha || user || {};
  const nombreCompleto = `${ficha.nombre || ""} ${ficha.apellido || ""}`.trim();

  const [activeTab, setActiveTab] = useState("home");

  const [workStatus, setWorkStatus] = useState("offline");
  const [geoStatus, setGeoStatus] = useState("idle");
  const [geoError, setGeoError] = useState("");
  const [liveCoords, setLiveCoords] = useState(null);

  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  const [admissionState, setAdmissionState] = useState(null);
  const [serverPresence, setServerPresence] = useState(null);

  const watchIdRef = useRef(null);
  const sessionIdRef = useRef(null);

  const gpsPrimeRef = useRef({
    status: "idle",
    promise: null,
    position: null,
    error: null,
  });

  const getCadeteIdentity = () => {
    return String(
      repartidorId ||
        ficha.cadeteId ||
        ficha.id ||
        ficha.repartidorId ||
        ""
    ).trim();
  };

  const cadeteId = getCadeteIdentity();

  const createSessionId = () => {
    const id = cadeteId || "unknown";
    return `sess_${id}_${Date.now()}`;
  };

  const statusCopy = useMemo(() => {
    if (workStatus === "busy") {
      return {
        label: "En pedido",
        text: "Tenés un pedido activo en curso.",
        pill: "Pedido activo",
      };
    }

    if (workStatus === "online") {
      return {
        label: "Disponible",
        text: "Ya fuiste admitido por Zeus Server y estás listo para ofertas.",
        pill: "Online",
      };
    }

    if (workStatus === "starting") {
      return {
        label: "Conectando",
        text: "Estamos activando tu ubicación y enviando tu solicitud al server.",
        pill: "Buscando GPS",
      };
    }

    if (workStatus === "pending_admission") {
      return {
        label: "En validación",
        text: "Tu solicitud fue enviada. Zeus Server está validando tu ficha y tu GPS.",
        pill: "Validando",
      };
    }

    if (workStatus === "error") {
      return {
        label: "Error de conexión",
        text: geoError || "No pudimos activar tu ubicación.",
        pill: "Revisar",
      };
    }

    return {
      label: "Desconectado",
      text: "Mantené presionado para activar tu ubicación y solicitar ingreso online.",
      pill: "Offline",
    };
  }, [workStatus, geoError]);

  const heatZones = useMemo(
    () => [
      {
        id: "centro",
        label: "Centro",
        level: "high",
        message: "Zona recomendada",
        hint: "Mayor actividad probable",
        position: "leftTop",
        intensity: 8,
        lat: null,
        lng: null,
      },
      {
        id: "norte",
        label: "B° Norte",
        level: "medium",
        message: "Actividad moderada",
        hint: "Buena zona de espera",
        position: "rightMiddle",
        intensity: 5,
        lat: null,
        lng: null,
      },
      {
        id: "banda",
        label: "La Banda",
        level: "low",
        message: "En monitoreo",
        hint: "Mantenete disponible",
        position: "leftBottom",
        intensity: 2,
        lat: null,
        lng: null,
      },
    ],
    []
  );

  const handleSelectHeatZone = (zone) => {
    console.log("[DRIVER_HEATMAP] Zona seleccionada:", zone);
  };

  const formatMoney = (value) => {
    const num = Number(value || 0);
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(num);
  };

  const buildAdmissionRequestPayload = ({
    gpsStatus = "offline",
    reason = "manual_request",
    coords = null,
  }) => {
    const hasValidCoords =
      coords &&
      typeof coords.lat === "number" &&
      typeof coords.lng === "number";

    return {
      cadeteId,
      sessionId: sessionIdRef.current,
      source: "driver_app",
      requestedAt: Date.now(),
      lastSeen: Date.now(),
      online: true,
      trackingActive: true,
      gpsStatus,
      locationValid: hasValidCoords,
      lat: hasValidCoords ? coords.lat : null,
      lng: hasValidCoords ? coords.lng : null,
      accuracy: hasValidCoords ? coords.accuracy ?? null : null,
      estadoCadete: pedidoActivo ? "en_pedido" : "disponible",
      workStatus: pedidoActivo ? "busy" : "idle",
      currentOrderId: pedidoActivo?._docId || pedidoActivo?.id || null,
      requestReason: reason,
    };
  };

  const writeAdmissionRequest = async ({
    gpsStatus = "offline",
    reason = "manual_request",
    coords = null,
  } = {}) => {
    if (!cadeteId) return;

    try {
      const payload = buildAdmissionRequestPayload({
        gpsStatus,
        reason,
        coords,
      });

      await set(ref(rtdb, `onlineAdmissionRequests/${cadeteId}`), {
        ...payload,
        admissionStatus: "pending",
        admissionReasons: null,
      });
    } catch (error) {
      console.error("❌ Error escribiendo solicitud de admisión:", error);
    }
  };

  const patchAdmissionRequest = async (partialPayload = {}) => {
    if (!cadeteId) return;

    try {
      await update(ref(rtdb, `onlineAdmissionRequests/${cadeteId}`), {
        ...partialPayload,
        lastSeen: Date.now(),
      });
    } catch (error) {
      console.error("❌ Error actualizando solicitud de admisión:", error);
    }
  };

  const removeAdmissionRequest = async () => {
    if (!cadeteId) return;

    try {
      await set(ref(rtdb, `onlineAdmissionRequests/${cadeteId}`), null);
    } catch (error) {
      console.error("❌ Error removiendo solicitud de admisión:", error);
    }
  };

  const removeDriverLive = async () => {
    if (!cadeteId) return;

    try {
      await set(ref(rtdb, `driversLive/${cadeteId}`), null);
    } catch (error) {
      console.error("❌ Error removiendo driversLive:", error);
    }
  };

  const removeDriverOffers = async () => {
    if (!cadeteId) return;

    try {
      await set(ref(rtdb, `driverOffers/${cadeteId}`), null);
    } catch (error) {
      console.error("❌ Error removiendo driverOffers:", error);
    }
  };

  const patchDriverLive = async (partialPayload = {}) => {
    if (!cadeteId) return;

    try {
      await update(ref(rtdb, `driversLive/${cadeteId}`), {
        ...partialPayload,
        lastSeen: Date.now(),
      });
    } catch (error) {
      console.error("❌ Error actualizando driversLive:", error);
    }
  };

  const stopGpsWatch = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const markOffline = async (reason = "manual_offline") => {
    stopGpsWatch();
    setLiveCoords(null);
    setGeoStatus("idle");
    setGeoError("");
    setWorkStatus("offline");
    setAdmissionState(null);
    setServerPresence(null);
    setPedidoOfertado(null);

    gpsPrimeRef.current = {
      status: "idle",
      promise: null,
      position: null,
      error: null,
    };

    await patchAdmissionRequest({
      online: false,
      trackingActive: false,
      gpsStatus: "offline",
      locationValid: false,
      requestReason: reason,
      workStatus: "offline",
    });

    await removeAdmissionRequest();
    await removeDriverLive();
    await removeDriverOffers();

    sessionIdRef.current = null;
  };

  const getPositionPromise = () =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    });

  const primeGpsPermissionRequest = () => {
    if (!navigator.geolocation) return;
    if (gpsPrimeRef.current.status === "pending") return;

    const promise = getPositionPromise();

    gpsPrimeRef.current = {
      status: "pending",
      promise,
      position: null,
      error: null,
    };

    promise
      .then((position) => {
        gpsPrimeRef.current = {
          status: "success",
          promise: null,
          position,
          error: null,
        };
      })
      .catch((error) => {
        gpsPrimeRef.current = {
          status: "error",
          promise: null,
          position: null,
          error,
        };
      });
  };

  const handleInitialGpsError = async (error) => {
    let message = "No pudimos obtener tu ubicación.";
    let nextStatus = "error";
    let gpsState = "offline";
    let reason = "gps_initial_error";

    if (error.code === 1) {
      message =
        "Permiso de ubicación denegado. Aceptá el permiso de ubicación para poder trabajar.";
      nextStatus = "denied";
      gpsState = "permission_denied";
      reason = "gps_initial_permission_denied";
    }

    if (error.code === 2) {
      message =
        "Ubicación no disponible. Activá el GPS o los servicios de ubicación del celular y volvé a intentar.";
      nextStatus = "unavailable";
      gpsState = "unavailable";
      reason = "gps_initial_position_unavailable";
    }

    if (error.code === 3) {
      message =
        "No pudimos obtener la ubicación a tiempo. Activá el GPS, esperá unos segundos y volvé a intentar.";
      nextStatus = "error";
      gpsState = "timeout";
      reason = "gps_initial_timeout";
    }

    setGeoError(message);
    setGeoStatus(nextStatus);
    setWorkStatus("error");

    await writeAdmissionRequest({
      gpsStatus: gpsState,
      reason,
      coords: null,
    });
  };

  const startGpsWatch = () => {
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const nextCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };

        setLiveCoords(nextCoords);
        setGeoStatus("granted");

        await patchAdmissionRequest({
          trackingActive: true,
          gpsStatus: "ok",
          locationValid: true,
          lat: nextCoords.lat,
          lng: nextCoords.lng,
          accuracy: nextCoords.accuracy ?? null,
          estadoCadete: pedidoActivo ? "en_pedido" : "disponible",
          workStatus: pedidoActivo ? "busy" : "idle",
          currentOrderId: pedidoActivo?._docId || pedidoActivo?.id || null,
          requestReason: pedidoActivo ? "tracking_order" : "tracking_pending_admission",
        });

        if (serverPresence) {
          await patchDriverLive({
            trackingActive: true,
            gpsStatus: "ok",
            locationValid: true,
            lat: nextCoords.lat,
            lng: nextCoords.lng,
            accuracy: nextCoords.accuracy ?? null,
            estadoCadete: pedidoActivo ? "en_pedido" : "disponible",
            workStatus: pedidoActivo ? "busy" : "idle",
            currentOrderId: pedidoActivo?._docId || pedidoActivo?.id || null,
          });
        }
      },
      async (error) => {
        let message = "No pudimos actualizar tu ubicación.";
        let nextStatus = "error";
        let gpsState = "offline";
        let reason = "gps_watch_error";

        if (error.code === 1) {
          message =
            "Permiso de ubicación denegado. Activá la ubicación desde los permisos del navegador o de la app.";
          nextStatus = "denied";
          gpsState = "permission_denied";
          reason = "gps_watch_permission_denied";
        }

        if (error.code === 2) {
          message =
            "Ubicación no disponible. Activá el GPS o los servicios de ubicación del celular y volvé a intentar.";
          nextStatus = "unavailable";
          gpsState = "unavailable";
          reason = "gps_watch_position_unavailable";
        }

        if (error.code === 3) {
          message =
            "No pudimos actualizar la ubicación a tiempo. Activá el GPS, esperá unos segundos y volvé a intentar.";
          nextStatus = "error";
          gpsState = "timeout";
          reason = "gps_watch_timeout";
        }

        setGeoError(message);
        setGeoStatus(nextStatus);
        setWorkStatus("error");

        await patchAdmissionRequest({
          trackingActive: false,
          gpsStatus: gpsState,
          locationValid: false,
          lat: null,
          lng: null,
          accuracy: null,
          requestReason: reason,
        });

        if (serverPresence) {
          await patchDriverLive({
            trackingActive: false,
            gpsStatus: gpsState,
            locationValid: false,
            lat: null,
            lng: null,
            accuracy: null,
          });
        }
      },
      GEO_OPTIONS
    );
  };

  const handleStartWork = async () => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      setGeoError("Este dispositivo no soporta geolocalización.");
      setWorkStatus("error");
      return;
    }

    if (!cadeteId) {
      setGeoStatus("error");
      setGeoError("No pudimos identificar al repartidor logueado.");
      setWorkStatus("error");
      return;
    }

    sessionIdRef.current = createSessionId();

    setWorkStatus("starting");
    setGeoStatus("searching");
    setGeoError("");
    setAdmissionState(null);
    setServerPresence(null);

    stopGpsWatch();

    let position = null;

    try {
      if (gpsPrimeRef.current.status === "success") {
        position = gpsPrimeRef.current.position;
      } else if (gpsPrimeRef.current.status === "pending") {
        position = await gpsPrimeRef.current.promise;
      } else {
        position = await getPositionPromise();
      }
    } catch (error) {
      await handleInitialGpsError(error);
      return;
    }

    if (!position) {
      await handleInitialGpsError({
        code: 2,
        message: "No se recibió posición inicial.",
      });
      return;
    }

    const coords = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };

    gpsPrimeRef.current = {
      status: "idle",
      promise: null,
      position: null,
      error: null,
    };

    setLiveCoords(coords);
    setGeoStatus("granted");
    setWorkStatus("pending_admission");

    await writeAdmissionRequest({
      gpsStatus: "ok",
      reason: "online_admission_requested",
      coords,
    });

    startGpsWatch();
  };

  const handleCancelHoldStart = () => {
    if (workStatus === "offline") {
      setGeoStatus("idle");
      setGeoError("");
    }
  };

  const handleStopWork = async () => {
    await markOffline("manual_stop_work");
  };

  const handleLogout = async () => {
    await markOffline("logout");
    onLogout?.();
  };

  useEffect(() => {
    if (!cadeteId) return;

    const admissionRef = ref(rtdb, `onlineAdmissionRequests/${cadeteId}`);

    const unsubscribe = onValue(
      admissionRef,
      (snapshot) => {
        const value = snapshot.val() || null;
        setAdmissionState(value);

        if (!value) return;

        if (value.admissionStatus === "approved") {
          if (workStatus !== "busy") {
            setWorkStatus(pedidoActivo ? "busy" : "online");
          }
          setGeoError("");
          return;
        }

        if (value.admissionStatus === "rejected") {
          const reasons = Array.isArray(value.admissionReasons)
            ? value.admissionReasons.join(", ")
            : "No pudimos habilitarte.";

          setGeoError(`No habilitado: ${reasons}`);
          setWorkStatus("error");
        }
      },
      (error) => {
        console.error("❌ Error escuchando onlineAdmissionRequests:", error);
      }
    );

    return () => off(admissionRef, "value", unsubscribe);
  }, [cadeteId, pedidoActivo, workStatus]);

  useEffect(() => {
    if (!cadeteId) return;

    const liveRef = ref(rtdb, `driversLive/${cadeteId}`);

    const unsubscribe = onValue(
      liveRef,
      (snapshot) => {
        const value = snapshot.val() || null;
        setServerPresence(value);

        if (!value) return;

        if (value.currentOrderId && workStatus !== "busy") {
          setWorkStatus("busy");
          return;
        }

        if (value.online === true && !value.currentOrderId && workStatus !== "busy") {
          setWorkStatus("online");
        }
      },
      (error) => {
        console.error("❌ Error escuchando driversLive:", error);
      }
    );

    return () => off(liveRef, "value", unsubscribe);
  }, [cadeteId, workStatus]);

  useEffect(() => {
    if (!cadeteId) return;

    const offersRef = ref(rtdb, `driverOffers/${cadeteId}`);

    const unsubscribe = onValue(
      offersRef,
      (snapshot) => {
        const offers = snapshot.val() || null;

        if (!offers) {
          setPedidoOfertado(null);
          return;
        }

        const pendingOffers = Object.entries(offers)
          .map(([orderId, offer]) => ({
            ...offer,
            id: offer?.orderId || orderId,
            orderId: offer?.orderId || orderId,
          }))
          .filter((offer) => offer?.status === "pending")
          .sort((a, b) => Number(b?.offeredAt || 0) - Number(a?.offeredAt || 0));

        if (pendingOffers.length === 0) {
          setPedidoOfertado(null);
          return;
        }

        setPedidoOfertado(pendingOffers[0]);
      },
      (error) => {
        console.error("❌ Error escuchando driverOffers:", error);
      }
    );

    return () => off(offersRef, "value", unsubscribe);
  }, [cadeteId]);

  useEffect(() => {
    if (!pedidoActivo || !serverPresence) return;

    patchDriverLive({
      estadoCadete: "en_pedido",
      workStatus: "busy",
      availableForOffers: false,
      currentOrderId: pedidoActivo?._docId || pedidoActivo?.id || null,
      presenceReason: "order_active",
    });
  }, [pedidoActivo, serverPresence]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!repartidorId) return;

    const q = query(
      collection(db, "orders"),
      where("status", "==", "asignado"),
      where("assignedCadeteId", "==", String(repartidorId))
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setPedidoActivo(null);
          return;
        }

        const docSnap = snap.docs[0];

        setPedidoActivo({
          ...docSnap.data(),
          _docId: docSnap.id,
        });
      },
      (error) => {
        console.error("❌ Error escuchando pedido activo:", error);
      }
    );

    return () => unsubscribe();
  }, [repartidorId]);

  useEffect(() => {
    return () => stopGpsWatch();
  }, []);

  const resolveOrderDocId = (pedido) =>
    pedido?._docId || pedido?.orderId || pedido?.id;

  const aceptarOferta = async (oferta) => {
    const orderDocId = resolveOrderDocId(oferta);
    if (!orderDocId || !cadeteId) return;

    try {
      const orderRef = doc(db, "orders", orderDocId);
      const driverOfferRef = ref(rtdb, `driverOffers/${cadeteId}/${orderDocId}`);
      const queueRef = ref(rtdb, `orderQueue/${orderDocId}`);

      await updateDoc(orderRef, {
        status: "asignado",
        serverStatus: "matched",
        assignmentStatus: "assigned",
        assignedCadeteId: String(cadeteId),
        assignedAt: serverTimestamp(),
        assignedCadete: {
          cadeteId: String(cadeteId),
          nombre: ficha.nombre || "",
          apellido: ficha.apellido || "",
          movilidad: ficha.movilidad || "",
        },
        "offer.state": "accepted",
        "offer.respondedAt": serverTimestamp(),
      });

      await patchDriverLive({
        estadoCadete: "en_pedido",
        workStatus: "busy",
        availableForOffers: false,
        currentOrderId: orderDocId,
        presenceReason: "offer_accepted",
      });

      await patchAdmissionRequest({
        estadoCadete: "en_pedido",
        workStatus: "busy",
        currentOrderId: orderDocId,
      });

      await remove(driverOfferRef);
      await remove(queueRef);

      setPedidoOfertado(null);
      setWorkStatus("busy");
    } catch (error) {
      console.error("❌ Error aceptando oferta:", error);
    }
  };

  const rechazarOferta = async (oferta, reason = "rejected") => {
    const orderDocId = resolveOrderDocId(oferta);
    if (!orderDocId || !cadeteId) return;

    try {
      const driverOfferRef = ref(rtdb, `driverOffers/${cadeteId}/${orderDocId}`);
      const queueRef = ref(rtdb, `orderQueue/${orderDocId}`);
      const queueSnap = await get(queueRef);

      const existingQueue = queueSnap.val() || null;

      const nextExcluded = Array.isArray(existingQueue?.excludedCadeteIds)
        ? [...new Set([...existingQueue.excludedCadeteIds, cadeteId])]
        : [cadeteId];

      if (existingQueue) {
        await update(queueRef, {
          matchStatus: "ready_for_match",
          currentOfferCadeteId: null,
          currentOffer: null,
          excludedCadeteIds: nextExcluded,
        });
      }

      await updateDoc(doc(db, "orders", orderDocId), {
        status: "pendiente",
        serverStatus: "validated_online",
        assignmentStatus: reason === "expired" ? "offer_expired" : "offer_rejected",
        "offer.state": reason,
        "offer.respondedAt": serverTimestamp(),
      });

      await remove(driverOfferRef);

      setPedidoOfertado(null);

      if (serverPresence) {
        await patchDriverLive({
          availableForOffers: true,
          estadoCadete: "disponible",
          workStatus: "idle",
          currentOrderId: null,
          presenceReason: reason === "expired" ? "offer_expired" : "offer_rejected",
        });
      }
    } catch (error) {
      console.error("❌ Error rechazando oferta:", error);
    }
  };

  const finalizarPedido = async (pedido) => {
    const orderDocId = resolveOrderDocId(pedido);
    if (!orderDocId) return;

    try {
      await updateDoc(doc(db, "orders", orderDocId), {
        status: "finalizado",
        finishedAt: serverTimestamp(),
      });

      setPedidoActivo(null);

      if (serverPresence) {
        await patchDriverLive({
          estadoCadete: "disponible",
          workStatus: "idle",
          currentOrderId: null,
          availableForOffers: true,
          presenceReason: "order_finished",
        });
      }

      await patchAdmissionRequest({
        estadoCadete: "disponible",
        workStatus: "idle",
        currentOrderId: null,
      });

      setWorkStatus("online");
    } catch (error) {
      console.error("❌ Error finalizando pedido:", error);
    }
  };

  const renderMainAction = () => {
    if (workStatus === "offline") {
      return (
        <HoldToConfirmButton
          className="driver-main-action driver-main-action--go"
          onStartHold={primeGpsPermissionRequest}
          onCancelHold={handleCancelHoldStart}
          onConfirm={handleStartWork}
          holdMs={3000}
          holdingText="Activando GPS..."
        >
          Mantener para solicitar ingreso online
        </HoldToConfirmButton>
      );
    }

    if (workStatus === "starting" || workStatus === "pending_admission") {
      return (
        <button className="driver-main-action driver-main-action--loading" disabled>
          Validando ingreso...
        </button>
      );
    }

    if (workStatus === "online") {
      return (
        <button
          className="driver-main-action driver-main-action--stop"
          onClick={handleStopWork}
        >
          Dejar de trabajar
        </button>
      );
    }

    if (workStatus === "busy") {
      return (
        <button className="driver-main-action driver-main-action--busy" disabled>
          Pedido en curso
        </button>
      );
    }

    return (
      <HoldToConfirmButton
        className="driver-main-action driver-main-action--go"
        onStartHold={primeGpsPermissionRequest}
        onCancelHold={handleCancelHoldStart}
        onConfirm={handleStartWork}
        holdMs={3000}
        holdingText="Solicitando ubicación..."
      >
        Mantener para reintentar ingreso
      </HoldToConfirmButton>
    );
  };

  const renderServerBox = () => {
    if (admissionState?.admissionStatus === "approved") {
      return (
        <div className="driver-mini-server-box">
          <strong>Estado server:</strong> Habilitado para ofertas
        </div>
      );
    }

    if (admissionState?.admissionStatus === "rejected") {
      return (
        <div className="driver-mini-server-box">
          <strong>Estado server:</strong> Rechazado
        </div>
      );
    }

    if (admissionState) {
      return (
        <div className="driver-mini-server-box">
          <strong>Estado server:</strong> En validación
        </div>
      );
    }

    return null;
  };

  const renderHomePanel = () => {
    return (
      <>
        <section className="driver-status-card">
          <div className="driver-status-top">
            <span className={`driver-status-dot driver-status-dot--${workStatus}`} />
            <span>{statusCopy.pill}</span>
          </div>

          <h1>{statusCopy.label}</h1>
          <p>{statusCopy.text}</p>

          {renderMainAction()}
          {renderServerBox()}

          {geoError && <div className="driver-error-box">{geoError}</div>}
        </section>

        <section className="driver-mini-grid">
          <article className="driver-mini-card">
            <span>Nivel</span>
            <strong>{ficha.nivel || 1}</strong>
          </article>

          <article className="driver-mini-card">
            <span>Dinero</span>
            <strong>{ficha.aptoManejoDinero ? "Apto" : "No apto"}</strong>
          </article>

          <article className="driver-mini-card">
            <span>Deuda</span>
            <strong>{formatMoney(ficha.deudaActual)}</strong>
          </article>

          <article className="driver-mini-card">
            <span>Base</span>
            <strong>{formatMoney(ficha.baseActual)}</strong>
          </article>
        </section>
      </>
    );
  };

  const renderPedidosPanel = () => {
    return (
      <section className="driver-bottom-sheet driver-bottom-sheet--full">
        <div className="driver-sheet-handle" />

        <div className="driver-sheet-header">
          <div>
            <h2>Pedidos</h2>
            <p>Gestioná tu pedido activo.</p>
          </div>
        </div>

        {pedidoActivo ? (
          <CardPedidoActivo pedido={pedidoActivo} onFinalizar={finalizarPedido} />
        ) : (
          <div className="driver-empty-order">
            <div className="driver-empty-icon">□</div>
            <strong>No tenés pedidos activos</strong>
            <span>Cuando aceptes o recibas un pedido, aparecerá en esta sección.</span>
          </div>
        )}
      </section>
    );
  };

  const renderBilleteraPanel = () => {
    return (
      <section className="driver-bottom-sheet driver-bottom-sheet--full">
        <div className="driver-sheet-handle" />

        <div className="driver-sheet-header">
          <div>
            <h2>Billetera</h2>
            <p>Resumen económico del repartidor.</p>
          </div>
        </div>

        <div className="driver-wallet-grid">
          <article>
            <span>Dinero disponible</span>
            <strong>{formatMoney(ficha.dineroDisponible)}</strong>
          </article>

          <article>
            <span>Deuda actual</span>
            <strong>{formatMoney(ficha.deudaActual)}</strong>
          </article>

          <article>
            <span>Multa actual</span>
            <strong>{formatMoney(ficha.multaActual)}</strong>
          </article>

          <article>
            <span>Base actual</span>
            <strong>{formatMoney(ficha.baseActual)}</strong>
          </article>
        </div>
      </section>
    );
  };

  const renderPerfilPanel = () => {
    return (
      <section className="driver-bottom-sheet driver-bottom-sheet--full">
        <div className="driver-sheet-handle" />

        <div className="driver-sheet-header">
          <div>
            <h2>Perfil</h2>
            <p>Ficha del repartidor logueado.</p>
          </div>
        </div>

        <div className="driver-profile-list">
          <div>
            <span>ID</span>
            <strong>{ficha.id || repartidorId}</strong>
          </div>

          <div>
            <span>Nombre</span>
            <strong>{nombreCompleto || "Repartidor"}</strong>
          </div>

          <div>
            <span>Movilidad</span>
            <strong>{ficha.movilidad || "-"}</strong>
          </div>

          <div>
            <span>Sucursal</span>
            <strong>{ficha.sucursal || "-"}</strong>
          </div>

          <div>
            <span>Tipo</span>
            <strong>{ficha.tipoRepartidor || "-"}</strong>
          </div>

          <div>
            <span>Celular</span>
            <strong>{ficha.celular || "-"}</strong>
          </div>
        </div>

        <button className="driver-logout-btn" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </section>
    );
  };

  return (
    <div className="driver-root">
      <main className="driver-main">
        <DriverHeatMap
          ficha={ficha}
          repartidorId={repartidorId}
          nombreCompleto={nombreCompleto}
          workStatus={workStatus}
          geoStatus={geoStatus}
          liveCoords={liveCoords}
          pedidoActivo={pedidoActivo}
          heatZones={heatZones}
          onLogout={handleLogout}
          onSelectZone={handleSelectHeatZone}
        />

        <div className="driver-content">
          {activeTab === "home" && renderHomePanel()}
          {activeTab === "pedidos" && renderPedidosPanel()}
          {activeTab === "billetera" && renderBilleteraPanel()}
          {activeTab === "perfil" && renderPerfilPanel()}
        </div>
      </main>

      <DriverActionSheet
        workStatus={workStatus}
        geoStatus={geoStatus}
        geoError={geoError}
        pedidoOfertado={pedidoOfertado}
        pedidoActivo={pedidoActivo}
        segundosOferta={20}
        onAceptarOferta={aceptarOferta}
        onRechazarOferta={(pedido) => rechazarOferta(pedido, "rejected")}
        onTimeoutOferta={(pedido) => rechazarOferta(pedido, "expired")}
        onFinalizarPedido={finalizarPedido}
      />

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />
    </div>
  );
}

export default Home;