import { useEffect, useState } from "react";
import "./home.css";

import TopBar from "../../components/topbar/topbar";
import BottomBar from "../../components/bottombar/bottombar";
import ModalPedidoAsignado from "../../components/modalpedidoasignado/modalpedidoasignado";

import useGeolocationStatus from "../../hooks/usegeolocationstatus";

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  getDocs,
  serverTimestamp,
  doc,
  setDoc,
} from "firebase/firestore";

import { db } from "../../firebaseconfig";

function Home({ repartidorId, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  // Estado cadete para definir frecuencia de tracking
  // disponible | en_pedido
  const [estadoCadete, setEstadoCadete] = useState("disponible");

  // GPS / permisos
  const { status, error, coords, requestLocation } = useGeolocationStatus();

  // Debug opcional (mostrar últimas coords)
  const [liveCoords, setLiveCoords] = useState(null);

  // Lista de cadetes (turnos)
  const [listaCadetes, setListaCadetes] = useState([]);
  const [listaLoading, setListaLoading] = useState(true);
  const [listaError, setListaError] = useState("");
  const [ingresando, setIngresando] = useState(false);
  const [mensajeIngreso, setMensajeIngreso] = useState("");

  // Modal pedido simulado
  const [pedidoSimulado, setPedidoSimulado] = useState(null);
  const [mensajePedido, setMensajePedido] = useState("");

  const getFechaHoy = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Configuración de tracking según estado
  const trackingConfig = (estado) => {
    // Ajustables a gusto:
    // - disponible: más frecuente para asignación por cercanía
    // - en_pedido: más relajado, informativo para cliente
    if (estado === "en_pedido") return { minMs: 20000, minMeters: 35 }; // 20s / 35m
    return { minMs: 10000, minMeters: 25 }; // 10s / 25m
  };

  // ---- 1) Suscripción a listaCadetes (turnos del día) ----
  useEffect(() => {
    const fechaDia = getFechaHoy();

    const colRef = collection(db, "listaCadetes");
    const q = query(
      colRef,
      where("fechaDia", "==", fechaDia),
      orderBy("creadoEn", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setListaCadetes(data);
        setListaLoading(false);
      },
      (err) => {
        console.error("Error escuchando listaCadetes:", err);
        setListaError("Ocurrió un error al cargar la lista.");
        setListaLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const yaEstoyEnLista = () => {
    const hoy = getFechaHoy();
    return listaCadetes.some(
      (it) =>
        it.cadeteId === repartidorId &&
        it.fechaDia === hoy &&
        it.estado === "esperando"
    );
  };

  const miPosicionEnLista = () => {
    const index = listaCadetes.findIndex((it) => it.cadeteId === repartidorId);
    return index === -1 ? null : index + 1;
  };

  const handleIngresarLista = async () => {
    if (ingresando) return;

    setListaError("");
    setMensajeIngreso("");

    const fechaDia = getFechaHoy();

    try {
      setIngresando(true);

      const colRef = collection(db, "listaCadetes");
      const q = query(
        colRef,
        where("cadeteId", "==", repartidorId),
        where("fechaDia", "==", fechaDia),
        where("estado", "==", "esperando")
      );

      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setMensajeIngreso("Ya estás en la lista de hoy.");
        return;
      }

      await addDoc(colRef, {
        cadeteId: repartidorId,
        fechaDia,
        estado: "esperando",
        creadoEn: serverTimestamp(),
      });

      setMensajeIngreso("Te ingresamos a la lista de hoy.");
    } catch (err) {
      console.error("Error al ingresar a la lista:", err);
      setListaError("No pudimos ingresarte a la lista. Probá de nuevo.");
    } finally {
      setIngresando(false);
    }
  };

  // ---- 2) Tracking en vivo: watchPosition -> ubicacionesCadetes/{repartidorId} ----
  useEffect(() => {
    if (status !== "granted") return;

    let lastSentAt = 0;
    let lastSentCoords = null;

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

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };

        setLiveCoords(next);

        const { minMs, minMeters } = trackingConfig(estadoCadete);

        const now = Date.now();
        if (now - lastSentAt < minMs) return;

        if (lastSentCoords) {
          const moved = distanceMeters(lastSentCoords, next);
          if (moved < minMeters) return;
        }

        lastSentAt = now;
        lastSentCoords = next;

        try {
          const ubicRef = doc(db, "ubicacionesCadetes", repartidorId);
          await setDoc(
            ubicRef,
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
        } catch (err) {
          console.error("Error actualizando ubicación:", err);
        }
      },
      (err) => {
        console.error("watchPosition error:", err);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [status, repartidorId, estadoCadete]);

  // ---- Banner GPS ----
  const renderLocationBanner = () => {
    if (status === "granted") {
      return (
        <div className="location-banner location-banner-ok">
          <span>Ubicación activa ✅</span>
          {liveCoords && (
            <span className="location-coords">
              ({liveCoords.lat.toFixed(4)}, {liveCoords.lng.toFixed(4)})
            </span>
          )}
        </div>
      );
    }

    if (status === "unavailable") {
      return (
        <div className="location-banner location-banner-error">
          <span>Este dispositivo no soporta geolocalización.</span>
        </div>
      );
    }

    return (
      <div className="location-banner location-banner-warn">
        <div className="location-texts">
          <span>
            Necesitamos tu ubicación para trabajar correctamente (asignación de
            pedidos y seguimiento).
          </span>
          {error && <span className="location-error">{error}</span>}
        </div>

        <button
          className="location-btn"
          onClick={requestLocation}
          disabled={status === "checking"}
        >
          {status === "checking" ? "Verificando..." : "Activar ubicación"}
        </button>
      </div>
    );
  };

  // ---- Modal pedido simulado ----
  const handleSimularPedido = () => {
    setMensajePedido("");
    setPedidoSimulado({
      id: "PED-TEST-001",
      origen: "Local Central",
      destino: "Tribunales - Mesa de Entradas",
    });
  };

  const handleAceptarPedido = (pedido) => {
    setPedidoSimulado(null);
    setEstadoCadete("en_pedido");
    setMensajePedido(`Aceptaste el pedido ${pedido?.id || ""}.`);
  };

  const handleRechazarPedido = (pedido) => {
    setPedidoSimulado(null);
    setMensajePedido(`Rechazaste el pedido ${pedido?.id || ""}.`);
  };

  const handleTimeoutPedido = (pedido) => {
    setPedidoSimulado(null);
    if (!pedido) {
      setMensajePedido("Se terminó el tiempo para responder el pedido.");
      return;
    }
    setMensajePedido(`Se terminó el tiempo para responder el pedido ${pedido.id}.`);
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
            {/* Control rápido de estado (para probar frecuencia tracking) */}
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

            {/* Lista de cadetes (turno de hoy) */}
            <section className="lista-section">
              <div className="lista-header">
                <h2 className="home-main-title">Lista de cadetes (hoy)</h2>

                <button
                  className="lista-btn-ingresar"
                  onClick={handleIngresarLista}
                  disabled={ingresando || yaEstoyEnLista()}
                >
                  {yaEstoyEnLista()
                    ? "Ya estás en la lista"
                    : ingresando
                    ? "Ingresando..."
                    : "Ingresarme a la lista"}
                </button>
              </div>

              {listaLoading && (
                <p className="lista-texto-secundario">Cargando lista…</p>
              )}

              {listaError && <p className="lista-error">{listaError}</p>}

              {mensajeIngreso && (
                <p className="lista-mensaje-ok">{mensajeIngreso}</p>
              )}

              {!listaLoading && !listaCadetes.length && (
                <p className="lista-texto-secundario">
                  Todavía no hay cadetes en la lista de hoy.
                </p>
              )}

              {!!listaCadetes.length && (
                <ul className="lista-cadetes">
                  {listaCadetes.map((item, index) => (
                    <li
                      key={item.id}
                      className={`lista-item ${
                        item.cadeteId === repartidorId ? "lista-item-yo" : ""
                      }`}
                    >
                      <span className="lista-posicion">{index + 1}</span>
                      <div className="lista-info">
                        <span className="lista-id">
                          {item.cadeteId}
                          {item.cadeteId === repartidorId && " (vos)"}
                        </span>
                        <span className="lista-estado">
                          Estado: {item.estado || "esperando"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {miPosicionEnLista() && (
                <p className="lista-posicion-resumen">
                  Tu posición actual en la lista:{" "}
                  <strong>{miPosicionEnLista()}</strong>
                </p>
              )}
            </section>

            {/* Botón para ver modal en acción */}
            <section className="simular-section">
              <button className="simular-pedido-btn" onClick={handleSimularPedido}>
                Simular pedido asignado
              </button>

              {mensajePedido && (
                <p className="simular-pedido-mensaje">{mensajePedido}</p>
              )}
            </section>

            <p className="home-main-text">
              Próximo: panel con mapa (Leaflet + OSM) para ver ubicaciones en vivo.
            </p>
          </>
        )}

        {activeTab === "pedidos" && (
          <>
            <h2 className="home-main-title">Pedidos</h2>
            <p className="home-main-text">
              Acá vamos a listar pedidos asignados al repartidor.
            </p>
          </>
        )}

        {activeTab === "billetera" && (
          <>
            <h2 className="home-main-title">Billetera</h2>
            <p className="home-main-text">
              Acá vamos a mostrar cobros, liquidaciones y saldos.
            </p>
          </>
        )}

        {activeTab === "perfil" && (
          <>
            <h2 className="home-main-title">Perfil</h2>
            <p className="home-main-text">
              Datos del repartidor y configuraciones.
            </p>
          </>
        )}
      </main>

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />

      <ModalPedidoAsignado
        pedido={pedidoSimulado}
        segundos={20}
        onAceptar={handleAceptarPedido}
        onRechazar={handleRechazarPedido}
        onTimeout={handleTimeoutPedido}
      />
    </div>
  );
}

export default Home;
