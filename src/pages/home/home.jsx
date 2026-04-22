import { useEffect, useMemo, useRef, useState } from "react";
import "./home.css";

import BottomBar from "../../components/bottombar/bottombar";
import CardPedidoActivo from "../../components/cardpedidoactivo/cardpedidoactivo";
import DriverHeatMap from "../../components/driverheatmap/DriverHeatMap";
import DriverActionSheet from "../../components/driveractionsheet/DriverActionSheet";

import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "../../firebaseconfig";

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

  const handlePointerUp = () => {
    clearHold();
  };

  const handlePointerLeave = () => {
    clearHold();
  };

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

  const watchIdRef = useRef(null);
  const estadoRef = useRef("offline");

  const gpsPrimeRef = useRef({
    status: "idle",
    promise: null,
    position: null,
    error: null,
  });

  useEffect(() => {
    estadoRef.current = workStatus;
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
        text: "Estás conectado y disponible para recibir pedidos.",
        pill: "Online",
      };
    }

    if (workStatus === "starting") {
      return {
        label: "Conectando",
        text: "Estamos activando tu ubicación.",
        pill: "Buscando GPS",
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
      text: "Mantené presionado para activar tu ubicación y quedar disponible.",
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

  const buildPresencePayload = ({
    trackingActive,
    availableForOffers,
    gpsStatus,
    reason,
    coords,
  }) => {
    const estadoCadete = pedidoActivo ? "en_pedido" : "disponible";

    const base = {
      cadeteId: repartidorId,
      repartidorId,
      estadoCadete,
      workStatus,
      trackingActive,
      availableForOffers,
      gpsStatus,
      presenceReason: reason,
      updatedAt: serverTimestamp(),

      nombre: ficha.nombre || "",
      apellido: ficha.apellido || "",
      movilidad: ficha.movilidad || "",
      sucursal: ficha.sucursal || "",
      tipoRepartidor: ficha.tipoRepartidor || "",
      usaApp: ficha.usaApp === true,
      aptoManejoDinero: ficha.aptoManejoDinero === true,
      fotoPerfil: ficha.fotoPerfil || "",
    };

    if (coords) {
      return {
        ...base,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy ?? null,
      };
    }

    return {
      ...base,
      lat: deleteField(),
      lng: deleteField(),
      accuracy: deleteField(),
    };
  };

  const writePresence = async ({
    trackingActive = false,
    availableForOffers = false,
    gpsStatus = "idle",
    reason = "manual_update",
    coords = null,
  } = {}) => {
    if (!repartidorId) return;

    try {
      await setDoc(
        doc(db, "ubicacionesCadetes", String(repartidorId)),
        buildPresencePayload({
          trackingActive,
          availableForOffers,
          gpsStatus,
          reason,
          coords,
        }),
        { merge: true }
      );
    } catch (error) {
      console.error("❌ Error escribiendo presencia:", error);
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

    gpsPrimeRef.current = {
      status: "idle",
      promise: null,
      position: null,
      error: null,
    };

    await writePresence({
      trackingActive: false,
      availableForOffers: false,
      gpsStatus: "disabled",
      reason,
      coords: null,
    });
  };

  const getPositionPromise = () => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    });
  };

  const primeGpsPermissionRequest = () => {
    if (!navigator.geolocation) return;

    if (gpsPrimeRef.current.status === "pending") return;

    console.log("[DRIVER_GPS] Pre-solicitando ubicación por gesto del usuario...");

    const promise = getPositionPromise();

    gpsPrimeRef.current = {
      status: "pending",
      promise,
      position: null,
      error: null,
    };

    promise
      .then((position) => {
        console.log("[DRIVER_GPS] Pre-solicitud GPS exitosa:", position.coords);

        gpsPrimeRef.current = {
          status: "success",
          promise: null,
          position,
          error: null,
        };
      })
      .catch((error) => {
        console.error("[DRIVER_GPS] Error en pre-solicitud GPS:", error);

        gpsPrimeRef.current = {
          status: "error",
          promise: null,
          position: null,
          error,
        };
      });
  };

  const handleInitialGpsError = async (error) => {
    console.error("[DRIVER_GPS] Error getCurrentPosition:", error);

    let message = "No pudimos obtener tu ubicación.";
    let nextStatus = "error";
    let reason = "gps_initial_error";

    if (error.code === 1) {
      message =
        "Permiso de ubicación denegado. Aceptá el permiso de ubicación para poder trabajar.";
      nextStatus = "denied";
      reason = "gps_initial_permission_denied";
    }

    if (error.code === 2) {
      message =
        "Ubicación no disponible. Activá el GPS o los servicios de ubicación del celular y volvé a intentar.";
      nextStatus = "unavailable";
      reason = "gps_initial_position_unavailable";
    }

    if (error.code === 3) {
      message =
        "No pudimos obtener la ubicación a tiempo. Activá el GPS, esperá unos segundos y volvé a intentar.";
      nextStatus = "error";
      reason = "gps_initial_timeout";
    }

    setGeoError(message);
    setGeoStatus(nextStatus);
    setWorkStatus("error");

    await writePresence({
      trackingActive: false,
      availableForOffers: false,
      gpsStatus: nextStatus,
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

        console.log("[DRIVER_GPS] Ubicación actualizada:", nextCoords);

        setLiveCoords(nextCoords);
        setGeoStatus("granted");

        const isBusy = estadoRef.current === "busy";

        await writePresence({
          trackingActive: true,
          availableForOffers: !isBusy,
          gpsStatus: "granted",
          reason: isBusy ? "tracking_order" : "tracking_available",
          coords: nextCoords,
        });
      },
      async (error) => {
        console.error("[DRIVER_GPS] Error watchPosition:", error);

        let message = "No pudimos actualizar tu ubicación.";
        let nextStatus = "error";
        let reason = "gps_watch_error";

        if (error.code === 1) {
          message =
            "Permiso de ubicación denegado. Activá la ubicación desde los permisos del navegador o de la app.";
          nextStatus = "denied";
          reason = "gps_watch_permission_denied";
        }

        if (error.code === 2) {
          message =
            "Ubicación no disponible. Activá el GPS o los servicios de ubicación del celular y volvé a intentar.";
          nextStatus = "unavailable";
          reason = "gps_watch_position_unavailable";
        }

        if (error.code === 3) {
          message =
            "No pudimos actualizar la ubicación a tiempo. Activá el GPS, esperá unos segundos y volvé a intentar.";
          nextStatus = "error";
          reason = "gps_watch_timeout";
        }

        setGeoError(message);
        setGeoStatus(nextStatus);
        setWorkStatus("error");

        await writePresence({
          trackingActive: false,
          availableForOffers: false,
          gpsStatus: nextStatus,
          reason,
          coords: null,
        });
      },
      GEO_OPTIONS
    );
  };

  const handleStartWork = async () => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      setGeoError("Este dispositivo no soporta geolocalización.");
      setWorkStatus("error");

      await writePresence({
        trackingActive: false,
        availableForOffers: false,
        gpsStatus: "unavailable",
        reason: "geolocation_unavailable",
      });

      return;
    }

    setWorkStatus("starting");
    setGeoStatus("searching");
    setGeoError("");

    stopGpsWatch();

    console.log("[DRIVER_GPS] Confirmando inicio de trabajo...");

    let position = null;

    try {
      if (gpsPrimeRef.current.status === "success") {
        position = gpsPrimeRef.current.position;
      } else if (gpsPrimeRef.current.status === "pending") {
        position = await gpsPrimeRef.current.promise;
      } else {
        console.log("[DRIVER_GPS] Solicitando ubicación al confirmar...");
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

    console.log("[DRIVER_GPS] Ubicación inicial obtenida:", coords);

    gpsPrimeRef.current = {
      status: "idle",
      promise: null,
      position: null,
      error: null,
    };

    setLiveCoords(coords);
    setGeoStatus("granted");
    setWorkStatus(pedidoActivo ? "busy" : "online");

    await writePresence({
      trackingActive: true,
      availableForOffers: !pedidoActivo,
      gpsStatus: "granted",
      reason: "work_started",
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
    if (pedidoActivo) {
      setWorkStatus("busy");

      writePresence({
        trackingActive: geoStatus === "granted",
        availableForOffers: false,
        gpsStatus,
        reason: "order_active",
        coords: liveCoords,
      });
    } else if (workStatus === "busy") {
      setWorkStatus("online");

      writePresence({
        trackingActive: geoStatus === "granted",
        availableForOffers: geoStatus === "granted",
        gpsStatus,
        reason: "order_finished_available",
        coords: liveCoords,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoActivo]);

  useEffect(() => {
    if (!repartidorId) return;

    const q = query(
      collection(db, "orders"),
      where("status", "==", "ofertado"),
      where("offer.cadeteId", "==", String(repartidorId))
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setPedidoOfertado(null);
          return;
        }

        const docSnap = snap.docs[0];

        setPedidoOfertado({
          ...docSnap.data(),
          _docId: docSnap.id,
        });
      },
      (error) => {
        console.error("❌ Error escuchando pedidos ofertados:", error);
      }
    );

    return () => unsubscribe();
  }, [repartidorId]);

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
    return () => {
      stopGpsWatch();
    };
  }, []);

  const resolveOrderDocId = (pedido) => pedido?._docId || pedido?.id;

  const aceptarOferta = async (pedido) => {
    const orderDocId = resolveOrderDocId(pedido);
    if (!orderDocId) return;

    try {
      await updateDoc(doc(db, "orders", orderDocId), {
        status: "asignado",
        assignedCadeteId: String(repartidorId),
        assignedAt: serverTimestamp(),
        "offer.state": "accepted",
        "offer.respondedAt": serverTimestamp(),
      });

      setPedidoOfertado(null);

      setPedidoActivo({
        ...pedido,
        _docId: orderDocId,
      });

      setWorkStatus("busy");

      await writePresence({
        trackingActive: geoStatus === "granted",
        availableForOffers: false,
        gpsStatus,
        reason: "offer_accepted",
        coords: liveCoords,
      });
    } catch (error) {
      console.error("❌ Error aceptando oferta:", error);
    }
  };

  const rechazarOferta = async (pedido, reason = "rejected") => {
    const orderDocId = resolveOrderDocId(pedido);
    if (!orderDocId) return;

    try {
      await updateDoc(doc(db, "orders", orderDocId), {
        status: "pendiente",
        "offer.state": reason,
        "offer.respondedAt": serverTimestamp(),
      });

      setPedidoOfertado(null);

      await writePresence({
        trackingActive: geoStatus === "granted",
        availableForOffers: workStatus === "online",
        gpsStatus,
        reason: "offer_rejected",
        coords: liveCoords,
      });
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
      setWorkStatus(geoStatus === "granted" ? "online" : "offline");

      await writePresence({
        trackingActive: geoStatus === "granted",
        availableForOffers: geoStatus === "granted",
        gpsStatus,
        reason: "order_finished",
        coords: liveCoords,
      });
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
          Mantener para activar GPS
        </HoldToConfirmButton>
      );
    }

    if (workStatus === "starting") {
      return (
        <button className="driver-main-action driver-main-action--loading" disabled>
          Activando GPS...
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
        Mantener para reconectar GPS
      </HoldToConfirmButton>
    );
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