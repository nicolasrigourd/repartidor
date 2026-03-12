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
  deleteField,
} from "firebase/firestore";

import { getToken, onMessage } from "firebase/messaging";
import { db, messaging } from "../../firebaseconfig";

function Home({ repartidorId, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  const [estadoCadete, setEstadoCadete] = useState("disponible");
  const estadoCadeteRef = useRef("disponible");

  const [geoStatus, setGeoStatus] = useState("checking");
  // checking | granted | prompt | denied | unavailable | searching
  const [geoError, setGeoError] = useState(null);
  const [liveCoords, setLiveCoords] = useState(null);

  // null = todavía no cargamos preferencia guardada
  const [trackingEnabled, setTrackingEnabled] = useState(null);

  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [notifError, setNotifError] = useState(null);

  const watchIdRef = useRef(null);
  const lastSentAtRef = useRef(0);
  const lastSentCoordsRef = useRef(null);

  const getTrackingStorageKey = () => `cadete_tracking_enabled_${repartidorId}`;

  useEffect(() => {
    estadoCadeteRef.current = estadoCadete;
  }, [estadoCadete]);

  // ===============================
  // Cargar preferencia persistida
  // ===============================
  useEffect(() => {
    if (!repartidorId) return;

    try {
      const saved = localStorage.getItem(getTrackingStorageKey());
      if (saved === null) {
        setTrackingEnabled(true); // por defecto, primera vez
      } else {
        setTrackingEnabled(saved === "true");
      }
    } catch (err) {
      console.error("❌ Error leyendo preferencia tracking:", err);
      setTrackingEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repartidorId]);

  const persistTrackingPreference = (value) => {
    if (!repartidorId) return;
    try {
      localStorage.setItem(getTrackingStorageKey(), String(value));
    } catch (err) {
      console.error("❌ Error guardando preferencia tracking:", err);
    }
  };

  // disponible = menos frecuente / en pedido = más frecuente
  const trackingConfig = (estado) => {
    if (estado === "en_pedido") {
      return { minMs: 5000, minMeters: 10 };
    }
    return { minMs: 15000, minMeters: 25 };
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

  const markCadeteInactive = async ({
    gpsStatus = "disabled",
    reason = "tracking_stopped",
    preserveEstado = false,
  } = {}) => {
    if (!repartidorId) return;

    try {
      await setDoc(
        doc(db, "ubicacionesCadetes", repartidorId),
        {
          cadeteId: repartidorId,
          estadoCadete: preserveEstado ? estadoCadeteRef.current : "disponible",
          trackingActive: false,
          availableForOffers: false,
          gpsStatus,
          presenceReason: reason,
          lat: deleteField(),
          lng: deleteField(),
          accuracy: deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      console.log("🟡 [GPS] Cadete marcado como inactivo en Firestore");
    } catch (err) {
      console.error("❌ [GPS] Error marcando cadete inactivo:", err);
    }
  };

  const writeLocationToFirestore = async (pos, force = false) => {
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    };

    const estadoActual = estadoCadeteRef.current;

    console.log("📝 [GPS] Intento de envío", {
      force,
      estadoCadete: estadoActual,
      coords: next,
      accuracy: pos.coords.accuracy,
    });

    setLiveCoords(next);

    const { minMs, minMeters } = trackingConfig(estadoActual);
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
          estadoCadete: estadoActual,
          trackingActive: true,
          availableForOffers: estadoActual === "disponible",
          gpsStatus: "granted",
          presenceReason: "tracking_ok",
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

  const stopTracking = () => {
    if (watchIdRef.current != null) {
      console.log("🛑 [GPS] stopTracking() → clearWatch:", watchIdRef.current);
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const handleGeoUnavailable = async (nextStatus, message, reason = "gps_unavailable") => {
    setGeoStatus(nextStatus);
    setGeoError(message);
    setLiveCoords(null);
    stopTracking();
    lastSentAtRef.current = 0;
    lastSentCoordsRef.current = null;

    await markCadeteInactive({
      gpsStatus: nextStatus,
      reason,
      preserveEstado: true,
    });
  };

  const startTracking = () => {
    console.log("🚀 [GPS] startTracking() llamado");

    if (trackingEnabled !== true) {
      console.log("⚠️ [GPS] Tracking desactivado por el usuario");
      return;
    }

    if (!navigator.geolocation) {
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
      async (err) => {
        console.error("❌ [GPS] Error en getCurrentPosition", err);

        if (err.code === 1) {
          await handleGeoUnavailable(
            "denied",
            "Permiso denegado. Habilitá Ubicación en permisos del sitio.",
            "permission_denied"
          );
        } else if (err.code === 2) {
          await handleGeoUnavailable(
            "unavailable",
            "Ubicación no disponible. ¿Tenés el GPS apagado?",
            "gps_unavailable"
          );
        } else {
          await handleGeoUnavailable(
            "prompt",
            "No pudimos obtener ubicación. Reintentá.",
            "gps_prompt"
          );
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
          setGeoError(null);
          await writeLocationToFirestore(pos, false);
        } catch (e) {
          console.error("❌ [GPS] Error en watchPosition → Firestore", e);
        }
      },
      async (err) => {
        console.error("❌ [GPS] Error en watchPosition", err);

        if (err.code === 1) {
          await handleGeoUnavailable(
            "denied",
            "Permiso denegado. Habilitá Ubicación en permisos del sitio.",
            "permission_denied"
          );
        } else if (err.code === 2) {
          await handleGeoUnavailable(
            "unavailable",
            "Ubicación no disponible. Encendé el GPS del teléfono.",
            "gps_unavailable"
          );
        } else {
          await handleGeoUnavailable(
            "prompt",
            "No pudimos obtener ubicación. Reintentá.",
            "gps_prompt"
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    console.log("✅ [GPS] Watch iniciado con id:", watchIdRef.current);
  };

  // ===============================
  // Permisos + inicio automático solo si trackingEnabled === true
  // ===============================
  useEffect(() => {
    if (trackingEnabled === null) return;

    let cancelled = false;

    const checkPermissionAndStart = async () => {
      console.log("🟡 [GPS] Chequeando permisos de geolocalización");

      if (!navigator.geolocation) {
        setGeoStatus("unavailable");
        setGeoError("Este dispositivo no soporta geolocalización.");
        return;
      }

      if (trackingEnabled !== true) {
        setGeoStatus("prompt");
        setGeoError(null);
        stopTracking();
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
            await markCadeteInactive({
              gpsStatus: "denied",
              reason: "permission_denied",
              preserveEstado: true,
            });
          } else {
            setGeoStatus("prompt");
          }

          perm.onchange = async () => {
            console.log("🔁 [GPS] Cambio de permiso:", perm.state);

            if (trackingEnabled !== true) return;

            if (perm.state === "granted") {
              setGeoStatus("granted");
              setGeoError(null);
              startTracking();
            } else if (perm.state === "denied") {
              setGeoStatus("denied");
              setGeoError("Permiso denegado. Habilitá Ubicación en permisos del sitio.");
              setLiveCoords(null);
              stopTracking();
              await markCadeteInactive({
                gpsStatus: "denied",
                reason: "permission_denied",
                preserveEstado: true,
              });
            } else {
              setGeoStatus("prompt");
              setLiveCoords(null);
              stopTracking();
              await markCadeteInactive({
                gpsStatus: "prompt",
                reason: "permission_prompt",
                preserveEstado: true,
              });
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
  }, [trackingEnabled]);

  useEffect(() => {
    console.log("🔄 [GPS] Cambio estadoCadete:", estadoCadete, "→ reset throttles");
    lastSentAtRef.current = 0;
    lastSentCoordsRef.current = null;
  }, [estadoCadete]);

  useEffect(() => {
    if (trackingEnabled === null) return;

    const syncEstadoActual = async () => {
      if (!repartidorId) return;

      try {
        await setDoc(
          doc(db, "ubicacionesCadetes", repartidorId),
          {
            cadeteId: repartidorId,
            estadoCadete,
            availableForOffers:
              trackingEnabled === true &&
              geoStatus === "granted" &&
              estadoCadete === "disponible",
            trackingActive: trackingEnabled === true && geoStatus === "granted",
            gpsStatus: geoStatus,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        console.error("❌ [GPS] Error sincronizando estado del cadete:", err);
      }
    };

    syncEstadoActual();
  }, [estadoCadete, geoStatus, repartidorId, trackingEnabled]);

  // ===============================
  // Re-sincronizar al volver al frente
  // ===============================
  useEffect(() => {
    if (trackingEnabled !== true) return;

    const resyncTracking = () => {
      console.log("🔄 [GPS] Re-sincronizando tracking por foco/visibilidad");
      stopTracking();
      lastSentAtRef.current = 0;
      lastSentCoordsRef.current = null;
      startTracking();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        resyncTracking();
      }
    };

    const onFocus = () => resyncTracking();
    const onOnline = () => resyncTracking();
    const onPageShow = () => resyncTracking();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingEnabled]);

  const requestLocation = () => {
    console.log("🟠 [GPS] Botón Activar/Reintentar presionado");
    persistTrackingPreference(true);
    setTrackingEnabled(true);
    setGeoError(null);
  };

  const disableLocation = async () => {
    console.log("🛑 [GPS] Botón Desactivar ubicación presionado");
    persistTrackingPreference(false);
    setTrackingEnabled(false);
    setGeoStatus("prompt");
    setGeoError(null);
    setLiveCoords(null);
    stopTracking();
    lastSentAtRef.current = 0;
    lastSentCoordsRef.current = null;

    await markCadeteInactive({
      gpsStatus: "disabled",
      reason: "disabled_by_user",
      preserveEstado: true,
    });
  };

  const handleLogout = async () => {
    try {
      persistTrackingPreference(false);
      stopTracking();
      setLiveCoords(null);

      await markCadeteInactive({
        gpsStatus: "logged_out",
        reason: "logout",
        preserveEstado: false,
      });
    } catch (e) {
      console.error("❌ [GPS] Error al limpiar ubicación antes de salir:", e);
    } finally {
      onLogout?.();
    }
  };

  const renderLocationBanner = () => {
    if (trackingEnabled === null) {
      return (
        <div className="location-banner location-banner-warn">
          <div className="location-texts">
            <span>Preparando estado de ubicación…</span>
          </div>
        </div>
      );
    }

    if (geoStatus === "granted" && trackingEnabled === true) {
      return (
        <div className="location-banner location-banner-ok">
          <div className="location-texts">
            <span>Ubicación activa ✅</span>
            <span className="location-subtext">Podrás recibir y gestionar pedidos.</span>
            {liveCoords ? (
              <span className="location-coords">
                ({liveCoords.lat.toFixed(4)}, {liveCoords.lng.toFixed(4)})
              </span>
            ) : (
              <span className="location-coords">(buscando señal…)</span>
            )}
          </div>

          <button className="location-btn location-btn-danger" onClick={disableLocation}>
            Desactivar ubicación
          </button>
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
            <span className="location-subtext">
              Necesitamos tu ubicación para asignación y seguimiento de pedidos.
            </span>
          </div>
          <button className="location-btn" onClick={requestLocation}>
            Activar ubicación
          </button>
        </div>
      );
    }

    if (geoStatus === "denied") {
      return (
        <div className="location-banner location-banner-error">
          <div className="location-texts">
            <span>{geoError || "Permiso de ubicación denegado."}</span>
            <span className="location-subtext">
              Necesitamos tu ubicación para asignación y seguimiento de pedidos.
            </span>
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
          <span>Necesitamos tu ubicación para asignación y seguimiento de pedidos.</span>
          {geoError && <span className="location-error">{geoError}</span>}
        </div>
        <button className="location-btn" onClick={requestLocation}>
          Activar ubicación
        </button>
      </div>
    );
  };

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
          setEstadoCadete("disponible");
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
        onRightClick={handleLogout}
      />

      <main className="home-main">
        {renderLocationBanner()}

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