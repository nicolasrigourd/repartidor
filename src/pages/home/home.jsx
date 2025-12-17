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

  const [estadoCadete, setEstadoCadete] = useState("disponible"); // disponible | en_pedido

  // GPS
  const [geoStatus, setGeoStatus] = useState("checking");
  const [geoError, setGeoError] = useState(null);
  const [liveCoords, setLiveCoords] = useState(null);

  // Pedidos
  const [pedidoOfertado, setPedidoOfertado] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);

  const watchIdRef = useRef(null);
  const lastSentAtRef = useRef(0);
  const lastSentCoordsRef = useRef(null);

  // =========================
  // GPS helpers
  // =========================
  const trackingConfig = (estado) =>
    estado === "en_pedido"
      ? { minMs: 10000, minMeters: 15 }
      : { minMs: 5000, minMeters: 10 };

  const distanceMeters = (a, b) => {
    const R = 6371000;
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) *
        Math.cos(toRad(b.lat)) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };

  const writeLocationToFirestore = async (pos, force = false) => {
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    };

    setLiveCoords(next);

    const { minMs, minMeters } = trackingConfig(estadoCadete);
    const now = Date.now();

    if (!force) {
      if (now - lastSentAtRef.current < minMs) return;
      if (lastSentCoordsRef.current) {
        const moved = distanceMeters(lastSentCoordsRef.current, next);
        if (moved < minMeters) return;
      }
    }

    lastSentAtRef.current = now;
    lastSentCoordsRef.current = next;

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
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      setGeoError("Geolocalización no soportada.");
      return;
    }

    if (watchIdRef.current) return;

    setGeoStatus("searching");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus("granted");
        writeLocationToFirestore(pos, true);
      },
      () => {
        setGeoStatus("denied");
        setGeoError("Permiso de ubicación denegado.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoStatus("granted");
        writeLocationToFirestore(pos, false);
      },
      () => {
        setGeoStatus("denied");
        setGeoError("Error obteniendo ubicación.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const stopTracking = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  useEffect(() => {
    startTracking();
    return () => stopTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================
  // 🔔 FCM – PERMISOS + TOKEN
  // =========================
  useEffect(() => {
    if (!repartidorId) return;

    let unsub = null;

    const initFCM = async () => {
      if (!("Notification" in window)) return;

      const perm =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;

      if (perm !== "granted") return;

      // ⚠️ REGISTRAMOS EL SW DE FCM SEPARADO
      const reg = await navigator.serviceWorker.register("/fcm-sw.js", {
        scope: "/fcm/",
      });

      const token = await getToken(messaging, {
        vapidKey:
          "BEDzaIKrOaZmTFlQ_9zwjNyVAOwLFZJ-Q-xiOe6Oi_UNJhsTS-9PFn2RncLYmHHHvswEVdsuEPuTU-qnMwVMhdI",
        serviceWorkerRegistration: reg,
      });

      if (!token) return;

      await setDoc(
        doc(db, "ubicacionesCadetes", repartidorId),
        {
          cadeteId: repartidorId,
          fcmToken: token,
          fcmUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      unsub = onMessage(messaging, (payload) => {
        console.log("📩 Push foreground:", payload);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      });
    };

    initFCM();
    return () => unsub && unsub();
  }, [repartidorId]);

  // =========================
  // LISTENERS PEDIDOS
  // =========================
  useEffect(() => {
    if (!repartidorId) return;

    const q = query(
      collection(db, "orders"),
      where("status", "==", "ofertado"),
      where("offer.cadeteId", "==", repartidorId)
    );

    return onSnapshot(q, (snap) => {
      if (snap.empty) {
        setPedidoOfertado(null);
        return;
      }
      const d = snap.docs[0];
      setPedidoOfertado({ ...d.data(), _docId: d.id });
    });
  }, [repartidorId]);

  useEffect(() => {
    if (!repartidorId) return;

    const q = query(
      collection(db, "orders"),
      where("status", "==", "asignado"),
      where("assignedCadeteId", "==", repartidorId)
    );

    return onSnapshot(q, (snap) => {
      if (snap.empty) {
        setPedidoActivo(null);
        return;
      }
      const d = snap.docs[0];
      setPedidoActivo({ ...d.data(), _docId: d.id });
      setEstadoCadete("en_pedido");
    });
  }, [repartidorId]);

  // =========================
  // ACCIONES
  // =========================
  const resolveId = (p) => p?._docId || p?.id;

  const aceptarOferta = async (p) => {
    const id = resolveId(p);
    if (!id) return;

    await updateDoc(doc(db, "orders", id), {
      status: "asignado",
      assignedCadeteId: repartidorId,
      assignedAt: serverTimestamp(),
      "offer.state": "accepted",
      "offer.respondedAt": serverTimestamp(),
    });

    setPedidoOfertado(null);
    setEstadoCadete("en_pedido");
  };

  const rechazarOferta = async (p, reason = "rejected") => {
    const id = resolveId(p);
    if (!id) return;

    await updateDoc(doc(db, "orders", id), {
      status: "pendiente",
      "offer.state": reason,
      "offer.respondedAt": serverTimestamp(),
    });

    setPedidoOfertado(null);
    setEstadoCadete("disponible");
  };

  const finalizarPedido = async (p) => {
    const id = resolveId(p);
    if (!id) return;

    await updateDoc(doc(db, "orders", id), {
      status: "finalizado",
      finishedAt: serverTimestamp(),
    });

    setPedidoActivo(null);
    setEstadoCadete("disponible");
  };

  // =========================
  // RENDER
  // =========================
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
        {pedidoActivo ? (
          <CardPedidoActivo
            pedido={pedidoActivo}
            onFinalizar={finalizarPedido}
          />
        ) : (
          <p className="home-main-text">Sin pedido activo.</p>
        )}
      </main>

      <BottomBar activeTab={activeTab} onChangeTab={setActiveTab} />

      <ModalPedidoAsignado
        pedido={pedidoOfertado}
        segundos={20}
        onAceptar={aceptarOferta}
        onRechazar={(p) => rechazarOferta(p, "rejected")}
        onTimeout={(p) => rechazarOferta(p, "expired")}
      />
    </div>
  );
}

export default Home;
