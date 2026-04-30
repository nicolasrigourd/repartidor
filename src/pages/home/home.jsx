import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function resolveUiMode({
  transientMode,
  admissionState,
  serverPresence,
  pedidoOfertado,
  pedidoActivo,
}) {
  if (transientMode === "starting") return "starting";
  if (transientMode === "error") return "error";

  if (pedidoActivo) return "busy";
  if (serverPresence?.currentOrderId) return "busy";
  if (pedidoOfertado) return "online";
  if (serverPresence?.online === true) return "online";

  if (admissionState?.admissionStatus === "approved") return "online";
  if (admissionState?.admissionStatus === "pending") return "pending_admission";
  if (admissionState?.admissionStatus === "rejected") return "error";

  return "offline";
}

function Home({ repartidorId, user, onLogout }) {
  const ficha = user?.ficha || user || {};
  const nombreCompleto = `${ficha.nombre || ""} ${ficha.apellido || ""}`.trim();

  const [activeTab, setActiveTab] = useState("home");

  const [geoStatus, setGeoStatus] = useState("idle");
  const [geoError, setGeoError] = useState("");
  const [liveCoords, setLiveCoords] = useState(null);

  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  const [admissionState, setAdmissionState] = useState(null);
  const [serverPresence, setServerPresence] = useState(null);

  const [transientMode, setTransientMode] = useState(null);
  const [admissionLoaded, setAdmissionLoaded] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [offersLoaded, setOffersLoaded] = useState(false);
  const [activeOrderLoaded, setActiveOrderLoaded] = useState(false);

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

  const isBootstrapping =
    !admissionLoaded || !liveLoaded || !offersLoaded || !activeOrderLoaded;

  const workStatus = useMemo(
    () =>
      resolveUiMode({
        transientMode,
        admissionState,
        serverPresence,
        pedidoOfertado,
        pedidoActivo,
      }),
    [transientMode, admissionState, serverPresence, pedidoOfertado, pedidoActivo]
  );

  const shouldTrackGps = useMemo(() => {
    return ["pending_admission", "online", "busy"].includes(workStatus);
  }, [workStatus]);

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

  const resolveOrderDocId = useCallback((pedido) => {
    return pedido?._docId || pedido?.orderId || pedido?.id;
  }, []);

  const buildAdmissionRequestPayload = useCallback(
    ({ gpsStatus = "offline", reason = "manual_request", coords = null }) => {
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
    },
    [cadeteId, pedidoActivo]
  );

  const writeAdmissionRequest = useCallback(
    async ({ gpsStatus = "offline", reason = "manual_request", coords = null } = {}) => {
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
    },
    [cadeteId, buildAdmissionRequestPayload]
  );

  const patchAdmissionRequest = useCallback(
    async (partialPayload = {}) => {
      if (!cadeteId) return;

      try {
        await update(ref(rtdb, `onlineAdmissionRequests/${cadeteId}`), {
          ...partialPayload,
          lastSeen: Date.now(),
        });
      } catch (error) {
        console.error("❌ Error actualizando solicitud de admisión:", error);
      }
    },
    [cadeteId]
  );

  const removeAdmissionRequest = useCallback(async () => {
    if (!cadeteId) return;

    try {
      await set(ref(rtdb, `onlineAdmissionRequests/${cadeteId}`), null);
    } catch (error) {
      console.error("❌ Error removiendo solicitud de admisión:", error);
    }
  }, [cadeteId]);

  const removeDriverLive = useCallback(async () => {
    if (!cadeteId) return;

    try {
      await set(ref(rtdb, `driversLive/${cadeteId}`), null);
    } catch (error) {
      console.error("❌ Error removiendo driversLive:", error);
    }
  }, [cadeteId]);

  const removeDriverOffers = useCallback(async () => {
    if (!cadeteId) return;

    try {
      await set(ref(rtdb, `driverOffers/${cadeteId}`), null);
    } catch (error) {
      console.error("❌ Error removiendo driverOffers:", error);
    }
  }, [cadeteId]);

  const patchDriverLive = useCallback(
    async (partialPayload = {}) => {
      if (!cadeteId) return;

      try {
        await update(ref(rtdb, `driversLive/${cadeteId}`), {
          ...partialPayload,
          lastSeen: Date.now(),
        });
      } catch (error) {
        console.error("❌ Error actualizando driversLive:", error);
      }
    },
    [cadeteId]
  );

  const stopGpsWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const releasePendingOfferOnOffline = useCallback(
    async (offer) => {
      const orderDocId = resolveOrderDocId(offer);
      if (!orderDocId || !cadeteId) return;

      try {
        const driverOfferRef = ref(rtdb, `driverOffers/${cadeteId}/${orderDocId}`);
        const queueRef = ref(rtdb, `orderQueue/${orderDocId}`);
        const queueSnap = await get(queueRef);

        const existingQueue = queueSnap.val() || null;

        if (existingQueue) {
          const nextExcluded = Array.isArray(existingQueue?.excludedCadeteIds)
            ? [...new Set([...existingQueue.excludedCadeteIds, cadeteId])]
            : [cadeteId];

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
          assignmentStatus: "offer_expired",
          "offer.state": "expired",
          "offer.respondedAt": serverTimestamp(),
        });

        await remove(driverOfferRef);
      } catch (error) {
        console.error("❌ Error liberando oferta pendiente al quedar offline:", error);
      }
    },
    [cadeteId, resolveOrderDocId]
  );

  const markOffline = useCallback(
    async (reason = "manual_offline") => {
      stopGpsWatch();

      if (pedidoOfertado) {
        await releasePendingOfferOnOffline(pedidoOfertado);
      }

      setLiveCoords(null);
      setGeoStatus("idle");
      setGeoError("");
      setTransientMode(null);

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

      setAdmissionState(null);
      setServerPresence(null);
      setPedidoOfertado(null);

      sessionIdRef.current = null;
    },
    [
      pedidoOfertado,
      patchAdmissionRequest,
      releasePendingOfferOnOffline,
      removeAdmissionRequest,
      removeDriverLive,
      removeDriverOffers,
      stopGpsWatch,
    ]
  );

  const getPositionPromise = useCallback(
    () =>
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
      }),
    []
  );

  const primeGpsPermissionRequest = useCallback(() => {
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
  }, [getPositionPromise]);

  const handleInitialGpsError = useCallback(
    async (error) => {
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
      setTransientMode("error");

      await writeAdmissionRequest({
        gpsStatus: gpsState,
        reason,
        coords: null,
      });
    },
    [writeAdmissionRequest]
  );

  const startGpsWatch = useCallback(() => {
    if (!navigator.geolocation) return;
    if (watchIdRef.current != null) return;

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
          requestReason: pedidoActivo ? "tracking_order" : "tracking_operational",
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
        setTransientMode("error");

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
  }, [patchAdmissionRequest, patchDriverLive, pedidoActivo, serverPresence]);

  const handleStartWork = useCallback(async () => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      setGeoError("Este dispositivo no soporta geolocalización.");
      setTransientMode("error");
      return;
    }

    if (!cadeteId) {
      setGeoStatus("error");
      setGeoError("No pudimos identificar al repartidor logueado.");
      setTransientMode("error");
      return;
    }

    sessionIdRef.current = createSessionId();

    setTransientMode("starting");
    setGeoStatus("searching");
    setGeoError("");

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

    await writeAdmissionRequest({
      gpsStatus: "ok",
      reason: "online_admission_requested",
      coords,
    });

    setTransientMode(null);
    startGpsWatch();
  }, [
    cadeteId,
    getPositionPromise,
    handleInitialGpsError,
    startGpsWatch,
    stopGpsWatch,
    writeAdmissionRequest,
  ]);

  const handleCancelHoldStart = useCallback(() => {
    if (workStatus === "offline") {
      setGeoStatus("idle");
      setGeoError("");
    }
  }, [workStatus]);

  const handleStopWork = useCallback(async () => {
    await markOffline("manual_stop_work");
  }, [markOffline]);

  const handleLogout = useCallback(async () => {
    await markOffline("logout");
    onLogout?.();
  }, [markOffline, onLogout]);

  useEffect(() => {
    if (!cadeteId) return;

    const admissionRef = ref(rtdb, `onlineAdmissionRequests/${cadeteId}`);

    const unsubscribe = onValue(
      admissionRef,
      (snapshot) => {
        const value = snapshot.val() || null;
        setAdmissionState(value);
        setAdmissionLoaded(true);

        if (!value) return;

        if (value.admissionStatus === "approved") {
          setGeoError("");
          setTransientMode(null);
          return;
        }

        if (value.admissionStatus === "rejected") {
          const reasons = Array.isArray(value.admissionReasons)
            ? value.admissionReasons.join(", ")
            : "No pudimos habilitarte.";

          setGeoError(`No habilitado: ${reasons}`);
          setTransientMode("error");
        }
      },
      (error) => {
        console.error("❌ Error escuchando onlineAdmissionRequests:", error);
        setAdmissionLoaded(true);
      }
    );

    return () => off(admissionRef, "value", unsubscribe);
  }, [cadeteId]);

  useEffect(() => {
    if (!cadeteId) return;

    const liveRef = ref(rtdb, `driversLive/${cadeteId}`);

    const unsubscribe = onValue(
      liveRef,
      (snapshot) => {
        const value = snapshot.val() || null;
        setServerPresence(value);
        setLiveLoaded(true);
      },
      (error) => {
        console.error("❌ Error escuchando driversLive:", error);
        setLiveLoaded(true);
      }
    );

    return () => off(liveRef, "value", unsubscribe);
  }, [cadeteId]);

  useEffect(() => {
    if (!cadeteId) return;

    const offersRef = ref(rtdb, `driverOffers/${cadeteId}`);

    const unsubscribe = onValue(
      offersRef,
      (snapshot) => {
        const offers = snapshot.val() || null;
        setOffersLoaded(true);

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
        setOffersLoaded(true);
      }
    );

    return () => off(offersRef, "value", unsubscribe);
  }, [cadeteId]);

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
        setActiveOrderLoaded(true);

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
        setActiveOrderLoaded(true);
      }
    );

    return () => unsubscribe();
  }, [repartidorId]);

  const activeOrderPresenceSignature = useMemo(() => {
    const activeOrderId = pedidoActivo?._docId || pedidoActivo?.id || null;

    return {
      shouldWrite: Boolean(activeOrderId && serverPresence),
      activeOrderId,
      currentOrderId: serverPresence?.currentOrderId ?? null,
      estadoCadete: serverPresence?.estadoCadete ?? null,
      workStatus: serverPresence?.workStatus ?? null,
      availableForOffers: serverPresence?.availableForOffers ?? null,
    };
  }, [pedidoActivo, serverPresence]);

  useEffect(() => {
    if (!activeOrderPresenceSignature.shouldWrite) return;

    const shouldPatch =
      activeOrderPresenceSignature.currentOrderId !== activeOrderPresenceSignature.activeOrderId ||
      activeOrderPresenceSignature.estadoCadete !== "en_pedido" ||
      activeOrderPresenceSignature.workStatus !== "busy" ||
      activeOrderPresenceSignature.availableForOffers !== false;

    if (!shouldPatch) return;

    patchDriverLive({
      estadoCadete: "en_pedido",
      workStatus: "busy",
      availableForOffers: false,
      currentOrderId: activeOrderPresenceSignature.activeOrderId,
      presenceReason: "order_active",
    });
  }, [activeOrderPresenceSignature, patchDriverLive]);

  useEffect(() => {
    if (isBootstrapping) return;

    if (shouldTrackGps) {
      startGpsWatch();
      return;
    }

    stopGpsWatch();
  }, [shouldTrackGps, isBootstrapping, startGpsWatch, stopGpsWatch]);

  useEffect(() => {
    return () => stopGpsWatch();
  }, [stopGpsWatch]);

  const aceptarOferta = useCallback(
    async (oferta) => {
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
        setTransientMode(null);
      } catch (error) {
        console.error("❌ Error aceptando oferta:", error);
      }
    },
    [cadeteId, ficha, patchAdmissionRequest, patchDriverLive, resolveOrderDocId]
  );

  const rechazarOferta = useCallback(
    async (oferta, reason = "rejected") => {
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

        await patchAdmissionRequest({
          estadoCadete: "disponible",
          workStatus: "idle",
          currentOrderId: null,
        });
      } catch (error) {
        console.error("❌ Error rechazando oferta:", error);
      }
    },
    [cadeteId, patchAdmissionRequest, patchDriverLive, resolveOrderDocId, serverPresence]
  );

  const finalizarPedido = useCallback(
    async (pedido) => {
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

        setTransientMode(null);
      } catch (error) {
        console.error("❌ Error finalizando pedido:", error);
      }
    },
    [patchAdmissionRequest, patchDriverLive, resolveOrderDocId, serverPresence]
  );

  const handleAceptarOferta = useCallback(
    (pedido) => aceptarOferta(pedido),
    [aceptarOferta]
  );

  const handleRechazarOferta = useCallback(
    (pedido) => rechazarOferta(pedido, "rejected"),
    [rechazarOferta]
  );

  const handleTimeoutOferta = useCallback(
    (pedido) => rechazarOferta(pedido, "expired"),
    [rechazarOferta]
  );

  const renderMainAction = () => {
    if (isBootstrapping) {
      return (
        <button className="driver-main-action driver-main-action--loading" disabled>
          Sincronizando estado...
        </button>
      );
    }

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

    if (admissionState?.admissionStatus === "pending") {
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
        onAceptarOferta={handleAceptarOferta}
        onRechazarOferta={handleRechazarOferta}
        onTimeoutOferta={handleTimeoutOferta}
        onFinalizarPedido={finalizarPedido}
      />

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />
    </div>
  );
}

export default Home;