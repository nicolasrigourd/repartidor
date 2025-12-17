import { useEffect, useRef, useState } from "react";
import "./home.css";

import TopBar from "../../components/topbar/topbar";
import BottomBar from "../../components/bottombar/bottombar";
import ModalPedidoAsignado from "../../components/modalpedidoasignado/modalpedidoasignado";
import CardPedidoActivo from "../../components/cardpedidoactivo/cardpedidoactivo";

import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";

import { getToken, onMessage, isSupported } from "firebase/messaging";
import { db, messaging } from "../../firebaseconfig";

function Home({ repartidorId, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  // Estado del cadete (lo cambia el flow real)
  const [estadoCadete, setEstadoCadete] = useState("disponible"); // disponible | en_pedido

  // GPS UI state
  const [geoStatus, setGeoStatus] = useState("checking");
  const [geoError, setGeoError] = useState(null);
  const [liveCoords, setLiveCoords] = useState(null);

  // Pedido ofertado (dispara modal) + pedido activo (se muestra en Home)
  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  // ===== FCM UI state =====
  const [pushSupported, setPushSupported] = useState(true);
  const [pushPerm, setPushPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  ); // default | granted | denied
  const [pushToken, setPushToken] = useState("");
  const [pushError, setPushError] = useState("");

  // refs para no duplicar watchers
  const watchIdRef = useRef(null);
  const lastSentAtRef = useRef(0);
  const lastSentCoordsRef = useRef(null);

  // ===== CONFIG TRACKING REAL =====
  const trackingConfig = (estado) => {
    if (estado === "en_pedido") return { minMs: 10000, minMeters: 15 };
    return { minMs: 5000, minMeters: 10 };
  };

  const distanceMeters = (a, b) => {
    const R = 6371000;
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };

  const writeLocationToFirestore = async (pos, force = false) => {
    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };

    console.log("📝 [GPS] Intento de envío", {
      force,
      estadoCadete,
      coords: next,
      accuracy: pos.coords.accuracy,
    });

    setLiveCoords(next);

    const { minMs, minMeters } = trackingConfig(estadoCadete);
    const now = Date.now();

    if (!force) {
      if (now - lastSentAtRef.current < minMs) {
        console.log("⏱️ [GPS] Bloqueado por tiempo (throttle)", {
          elapsedMs: now - lastSentAtRef.current,
          minMs,
        });
        return;
      }

      if (lastSentCoordsRef.current) {
        const moved = distanceMeters(lastSentCoordsRef.current, next);
        if (moved < minMeters) {
          console.log("📏 [GPS] Bloqueado por distancia", {
            moved: Number(moved.toFixed(1)),
            minMeters,
          });
          return;
        }
      }
    }

    lastSentAtRef.current = now;
    lastSentCoordsRef.current = next;

    try {
      await setDoc(
        doc(db, "ubicacionesCadetes", repartidorId),
        {
          cadeteId: repartidorId,
          estadoCadete,
          lat: next.lat,
          lng: next.lng,
          accuracy: pos.coords.accuracy ?? null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      console.log("✅ [GPS] Ubicación guardada en Firestore");
    } catch (err) {
      console.error("❌ [GPS] Error Firestore:", err);
    }
  };

  const startTracking = () => {
    console.log("🚀 [GPS] startTracking() llamado");

    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      setGeoError("Este dispositivo no soporta geolocalización.");
      return;
    }

    if (watchIdRef.current != null) return;

    setGeoError(null);
    setGeoStatus("searching");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeoStatus("granted");
        await writeLocationToFirestore(pos, true);
      },
      (err) => {
        if (err.code === 1) {
          setGeoStatus("denied");
          setGeoError("Permiso denegado. Habilitá Ubicación en permisos del sitio.");
        } else if (err.code === 2) {
          setGeoStatus("unavailable");
          setGeoError("Ubicación no disponible. ¿Tenés el GPS apagado?");
        } else {
          setGeoStatus("prompt");
          setGeoError("No pudimos obtener ubicación. Reintentá.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setGeoStatus("granted");
        await writeLocationToFirestore(pos, false);
      },
      (err) => {
        if (err.code === 1) {
          setGeoStatus("denied");
          setGeoError("Permiso denegado. Habilitá Ubicación en permisos del sitio.");
        } else if (err.code === 2) {
          setGeoStatus("unavailable");
          setGeoError("Ubicación no disponible. Encendé el GPS del teléfono.");
        } else {
          setGeoStatus("prompt");
          setGeoError("No pudimos obtener ubicación. Reintentá.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const stopTracking = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  // ✅ Al entrar a Home, detectar permiso GPS sin pedir nada
  useEffect(() => {
    let cancelled = false;

    const checkPermissionAndStart = async () => {
      if (!navigator.geolocation) {
        setGeoStatus("unavailable");
        setGeoError("Este dispositivo no soporta geolocalización.");
        return;
      }

      if (navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: "geolocation" });
          if (cancelled) return;

          if (perm.state === "granted") {
            setGeoStatus("granted");
            startTracking();
          } else if (perm.state === "denied") {
            setGeoStatus("denied");
            setGeoError("Permiso denegado. Habilitá Ubicación en permisos del sitio.");
          } else {
            setGeoStatus("prompt");
          }

          perm.onchange = () => {
            if (perm.state === "granted") {
              setGeoStatus("granted");
              setGeoError(null);
              startTracking();
            } else if (perm.state === "denied") {
              setGeoStatus("denied");
              setGeoError("Permiso denegado. Habilitá Ubicación en permisos del sitio.");
              stopTracking();
            } else {
              setGeoStatus("prompt");
              stopTracking();
            }
          };
        } catch {
          setGeoStatus("prompt");
        }
      } else {
        setGeoStatus("prompt");
      }
    };

    checkPermissionAndStart();

    return () => {
      cancelled = true;
      stopTracking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cuando cambia estadoCadete, reset throttles para que impacte rápido
  useEffect(() => {
    lastSentAtRef.current = 0;
    lastSentCoordsRef.current = null;
  }, [estadoCadete]);

  const requestLocation = () => {
    setGeoError(null);
    startTracking();
  };

  const renderLocationBanner = () => {
    if (geoStatus === "granted") {
      return (
        <div className="location-banner location-banner-ok">
          <span>Ubicación activa ✅</span>
          {liveCoords ? (
            <span className="location-coords">
              ({liveCoords.lat.toFixed(4)}, {liveCoords.lng.toFixed(4)})
            </span>
          ) : (
            <span className="location-coords">(buscando señal…)</span>
          )}
        </div>
      );
    }

    if (geoStatus === "searching" || geoStatus === "checking") {
      return (
        <div className="location-banner location-banner-warn">
          <div className="location-texts">
            <span>Buscando señal de ubicación…</span>
          </div>
        </div>
      );
    }

    if (geoStatus === "unavailable") {
      return (
        <div className="location-banner location-banner-error">
          <div className="location-texts">
            <span>{geoError || "Ubicación no disponible. Encendé el GPS."}</span>
          </div>
          <button className="location-btn" onClick={requestLocation}>
            Reintentar
          </button>
        </div>
      );
    }

    if (geoStatus === "denied") {
      return (
        <div className="location-banner location-banner-error">
          <div className="location-texts">
            <span>{geoError || "Permiso de ubicación denegado."}</span>
          </div>
          <button className="location-btn" onClick={requestLocation}>
            Reintentar
          </button>
        </div>
      );
    }

    return (
      <div className="location-banner location-banner-warn">
        <div className="location-texts">
          <span>Necesitamos tu ubicación para asignación de pedidos y seguimiento.</span>
          {geoError && <span className="location-error">{geoError}</span>}
        </div>
        <button className="location-btn" onClick={requestLocation}>
          Activar ubicación
        </button>
      </div>
    );
  };

  // =========================================================
  // 🔔 FCM: soporte + permiso + token + foreground listener
  // =========================================================
  useEffect(() => {
    if (!repartidorId) return;

    let unsubMsg = null;
    let cancelled = false;

    const initFCM = async () => {
      try {
        setPushError("");

        const supported = await isSupported().catch(() => false);
        setPushSupported(supported);
        if (!supported) {
          console.log("❌ [FCM] Messaging no soportado en este entorno");
          return;
        }

        // Estado actual sin pedir permisos
        const currentPerm =
          typeof Notification !== "undefined" ? Notification.permission : "default";
        setPushPerm(currentPerm);

        // Si ya está granted, sacamos token directo
        if (currentPerm === "granted") {
          const token = await getToken(messaging, {
            vapidKey:
              "BEDzaIKrOaZmTFlQ_9zwjNyVAOwLFZJ-Q-xiOe6Oi_UNJhsTS-9PFn2RncLYmHHHvswEVdsuEPuTU-qnMwVMhdI",
          });

          if (!token) {
            console.log("⚠️ [FCM] No se pudo obtener token");
            return;
          }

          if (cancelled) return;

          setPushToken(token);

          await setDoc(
            doc(db, "ubicacionesCadetes", repartidorId),
            {
              cadeteId: repartidorId,
              fcmToken: token,
              fcmUpdatedAt: serverTimestamp(),
            },
            { merge: true }
          );

          console.log("✅ [FCM] Token guardado en Firestore");

          unsubMsg = onMessage(messaging, (payload) => {
            console.log("📩 [FCM] Mensaje foreground:", payload);
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          });

          return;
        }

        // Si está denied, no podemos re-pedir desde código (Chrome lo bloquea)
        if (currentPerm === "denied") {
          console.log("⚠️ [FCM] Permiso notificaciones DENEGADO");
          return;
        }

        // default: no hacemos nada automático (para no molestar)
        console.log("ℹ️ [FCM] Permiso en default (no pedimos aún)");
      } catch (e) {
        console.error("❌ [FCM] Error init:", e);
        setPushError(e?.message || "Error iniciando notificaciones");
      }
    };

    initFCM();

    return () => {
      cancelled = true;
      if (typeof unsubMsg === "function") unsubMsg();
    };
  }, [repartidorId]);

  // Botón manual para pedir permiso + token
  const enablePush = async () => {
    try {
      setPushError("");

      const supported = await isSupported().catch(() => false);
      setPushSupported(supported);
      if (!supported) {
        setPushError("Este dispositivo/navegador no soporta notificaciones push.");
        return;
      }

      const perm = await Notification.requestPermission();
      setPushPerm(perm);
      console.log("🔔 [FCM] Permiso:", perm);

      if (perm !== "granted") {
        setPushError(
          perm === "denied"
            ? "Permiso denegado. Tenés que habilitar notificaciones en Ajustes del navegador."
            : "Permiso no concedido."
        );
        return;
      }

      const token = await getToken(messaging, {
        vapidKey:
          "BEDzaIKrOaZmTFlQ_9zwjNyVAOwLFZJ-Q-xiOe6Oi_UNJhsTS-9PFn2RncLYmHHHvswEVdsuEPuTU-qnMwVMhdI",
      });

      if (!token) {
        setPushError("No se pudo obtener el token push.");
        return;
      }

      setPushToken(token);

      await setDoc(
        doc(db, "ubicacionesCadetes", repartidorId),
        {
          cadeteId: repartidorId,
          fcmToken: token,
          fcmUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      console.log("✅ [FCM] Token guardado en Firestore");
    } catch (e) {
      console.error("❌ [FCM] Error enablePush:", e);
      setPushError(e?.message || "Error habilitando notificaciones");
    }
  };

  const renderPushBanner = () => {
    if (!pushSupported) {
      return (
        <div className="location-banner location-banner-error">
          <div className="location-texts">
            <span>Este dispositivo no soporta notificaciones push.</span>
          </div>
        </div>
      );
    }

    if (pushPerm === "granted") {
      return (
        <div className="location-banner location-banner-ok">
          <span>Notificaciones activas ✅</span>
        </div>
      );
    }

    if (pushPerm === "denied") {
      return (
        <div className="location-banner location-banner-error">
          <div className="location-texts">
            <span>Notificaciones BLOQUEADAS ❌</span>
            <span className="location-error">
              Activá notificaciones en Ajustes del navegador (Sitio → Notificaciones).
            </span>
            {pushError && <span className="location-error">{pushError}</span>}
          </div>
        </div>
      );
    }

    // default
    return (
      <div className="location-banner location-banner-warn">
        <div className="location-texts">
          <span>Activá notificaciones para recibir pedidos aunque la app esté minimizada.</span>
          {pushError && <span className="location-error">{pushError}</span>}
        </div>
        <button className="location-btn" onClick={enablePush}>
          Activar notificaciones
        </button>
      </div>
    );
  };

  // =========================================================
  // 🔥 LISTENER: detectar si le ofertaron un pedido al repartidor
  // =========================================================
  useEffect(() => {
    if (!repartidorId) return;

    const q = query(
      collection(db, "orders"),
      where("status", "==", "ofertado"),
      where("offer.cadeteId", "==", repartidorId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setPedidoOfertado(null);
          return;
        }

        const docSnap = snap.docs[0];
        const data = { ...docSnap.data(), _docId: docSnap.id };

        setPedidoOfertado((prev) => {
          const prevId = prev?.id || prev?._docId;
          const nextId = data.id || data._docId;
          if (prevId === nextId) return prev;
          return data;
        });
      },
      (err) => console.error("❌ [ORDERS] Error listener ofertados:", err)
    );

    return () => unsub();
  }, [repartidorId]);

  // =========================================================
  // 🔥 LISTENER: pedido activo (status asignado) para este cadete
  // =========================================================
  useEffect(() => {
    if (!repartidorId) return;

    const q = query(
      collection(db, "orders"),
      where("status", "==", "asignado"),
      where("assignedCadeteId", "==", repartidorId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setPedidoActivo(null);
          return;
        }

        const docSnap = snap.docs[0];
        const data = { ...docSnap.data(), _docId: docSnap.id };
        setPedidoActivo(data);
        setEstadoCadete("en_pedido");
      },
      (err) => console.error("❌ [ORDERS] Error listener asignado:", err)
    );

    return () => unsub();
  }, [repartidorId]);

  // =========================================================
  // ✅ Acciones sobre oferta
  // =========================================================
  const resolveOrderDocId = (pedido) => pedido?._docId || pedido?.id;

  const aceptarOferta = async (pedido) => {
    const orderDocId = resolveOrderDocId(pedido);
    if (!orderDocId) return;

    try {
      await updateDoc(doc(db, "orders", orderDocId), {
        status: "asignado",
        assignedCadeteId: repartidorId,
        assignedAt: serverTimestamp(),
        "offer.state": "accepted",
        "offer.respondedAt": serverTimestamp(),
      });

      setPedidoOfertado(null);
      setEstadoCadete("en_pedido");
    } catch (err) {
      console.error("❌ [ORDERS] Error aceptando oferta:", err);
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
      setEstadoCadete("disponible");
    } catch (err) {
      console.error("❌ [ORDERS] Error rechazando oferta:", err);
    }
  };

  const onTimeoutOferta = async (pedido) => {
    await rechazarOferta(pedido, "expired");
  };

  // =========================================================
  // ✅ Finalizar pedido (simple dev)
  // =========================================================
  const finalizarPedido = async (pedido) => {
    const orderDocId = resolveOrderDocId(pedido);
    if (!orderDocId) return;

    try {
      await updateDoc(doc(db, "orders", orderDocId), {
        status: "finalizado",
        finishedAt: serverTimestamp(),
      });

      setEstadoCadete("disponible");
      setPedidoActivo(null);
    } catch (err) {
      console.error("❌ [ORDERS] Error finalizando:", err);
    }
  };

  return (
    <div className="home-root">
      <TopBar
        showBack={false}
        title="ID:"
        highlight={repartidorId}
        rightLabel="Salir"
        onRightClick={onLogout}
      />

      <main className="home-main">
        {renderLocationBanner()}
        {renderPushBanner()}

        {activeTab === "home" && (
          <>
            <h2 className="home-main-title">Inicio</h2>

            {pedidoActivo ? (
              <CardPedidoActivo pedido={pedidoActivo} onFinalizar={finalizarPedido} />
            ) : (
              <div className="pedido-activo-placeholder">
                <p className="home-main-text">
                  Sin pedido activo. Si te ofertan uno, aparecerá un modal para aceptar o rechazar.
                </p>
              </div>
            )}
          </>
        )}

        {activeTab === "pedidos" && (
          <>
            <h2 className="home-main-title">Pedidos</h2>
            {pedidoActivo ? (
              <CardPedidoActivo pedido={pedidoActivo} onFinalizar={finalizarPedido} />
            ) : (
              <p className="home-main-text">No tenés pedidos activos.</p>
            )}
          </>
        )}

        {activeTab === "billetera" && (
          <>
            <h2 className="home-main-title">Billetera</h2>
            <p className="home-main-text">Acá van cobros y liquidaciones.</p>
          </>
        )}

        {activeTab === "perfil" && (
          <>
            <h2 className="home-main-title">Perfil</h2>
            <p className="home-main-text">Datos y configuración del repartidor.</p>
          </>
        )}
      </main>

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />

      <ModalPedidoAsignado
        pedido={pedidoOfertado}
        segundos={20}
        onAceptar={aceptarOferta}
        onRechazar={(p) => rechazarOferta(p, "rejected")}
        onTimeout={onTimeoutOferta}
      />
    </div>
  );
}

export default Home;
