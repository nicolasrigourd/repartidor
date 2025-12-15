import { useEffect, useRef, useState } from "react";
import "./home.css";

import TopBar from "../../components/topbar/topbar";
import BottomBar from "../../components/bottombar/bottombar";
import ModalPedidoAsignado from "../../components/modalpedidoasignado/modalpedidoasignado";

import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebaseconfig";

function Home({ repartidorId, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  const [estadoCadete, setEstadoCadete] = useState("disponible"); // disponible | en_pedido

  // GPS UI state
  const [geoStatus, setGeoStatus] = useState("checking");
  // checking | granted | prompt | denied | unavailable | searching
  const [geoError, setGeoError] = useState(null);
  const [liveCoords, setLiveCoords] = useState(null);

  // Pedido simulado / modal
  const [pedidoAsignado, setPedidoAsignado] = useState(null);
  const [mensajePedido, setMensajePedido] = useState("");

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

    // Evitar duplicar watchers
    if (watchIdRef.current != null) {
      console.log("⚠️ [GPS] Watch ya activo, no se crea otro");
      return;
    }

    setGeoError(null);
    setGeoStatus("searching"); // buscando señal GPS

    // 1) Primer envío inmediato
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        console.log("📍 [GPS] Posición inicial obtenida", {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });

        try {
          setGeoStatus("granted");
          await writeLocationToFirestore(pos, true); // fuerza primer envío
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

    // 2) Watch continuo
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

  // ✅ Al entrar a Home, detectar permiso sin pedir nada
  useEffect(() => {
    let cancelled = false;

    const checkPermissionAndStart = async () => {
      console.log("🟡 [GPS] Chequeando permisos de geolocalización");

      if (!navigator.geolocation) {
        console.log("🔴 [GPS] Geolocalización no soportada");
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
            console.log("✅ [GPS] Permiso ya concedido → inicio tracking automático");
            setGeoStatus("granted");
            startTracking();
          } else if (perm.state === "denied") {
            console.log("❌ [GPS] Permiso denegado");
            setGeoStatus("denied");
            setGeoError("Permiso denegado. Habilitá Ubicación en permisos del sitio.");
          } else {
            console.log("⚠️ [GPS] Permiso en estado prompt");
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
        console.log("⚠️ [GPS] Permissions API no disponible");
        setGeoStatus("prompt");
      }
    };

    checkPermissionAndStart();

    return () => {
      cancelled = true;
      stopTracking();
    };
  }, []);

  // cuando cambia estadoCadete, reset de throttles para que impacte rápido
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

  // ========= UI Banner ubicación =========
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

    // prompt
    return (
      <div className="location-banner location-banner-warn">
        <div className="location-texts">
          <span>
            Necesitamos tu ubicación para asignación de pedidos y seguimiento.
          </span>
          {geoError && <span className="location-error">{geoError}</span>}
        </div>
        <button className="location-btn" onClick={requestLocation}>
          Activar ubicación
        </button>
      </div>
    );
  };

  // ========= MODAL PEDIDO (SIMULACIÓN) =========
  const handleSimularPedido = () => {
    setMensajePedido("");
    setPedidoAsignado({
      id: "PED-TEST-001",
      origen: "Local Central",
      destino: "Tribunales - Mesa de Entradas",
    });
  };

  const handleAceptarPedido = (pedido) => {
    setPedidoAsignado(null);
    setEstadoCadete("en_pedido");
    setMensajePedido(`✅ Aceptaste el pedido ${pedido?.id || ""}`);
  };

  const handleRechazarPedido = (pedido) => {
    setPedidoAsignado(null);
    setEstadoCadete("disponible");
    setMensajePedido(`❌ Rechazaste el pedido ${pedido?.id || ""}`);
  };

  const handleTimeoutPedido = (pedido) => {
    setPedidoAsignado(null);
    if (!pedido) {
      setMensajePedido("⏱️ Se terminó el tiempo para responder el pedido.");
      return;
    }
    setEstadoCadete("disponible");
    setMensajePedido(`⏱️ Se terminó el tiempo para responder el pedido ${pedido.id}`);
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

        {activeTab === "home" && (
          <>
            <section style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="lista-btn-ingresar"
                  onClick={() => setEstadoCadete("disponible")}
                  disabled={estadoCadete === "disponible"}
                >
                  Disponible
                </button>

                <button
                  className="simular-pedido-btn"
                  onClick={() => setEstadoCadete("en_pedido")}
                  disabled={estadoCadete === "en_pedido"}
                >
                  En pedido
                </button>
              </div>

              <p className="lista-texto-secundario" style={{ marginTop: "6px" }}>
                Estado actual: <strong>{estadoCadete}</strong>
              </p>
            </section>

            <section className="simular-section">
              <button className="simular-pedido-btn" onClick={handleSimularPedido}>
                Simular pedido asignado
              </button>

              {mensajePedido && (
                <p className="simular-pedido-mensaje">{mensajePedido}</p>
              )}
            </section>
          </>
        )}

        {activeTab === "pedidos" && (
          <>
            <h2 className="home-main-title">Pedidos</h2>
            <p className="home-main-text">Acá listamos pedidos asignados.</p>
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
        pedido={pedidoAsignado}
        segundos={20}
        onAceptar={handleAceptarPedido}
        onRechazar={handleRechazarPedido}
        onTimeout={handleTimeoutPedido}
      />
    </div>
  );
}

export default Home;
