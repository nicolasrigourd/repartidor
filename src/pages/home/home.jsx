import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./home.css";

import BottomBar     from "../../components/bottombar/bottombar";
import MapaRepartidor from "../../components/maparepartidor/MapaRepartidor";
import OfertaPantalla from "../../components/ofertapantalla/OfertaPantalla";
import { Bell, UserCircle, SignOut, X, Trophy, House, WifiSlash, ListBullets } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import PedidosPage   from "../pedidos/PedidosPage";
import BilleteraPage from "../billetera/BilleteraPage";
import PerfilPage    from "../perfil/PerfilPage";

import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { ref, set, update, onValue, off } from "firebase/database";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

function getOfferTime(offer) {
  return Number(offer?.offeredAtMs || offer?.offeredAt || offer?.createdAtMs || 0);
}

function normalizeActiveOrderFromRtdb(orderId, activeOrder) {
  if (!activeOrder) return null;

  return {
    ...activeOrder,
    _docId: activeOrder.orderId || orderId,
    id: activeOrder.orderId || orderId,
    orderId: activeOrder.orderId || orderId,
  };
}

function Home({ repartidorId, user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  const ficha = user?.ficha || user || {};
  const nombreCompleto = `${ficha.nombre || ""} ${ficha.apellido || ""}`.trim();

  const [activeTab, setActiveTab] = useState("home");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [previewCoords, setPreviewCoords] = useState(null);

  // ── Stats desde IndexedDB (reactivos vía useLiveQuery) ────
  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const mesKey   = useMemo(() => todayKey.slice(0, 7), [todayKey]);

  const statsHoy = useLiveQuery(
    () => repartidorDb.estadisticas.get(`hoy_${todayKey}`),
    [todayKey]
  );
  const statsMes = useLiveQuery(
    () => repartidorDb.estadisticas.get(`mes_${mesKey}`),
    [mesKey]
  );
  const statsTotal = useLiveQuery(
    () => repartidorDb.estadisticas.get("total"),
    []
  );

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
        ficha.driverId ||
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
        // Coordenadas reales Santiago del Estero — configurables desde admin en el futuro
        lat: -27.7951, lng: -64.2615, radio: 700,
      },
      {
        id: "norte",
        label: "B° Norte",
        level: "medium",
        message: "Actividad moderada",
        hint: "Buena zona de espera",
        position: "rightMiddle",
        intensity: 5,
        lat: -27.760, lng: -64.255, radio: 550,
      },
      {
        id: "banda",
        label: "La Banda",
        level: "low",
        message: "En monitoreo",
        hint: "Mantenete disponible",
        position: "leftBottom",
        intensity: 2,
        lat: -27.735, lng: -64.240, radio: 450,
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
        driverId: cadeteId,
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
        currentOrderId:
          pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id || null,
        currentOfferOrderId: serverPresence?.currentOfferOrderId || null,
        requestReason: reason,
      };
    },
    [cadeteId, pedidoActivo, serverPresence]
  );

  const writeAdmissionRequest = useCallback(
    async ({
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

  const markOfferAs = useCallback(
    async (offer, status, extraPayload = {}) => {
      const orderDocId = resolveOrderDocId(offer);

      if (!orderDocId || !cadeteId) return;

      try {
        const driverOfferRef = ref(
          rtdb,
          `driverOffers/${cadeteId}/${orderDocId}`
        );

        await update(driverOfferRef, {
          status,
          state: status,
          respondedAt: Date.now(),
          respondedAtMs: Date.now(),
          responseSource: "driver_app",
          ...extraPayload,
        });

        setPedidoOfertado(null);
      } catch (error) {
        console.error(`❌ Error marcando oferta como ${status}:`, error);
      }
    },
    [cadeteId, resolveOrderDocId]
  );

  const releasePendingOfferOnOffline = useCallback(
    async (offer) => {
      await markOfferAs(offer, "rejected", {
        responseReason: "driver_offline",
      });
    },
    [markOfferAs]
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
      setPedidoActivo(null);

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

        const activeOrderId =
          pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id || null;

        setLiveCoords(nextCoords);
        setGeoStatus("granted");

        await patchAdmissionRequest({
          trackingActive: true,
          gpsStatus: "ok",
          locationValid: true,
          lat: nextCoords.lat,
          lng: nextCoords.lng,
          accuracy: nextCoords.accuracy ?? null,
          estadoCadete: activeOrderId ? "en_pedido" : "disponible",
          workStatus: activeOrderId ? "busy" : "idle",
          currentOrderId: activeOrderId,
          requestReason: activeOrderId ? "tracking_order" : "tracking_operational",
        });

        if (serverPresence) {
          await patchDriverLive({
            trackingActive: true,
            gpsStatus: "ok",
            locationValid: true,
            lat: nextCoords.lat,
            lng: nextCoords.lng,
            accuracy: nextCoords.accuracy ?? null,
            estadoCadete: activeOrderId ? "en_pedido" : "disponible",
            workStatus: activeOrderId ? "busy" : "idle",
            currentOrderId: activeOrderId,
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
            _docId: offer?.orderId || orderId,
            id: offer?.orderId || orderId,
            orderId: offer?.orderId || orderId,
          }))
          .filter((offer) => offer?.status === "pending")
          .sort((a, b) => getOfferTime(b) - getOfferTime(a));

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
    if (!cadeteId) return;

    const activeOrdersRef = ref(rtdb, `driverActiveOrders/${cadeteId}`);

    const unsubscribe = onValue(
      activeOrdersRef,
      (snapshot) => {
        const activeOrders = snapshot.val() || null;
        setActiveOrderLoaded(true);

        if (!activeOrders) {
          setPedidoActivo(null);
          return;
        }

        const activeList = Object.entries(activeOrders)
          .map(([orderId, order]) =>
            normalizeActiveOrderFromRtdb(orderId, order)
          )
          .filter((order) => {
            if (!order) return false;
            if (order.status === "delivered") return false;
            if (order.status === "completed") return false;
            if (order.status === "cancelled") return false;
            return true;
          })
          .sort(
            (a, b) =>
              Number(b?.acceptedAtMs || b?.updatedAtMs || 0) -
              Number(a?.acceptedAtMs || a?.updatedAtMs || 0)
          );

        setPedidoActivo(activeList[0] || null);
      },
      (error) => {
        console.error("❌ Error escuchando driverActiveOrders:", error);
        setActiveOrderLoaded(true);
      }
    );

    return () => off(activeOrdersRef, "value", unsubscribe);
  }, [cadeteId]);

  useEffect(() => {
    const activeOrderId = pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id;

    if (!activeOrderId) return;

    const targetPath = `/pedido-activo/${activeOrderId}`;

    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [pedidoActivo, location.pathname, navigate]);

  const activeOrderPresenceSignature = useMemo(() => {
    const activeOrderId =
      pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id || null;

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
      activeOrderPresenceSignature.currentOrderId !==
        activeOrderPresenceSignature.activeOrderId ||
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

  // GPS preview — posición local cuando offline, sin escribir a Firebase
  useEffect(() => {
    const isOnline = ["online", "busy", "pending_admission", "starting"].includes(workStatus);
    if (isOnline || activeTab !== "home" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setPreviewCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [workStatus, activeTab]);

  const aceptarOferta = useCallback(
    async (oferta) => {
      await markOfferAs(oferta, "accepted", {
        responseReason: "driver_accepted",
      });

      setTransientMode(null);
    },
    [markOfferAs]
  );

  const rechazarOferta = useCallback(
    async (oferta, reason = "rejected") => {
      const nextStatus = reason === "expired" ? "expired" : "rejected";

      await markOfferAs(oferta, nextStatus, {
        responseReason: reason,
      });

      setTransientMode(null);
    },
    [markOfferAs]
  );

  const finalizarPedido = useCallback(
    async (pedido) => {
      const orderDocId = resolveOrderDocId(pedido);
      if (!orderDocId) return;

      const nowMs = Date.now();

      try {
        await updateDoc(doc(db, "orders", orderDocId), {
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

        await update(ref(rtdb, `driverActiveOrders/${cadeteId}/${orderDocId}`), {
          status: "delivered",
          currentStep: "delivered",
          operationalStatus: "delivered",
          finishedAtMs: nowMs,
          updatedAtMs: nowMs,
        });

        setPedidoActivo(null);

        if (serverPresence) {
          await patchDriverLive({
            estadoCadete: "disponible",
            workStatus: "idle",
            currentOrderId: null,
            currentOfferOrderId: null,
            currentOfferExpiresAt: null,
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
    [
      cadeteId,
      patchAdmissionRequest,
      patchDriverLive,
      resolveOrderDocId,
      serverPresence,
    ]
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
        <button
          className="driver-main-action driver-main-action--busy"
          onClick={() => {
            const activeOrderId =
              pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id;
            if (activeOrderId) navigate(`/pedido-activo/${activeOrderId}`);
          }}
        >
          Continuar pedido
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
            <span>Dinero en cuenta</span>
            <strong>{formatMoney(ficha.dineroEnCuenta)}</strong>
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

  // ── Oferta: coordenadas del pickup para mostrar en el mapa ─
  const ofertaPickupCoords = useMemo(() => {
    if (!pedidoOfertado) return null;
    const c = pedidoOfertado.pickup?.coords
      || pedidoOfertado.originCoords
      || pedidoOfertado.pickupCoords;
    return c?.lat && c?.lng ? c : null;
  }, [pedidoOfertado]);

  const estaOnline = ["online", "busy", "pending_admission", "starting"].includes(workStatus);

  // ── Header compartido ─────────────────────────────────────
  const renderHeader = () => (
    <>
      <header className="driver-header">
        <div className="driver-header__left">
          <span className={`drv-status-dot drv-status-dot--${workStatus}`} />
          <div className="driver-header__greeting">
            <span className="driver-header__hola">Hola,</span>
            <span className="driver-header__name">{ficha.nombre || nombreCompleto || "Repartidor"}</span>
          </div>
        </div>
        <div className="driver-header__actions">
          <button type="button" className="driver-header__icon-btn" aria-label="Notificaciones">
            <Bell size={20} weight="regular" />
          </button>
          <button
            type="button"
            className={`driver-header__icon-btn ${showProfileMenu ? "driver-header__icon-btn--active" : ""}`}
            onClick={() => setShowProfileMenu(v => !v)}
          >
            <UserCircle size={22} weight="regular" />
          </button>
        </div>
      </header>
      {showProfileMenu && (
        <div className="driver-profile-menu">
          <div className="driver-profile-menu__info">
            <span className="driver-profile-menu__name">{nombreCompleto || "Repartidor"}</span>
            <span className="driver-profile-menu__id">ID {ficha.id || repartidorId} · {ficha.sucursal || "—"}</span>
          </div>
          <button type="button" className="driver-profile-menu__logout"
            onClick={() => { setShowProfileMenu(false); handleLogout(); }}>
            <SignOut size={16} weight="bold" />Cerrar sesión
          </button>
          <button type="button" className="driver-profile-menu__close"
            onClick={() => setShowProfileMenu(false)}>
            <X size={14} weight="bold" />
          </button>
        </div>
      )}
    </>
  );

  // ── Tarjeta de nivel (inline en home offline) ──────────────
  const renderLevelCard = () => {
    const THRESHOLDS = [0, 20, 50, 100, 200, 500];
    const lvl        = Math.max(1, ficha?.nivel || ficha?.level || 1);
    const total      = statsTotal?.pedidosCompletados || 0;
    const isMax      = lvl >= THRESHOLDS.length - 1;
    const start      = THRESHOLDS[lvl - 1] || 0;
    const nextAt     = THRESHOLDS[lvl] || 500;
    const progress   = isMax ? 1 : Math.min(Math.max(total - start, 0) / (nextAt - start), 1);
    const restantes  = isMax ? 0 : Math.max(nextAt - total, 0);

    return (
      <div className="drv-level-card">
        <div className="drv-level-card__top">
          <div className="drv-level-badge">
            <Trophy size={14} weight="fill" />
            <span>Nivel {lvl}</span>
          </div>
          <span className="drv-level-hint">
            {isMax ? "🏆 Nivel máximo" : `${restantes} pedidos para nivel ${lvl + 1}`}
          </span>
        </div>
        <div className="drv-level-bar">
          <div className="drv-level-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    );
  };

  // ── Action button ──────────────────────────────────────────
  const renderActionButton = () => {
    if (isBootstrapping) {
      return (
        <button className="drv-action drv-action--loading" disabled>
          Sincronizando...
        </button>
      );
    }
    if (workStatus === "offline" || workStatus === "error") {
      return (
        <button className="drv-action drv-action--connect" onClick={handleStartWork}>
          Conectarme
        </button>
      );
    }
    if (workStatus === "starting" || workStatus === "pending_admission") {
      return (
        <button className="drv-action drv-action--loading" disabled>
          {workStatus === "starting" ? "Buscando GPS…" : "Validando ingreso…"}
        </button>
      );
    }
    if (workStatus === "online") {
      return (
        <button className="drv-action drv-action--disconnect" onClick={handleStopWork}>
          Desconectarme
        </button>
      );
    }
    if (workStatus === "busy") {
      const activeId = pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id;
      return (
        <button
          className="drv-action drv-action--busy"
          onClick={() => activeId && navigate(`/pedido-activo/${activeId}`)}
        >
          Ver pedido activo
        </button>
      );
    }
    return null;
  };

  // ── (dead code — tabs now are full pages) ─────────────────
  const renderHomeTab = () => {
    const pedidosHoy  = statsHoy?.pedidosCompletados  ?? 0;
    const gananciaHoy = statsHoy?.gananciaTotal        ?? 0;
    const pedidosMes  = statsMes?.pedidosCompletados   ?? 0;
    const rating      = statsTotal?.avgRating           ?? null;

    return (
      <div className="drv-home-tab">
        {/* Estado operativo */}
        <div className="drv-status-row">
          <span className={`drv-status-dot drv-status-dot--${workStatus}`} />
          <div className="drv-status-text">
            <strong>{statusCopy.label}</strong>
            <small>{statusCopy.text}</small>
          </div>
        </div>

        {geoError && <div className="drv-error-box">{geoError}</div>}

        {/* Fila 1 — Stats operacionales (IndexedDB) */}
        <div className="drv-stats-row">
          <div className="drv-stat-card drv-stat-card--accent">
            <div className="drv-stat-card__icon"><Package size={16} weight="fill" /></div>
            <strong>{pedidosHoy}</strong>
            <span>Pedidos hoy</span>
          </div>
          <div className="drv-stat-card drv-stat-card--green">
            <div className="drv-stat-card__icon"><ArrowUp size={16} weight="bold" /></div>
            <strong>{formatMoney(gananciaHoy)}</strong>
            <span>Ganancia hoy</span>
          </div>
          <div className="drv-stat-card">
            <div className="drv-stat-card__icon"><Package size={16} weight="regular" /></div>
            <strong>{pedidosMes}</strong>
            <span>Este mes</span>
          </div>
          <div className="drv-stat-card">
            <div className="drv-stat-card__icon"><Star size={16} weight="fill" color="#FBBF24" /></div>
            <strong>{rating !== null ? rating.toFixed(1) : "—"}</strong>
            <span>Rating</span>
          </div>
        </div>

        {/* Fila 2 — Estado financiero (ficha / Firestore) */}
        <div className="drv-metrics">
          <div className="drv-metric">
            <span>Disponible</span>
            <strong>{formatMoney(ficha.dineroDisponible)}</strong>
          </div>
          <div className="drv-metric">
            <span>Deuda</span>
            <strong className={ficha.deudaActual > 0 ? "drv-metric--danger" : ""}>
              {formatMoney(ficha.deudaActual)}
            </strong>
          </div>
          <div className="drv-metric">
            <span>Base</span>
            <strong>{formatMoney(ficha.baseActual)}</strong>
          </div>
          <div className="drv-metric">
            <span>Multa</span>
            <strong className={ficha.multaActual > 0 ? "drv-metric--danger" : ""}>
              {formatMoney(ficha.multaActual)}
            </strong>
          </div>
        </div>

        {renderActionButton()}
      </div>
    );
  };

  // ── Pedidos tab ────────────────────────────────────────────
  const renderPedidosTab = () => (
    <div className="drv-tab-content">
      <p className="drv-tab-title">Pedidos</p>
      {pedidoActivo ? (
        <PedidoActivoCard
          pedido={pedidoActivo}
          onVerDetalle={() => {
            const id = pedidoActivo?._docId || pedidoActivo?.orderId || pedidoActivo?.id;
            if (id) navigate(`/pedido-activo/${id}`);
          }}
        />
      ) : (
        <div className="drv-empty-state">
          <span>Sin pedidos activos</span>
          <small>Cuando aceptes un pedido aparecerá aquí.</small>
        </div>
      )}
    </div>
  );

  // ── Billetera tab ──────────────────────────────────────────
  const renderBilleteraTab = () => (
    <div className="drv-tab-content">
      <p className="drv-tab-title">Billetera</p>
      <div className="drv-wallet-grid">
        <article><span>Disponible</span><strong>{formatMoney(ficha.dineroDisponible)}</strong></article>
        <article><span>En cuenta</span><strong>{formatMoney(ficha.dineroEnCuenta || 0)}</strong></article>
        <article><span>Deuda</span><strong>{formatMoney(ficha.deudaActual)}</strong></article>
        <article><span>Multa</span><strong>{formatMoney(ficha.multaActual)}</strong></article>
        <article><span>Base hoy</span><strong>{formatMoney(ficha.baseActual)}</strong></article>
      </div>
    </div>
  );

  // ── Perfil tab ─────────────────────────────────────────────
  const renderPerfilTab = () => (
    <div className="drv-tab-content">
      <p className="drv-tab-title">Perfil</p>
      <div className="drv-profile-list">
        <div><span>ID</span><strong>{ficha.id || repartidorId}</strong></div>
        <div><span>Nombre</span><strong>{nombreCompleto || "—"}</strong></div>
        <div><span>Movilidad</span><strong>{ficha.movilidad || "—"}</strong></div>
        <div><span>Sucursal</span><strong>{ficha.sucursal || "—"}</strong></div>
        <div><span>Celular</span><strong>{ficha.celular || "—"}</strong></div>
      </div>
      <button className="drv-logout-btn" onClick={handleLogout}>
        Cerrar sesión
      </button>
    </div>
  );

  // ── Tabs que no son home → página completa ────────────────
  if (activeTab !== "home") {
    return (
      <div className="driver-root driver-root--page">
        {renderHeader()}
        <div className="driver-page-scroll">
          {activeTab === "pedidos"   && <PedidosPage />}
          {activeTab === "billetera" && <BilleteraPage ficha={ficha} />}
          {activeTab === "perfil"    && (
            <PerfilPage
              ficha={ficha}
              nombreCompleto={nombreCompleto}
              repartidorId={repartidorId}
              onLogout={handleLogout}
            />
          )}
        </div>
        <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />
      </div>
    );
  }

  // ── Home tab ───────────────────────────────────────────────
  return (
    <div className="driver-root">
      {pedidoOfertado && (
        <OfertaPantalla
          oferta={pedidoOfertado}
          ttlMs={20000}
          onAceptar={() => handleAceptarOferta(pedidoOfertado)}
          onRechazar={(reason) => {
            if (reason === "expired") handleTimeoutOferta(pedidoOfertado);
            else handleRechazarOferta(pedidoOfertado);
          }}
        />
      )}

      {!estaOnline ? (
        /* MODO OFFLINE — info panel + mapa embebido */
        <>
          {renderHeader()}
          <div className="driver-offline-scroll">
            <div className="drv-money-row">
              <div className="drv-money-card">
                <span>Disponible</span>
                <strong>{formatMoney(ficha.dineroDisponible)}</strong>
              </div>
              <div className="drv-money-card drv-money-card--gain">
                <span>Ganancia hoy</span>
                <strong>{formatMoney(statsHoy?.gananciaTotal || 0)}</strong>
              </div>
            </div>
            {renderLevelCard()}
            <div className="drv-map-preview">
              <MapaRepartidor
                workStatus="offline"
                liveCoords={previewCoords}
                zonas={heatZones}
                ofertaCoords={null}
                pedidoActivo={null}
              />
            </div>
            {geoError && <div className="drv-error-box">{geoError}</div>}
            {renderActionButton()}
          </div>
          <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />
        </>
      ) : (
        /* MODO ONLINE — mapa full screen */
        <>
          <MapaRepartidor
            workStatus={workStatus}
            liveCoords={liveCoords}
            zonas={heatZones}
            ofertaCoords={ofertaPickupCoords}
            pedidoActivo={workStatus === "busy" ? pedidoActivo : null}
          />
          <div className="driver-online-topbar">
            <button className="driver-online-fab" onClick={() => setActiveTab("pedidos")}>
              <ListBullets size={20} weight="bold" />
            </button>
            <div className="driver-earnings-pill">
              <span>ARS</span>
              <strong>{formatMoney(statsHoy?.gananciaTotal || 0)}</strong>
            </div>
            <button className="driver-online-fab driver-online-fab--danger" onClick={handleStopWork}>
              <WifiSlash size={20} weight="bold" />
            </button>
          </div>
          <div className="driver-online-bottombar">
            <House size={18} weight="fill" color="rgba(240,246,252,0.4)" />
            <span className="driver-online-status">
              {workStatus === "busy"              ? "En pedido activo"   :
               workStatus === "pending_admission" ? "Validando ingreso…" :
               "Estás disponible"}
            </span>
            <span className={`driver-online-dot driver-online-dot--${workStatus}`} />
          </div>
        </>
      )}
    </div>
  );
}

export default Home;