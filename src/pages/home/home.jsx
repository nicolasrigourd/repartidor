import { useEffect, useState } from "react";
import "./home.css";

import TopBar from "../../components/topbar/topbar";
import BottomBar from "../../components/bottombar/bottombar";

import {
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../firebaseconfig";

function Home({ repartidorId, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  // estado del cadete
  const [estadoCadete, setEstadoCadete] = useState("disponible");

  // GPS
  const [geoStatus, setGeoStatus] = useState("idle"); // idle | granted | denied
  const [geoError, setGeoError] = useState(null);
  const [coords, setCoords] = useState(null);

  // ===== CONFIG TEST (IMPORTANTE) =====
  const trackingConfig = () => {
    return {
      minMs: 3000,     // cada 3 segundos
      minMeters: 0,    // SIN filtro de distancia
    };
  };

  // ===== Solicitar GPS =====
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Este dispositivo no soporta GPS");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setGeoStatus("granted");
      },
      (err) => {
        console.error(err);
        setGeoStatus("denied");
        setGeoError("Debés permitir la ubicación desde el navegador");
      },
      { enableHighAccuracy: true }
    );
  };

  // ===== TRACKING EN VIVO =====
  useEffect(() => {
    if (geoStatus !== "granted") return;

    let lastSentAt = 0;

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };

        setCoords(next);

        const { minMs } = trackingConfig();
        const now = Date.now();

        if (now - lastSentAt < minMs) return;
        lastSentAt = now;

        try {
          console.log("📍 Enviando ubicación a Firestore:", next);

          const ref = doc(db, "ubicacionesCadetes", repartidorId);
          await setDoc(
            ref,
            {
              cadeteId: repartidorId,
              estadoCadete,
              lat: next.lat,
              lng: next.lng,
              accuracy: pos.coords.accuracy,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );

          console.log("✅ Ubicación guardada correctamente");
        } catch (err) {
          console.error("❌ Error escribiendo en Firestore:", err);
        }
      },
      (err) => {
        console.error("watchPosition error:", err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [geoStatus, estadoCadete, repartidorId]);

  // ===== UI =====
  const renderLocationBanner = () => {
    if (geoStatus === "granted") {
      return (
        <div className="location-banner location-banner-ok">
          <span>📡 Ubicación activa</span>
          {coords && (
            <span className="location-coords">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </span>
          )}
        </div>
      );
    }

    if (geoStatus === "denied") {
      return (
        <div className="location-banner location-banner-error">
          <span>{geoError}</span>
        </div>
      );
    }

    return (
      <div className="location-banner location-banner-warn">
        <span>Necesitamos tu ubicación para trabajar</span>
        <button className="location-btn" onClick={requestLocation}>
          Activar ubicación
        </button>
      </div>
    );
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
            <h2 className="home-main-title">Página Home</h2>

            <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
              <button
                className="lista-btn-ingresar"
                onClick={() => setEstadoCadete("disponible")}
                disabled={estadoCadete === "disponible"}
              >
                Disponible
              </button>

              <button
                className="lista-btn-ingresar"
                onClick={() => setEstadoCadete("en_pedido")}
                disabled={estadoCadete === "en_pedido"}
              >
                En pedido
              </button>
            </div>

            <p className="home-main-text">
              Estado actual: <strong>{estadoCadete}</strong>
            </p>

            <p className="home-main-text">
              🔎 Mirá la consola y Firestore → colección{" "}
              <strong>ubicacionesCadetes</strong>
            </p>
          </>
        )}
      </main>

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />
    </div>
  );
}

export default Home;
