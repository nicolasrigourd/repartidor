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

import { getToken, onMessage } from "firebase/messaging";
import { db, messaging } from "../../firebaseconfig";

function Home({ repartidorId, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  // Estado del cadete (lo cambia el flow real)
  const [estadoCadete, setEstadoCadete] = useState("disponible"); // disponible | en_pedido

  // GPS UI state
  const [geoStatus, setGeoStatus] = useState("checking");
  // checking | granted | prompt | denied | unavailable | searching
  const [geoError, setGeoError] = useState(null);
  const [liveCoords, setLiveCoords] = useState(null);

  // Pedido ofertado (dispara modal) + pedido activo (se muestra en Home)
  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  // ✅ FCM UI (solo para mostrar/forzar habilitar)
  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [notifError, setNotifError] = useState(null);

  // refs para no duplicar watchers
  const watchIdRef = useRef(null);
  const lastSentAtRef = useRef(0);
  const lastSentCoordsRef = useRef(null);

  // ===== CONFIG TRACKING REAL =====
  const trackingConfig = (estado) => {
    if (estado === "en_pedido") {
      return { minMs: 10000, minMeters: 15 };
    }
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
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    };

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
      console.log("🔴 [GPS] Geolocalización no soportada");
      setGeoStatus("unavailable");
      setGeoError("Este dispositivo no soporta geolocalización.");
      return;
    }

    if (watchIdRef.current != null) {
      console.log("⚠️ [GPS] Watch ya activo, no se crea otro");
      return;
    }

    setGeoError(null);
    setGeoStatus("searching");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        console.log("📍 [GPS] Posición inicial obtenida", {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });

        try {
          setGeoStatus("granted");
          await writeLocationToFirestore(pos, true);
          console.log("✅ [GPS] Primera ubicación enviada a Firestore");
        } catch (e) {
          console.error("❌ [GPS] Error enviando ubicación inicial", e);
        }
      },
      (err) => {
        console.error("❌ [GPS] Error en getCurrentPosition", err);

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
        console.log("🔄 [GPS] watchPosition disparó", {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });

        try {
          setGeoStatus("granted");
          await writeLocationToFirestore(pos, false);
        } catch (e) {
          console.error("❌ [GPS] Error en watchPosition → Firestore", e);
        }
      },
      (err) => {
        console.error("❌ [GPS] Error en watchPosition", err);

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

    console.log("✅ [GPS] Watch iniciado con id:", watchIdRef.current);
  };

  const stopTracking = () => {
    if (watchIdRef.current != null) {
      console.log("🛑 [GPS] stopTracking() → clearWatch:", watchIdRef.current);
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const checkPermissionAndStart = async () => {
      console.log("🟡 [GPS] Chequeando permisos de geolocalización");

      if (!navigator.geolocation) {
        setGeoStatus("unavailable");
        setGeoError("Este dispositivo no soporta geolocalización.");
        return;
      }

      if (navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: "geolocation" });
          console.log("🟢 [GPS] Estado permiso:", perm.state);

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
            console.log("🔁 [GPS] Cambio de permiso:", perm.state);

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
        } catch (e) {
          console.log("⚠️ [GPS] Permissions API falló, dejamos prompt", e);
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

  useEffect(() => {
    console.log("🔄 [GPS] Cambio estadoCadete:", estadoCadete, "→ reset throttles");
    lastSentAtRef.current = 0;
    lastSentCoordsRef.current = null;
  }, [estadoCadete]);

  const requestLocation = () => {
    console.log("🟠 [GPS] Botón Activar/Reintentar presionado");
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
  // 🔔 FCM: NO pedir permiso siempre + registrar SW /fcm-sw.js
  // =========================================================
  const enableNotifications = async () => {
    try {
      setNotifError(null);

      if (!("Notification" in window)) {
        setNotifPerm("unsupported");
        setNotifError("Este dispositivo no soporta notificaciones.");
        return;
      }

      const perm = await Notification.requestPermission();
      setNotifPerm(perm);

      if (perm !== "granted") {
        setNotifError("Notificaciones denegadas. Debés habilitarlas en el navegador.");
        return;
      }

      // ✅ registrar SW de FCM (separado del SW de la PWA)
      const reg = await navigator.serviceWorker.register("/fcm-sw.js", { scope: "/fcm/" });

      const token = await getToken(messaging, {
        vapidKey:
          "BEDzaIKrOaZmTFlQ_9zwjNyVAOwLFZJ-Q-xiOe6Oi_UNJhsTS-9PFn2RncLYmHHHvswEVdsuEPuTU-qnMwVMhdI",
        serviceWorkerRegistration: reg,
      });

      if (!token) {
        setNotifError("No se pudo obtener el token push.");
        return;
      }

      await setDoc(
        doc(db, "ubicacionesCadetes", repartidorId),
        {
          cadeteId: repartidorId,
          fcmToken: token,
          fcmUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      console.log("✅ [FCM] Token guardado");
    } catch (e) {
      console.error("❌ [FCM] enableNotifications error:", e);
      setNotifError("Error configurando notificaciones.");
    }
  };

  useEffect(() => {
    if (!repartidorId) return;

    if (typeof Notification !== "undefined") {
      setNotifPerm(Notification.permission);
    }

    // ✅ Si ya estaban granted, solo aseguramos token (sin prompt)
    const autoInitIfGranted = async () => {
      try {
        if (!("Notification" in window)) return;
        if (Notification.permission !== "granted") return;

        const reg = await navigator.serviceWorker.register("/fcm-sw.js", { scope: "/fcm/" });

        const token = await getToken(messaging, {
          vapidKey:
            "BEDzaIKrOaZmTFlQ_9zwjNyVAOwLFZJ-Q-xiOe6Oi_UNJhsTS-9PFn2RncLYmHHHvswEVdsuEPuTU-qnMwVMhdI",
          serviceWorkerRegistration: reg,
        });

        if (!token) return;

        await setDoc(
          doc(db, "ubicacionesCadetes", repartidorId),
          { cadeteId: repartidorId, fcmToken: token, fcmUpdatedAt: serverTimestamp() },
          { merge: true }
        );

        console.log("✅ [FCM] Token refrescado (granted)");
      } catch (e) {
        console.error("❌ [FCM] autoInitIfGranted error:", e);
      }
    };

    autoInitIfGranted();

    const unsubMsg = onMessage(messaging, (payload) => {
      console.log("📩 [FCM] Mensaje foreground:", payload);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    });

    return () => unsubMsg();
  }, [repartidorId]);

  // =========================================================
  // 🔥 LISTENER: detectar si le ofertaron un pedido al repartidor
  // =========================================================
  useEffect(() => {
    if (!repartidorId) return;

    console.log("👂 [ORDERS] Listener ofertados para cadete:", repartidorId);

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

        console.log("📩 [ORDERS] Oferta recibida:", data.id || docSnap.id);

        setPedidoOfertado((prev) => {
          const prevId = prev?.id || prev?._docId;
          const nextId = data.id || data._docId;
          if (prevId === nextId) return prev;
          return data;
        });
      },
      (err) => {
        console.error("❌ [ORDERS] Error listener ofertados:", err);
      }
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
      console.log("✅ [ORDERS] Oferta aceptada:", orderDocId);
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
      console.log("✅ [ORDERS] Oferta rechazada:", orderDocId, reason);
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

      console.log("✅ [ORDERS] Pedido finalizado:", orderDocId);
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

        {/* ✅ BOTÓN SOLO SI NOTIFICACIONES NO ESTÁN OK */}
        {notifPerm !== "granted" && notifPerm !== "unsupported" && (
          <div className="location-banner location-banner-warn" style={{ marginTop: 10 }}>
            <div className="location-texts">
              <span>⚠️ Notificaciones desactivadas. Si no las activás, no vas a ver pedidos.</span>
              {notifError && <span className="location-error">{notifError}</span>}
            </div>
            <button className="location-btn" onClick={enableNotifications}>
              Activar notificaciones
            </button>
          </div>
        )}

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
