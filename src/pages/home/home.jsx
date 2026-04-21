import { useEffect, useMemo, useRef, useState } from "react";
import "./home.css";

import BottomBar from "../../components/bottombar/bottombar";
import ModalPedidoAsignado from "../../components/modalpedidoasignado/modalpedidoasignado";
import CardPedidoActivo from "../../components/cardpedidoactivo/cardpedidoactivo";

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

function Home({ repartidorId, user, onLogout }) {
  const ficha = user?.ficha || user || {};
  const nombreCompleto = `${ficha.nombre || ""} ${ficha.apellido || ""}`.trim();

  const [activeTab, setActiveTab] = useState("home");

  const [workStatus, setWorkStatus] = useState("offline");
  // offline | starting | online | busy | error

  const [geoStatus, setGeoStatus] = useState("idle");
  // idle | searching | granted | denied | unavailable | error

  const [geoError, setGeoError] = useState("");
  const [liveCoords, setLiveCoords] = useState(null);

  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  const watchIdRef = useRef(null);
  const estadoRef = useRef("offline");

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
      text: "Tocá empezar para quedar disponible.",
      pill: "Offline",
    };
  }, [workStatus, geoError]);

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

    await writePresence({
      trackingActive: false,
      availableForOffers: false,
      gpsStatus: "disabled",
      reason,
      coords: null,
    });
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

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
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

        watchIdRef.current = navigator.geolocation.watchPosition(
          async (pos) => {
            const nextCoords = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            };

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
            console.error("❌ Error watchPosition:", error);

            const message =
              error.code === 1
                ? "Permiso de ubicación denegado."
                : error.code === 2
                ? "Ubicación no disponible. Revisá el GPS."
                : "No pudimos actualizar tu ubicación.";

            setGeoError(message);
            setGeoStatus(error.code === 1 ? "denied" : "error");
            setWorkStatus("error");

            await writePresence({
              trackingActive: false,
              availableForOffers: false,
              gpsStatus: error.code === 1 ? "denied" : "error",
              reason: "gps_watch_error",
              coords: null,
            });
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          }
        );
      },
      async (error) => {
        console.error("❌ Error getCurrentPosition:", error);

        const message =
          error.code === 1
            ? "Permiso de ubicación denegado. Activá la ubicación para trabajar."
            : error.code === 2
            ? "Ubicación no disponible. Encendé el GPS."
            : "No pudimos obtener tu ubicación.";

        setGeoError(message);
        setGeoStatus(error.code === 1 ? "denied" : "error");
        setWorkStatus("error");

        await writePresence({
          trackingActive: false,
          availableForOffers: false,
          gpsStatus: error.code === 1 ? "denied" : "error",
          reason: "gps_initial_error",
          coords: null,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
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
        <button className="driver-main-action driver-main-action--go" onClick={handleStartWork}>
          Empezar a trabajar
        </button>
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
        <button className="driver-main-action driver-main-action--stop" onClick={handleStopWork}>
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
      <button className="driver-main-action driver-main-action--go" onClick={handleStartWork}>
        Reintentar conexión
      </button>
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

        <section className="driver-bottom-sheet">
          <div className="driver-sheet-handle" />

          <div className="driver-sheet-header">
            <div>
              <h2>Pedido actual</h2>
              <p>
                {pedidoActivo
                  ? "Tenés un pedido asignado."
                  : workStatus === "online"
                  ? "Esperando pedidos cercanos."
                  : "Conectate para recibir pedidos."}
              </p>
            </div>
          </div>

          {pedidoActivo ? (
            <CardPedidoActivo pedido={pedidoActivo} onFinalizar={finalizarPedido} />
          ) : (
            <div className="driver-empty-order">
              <div className="driver-empty-icon">↗</div>
              <strong>Sin pedido activo</strong>
              <span>
                Cuando Zeus te asigne un pedido, aparecerá acá con los datos de origen,
                destino y acciones.
              </span>
            </div>
          )}
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
        <section className="driver-map-stage">
          <div className="driver-map-grid" />
          <div className="driver-map-glow driver-map-glow--one" />
          <div className="driver-map-glow driver-map-glow--two" />
          <div className="driver-route-line driver-route-line--one" />
          <div className="driver-route-line driver-route-line--two" />

          <div className="driver-location-marker">
            <span />
          </div>

          <header className="driver-floating-header">
            <div className="driver-avatar">
              {ficha.fotoPerfil ? (
                <img src={ficha.fotoPerfil} alt={nombreCompleto || "Repartidor"} />
              ) : (
                <span>{String(ficha.nombre || "R").charAt(0).toUpperCase()}</span>
              )}
            </div>

            <div className="driver-header-info">
              <strong>{nombreCompleto || "Repartidor"}</strong>
              <span>
                ID {ficha.id || repartidorId} · {ficha.movilidad || "Movilidad"} ·{" "}
                {ficha.sucursal || "Sucursal"}
              </span>
            </div>

            <button className="driver-header-logout" onClick={handleLogout}>
              Salir
            </button>
          </header>

          <div className="driver-map-chip driver-map-chip--left">
            GPS: {geoStatus === "granted" ? "Activo" : "Inactivo"}
          </div>

          <div className="driver-map-chip driver-map-chip--right">
            {liveCoords ? "Ubicación enviada" : "Sin señal"}
          </div>
        </section>

        <div className="driver-content">
          {activeTab === "home" && renderHomePanel()}
          {activeTab === "pedidos" && renderPedidosPanel()}
          {activeTab === "billetera" && renderBilleteraPanel()}
          {activeTab === "perfil" && renderPerfilPanel()}
        </div>
      </main>

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />

      <ModalPedidoAsignado
        pedido={pedidoOfertado}
        segundos={20}
        onAceptar={aceptarOferta}
        onRechazar={(pedido) => rechazarOferta(pedido, "rejected")}
        onTimeout={(pedido) => rechazarOferta(pedido, "expired")}
      />
    </div>
  );
}

export default Home;