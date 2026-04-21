import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import Login from "./pages/Login/Login";
import Home from "./pages/home/home";
import PwaUpdatePrompt from "./components/pwaupdate/pwaupdate";
import { db } from "./firebaseconfig";

const STORAGE_KEY = "userRep";

function App() {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);

      if (parsed?.loggedIn && parsed?.docId && parsed?.ficha?.id) {
        setUser(parsed);
        setIsLoggedIn(true);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      console.error("Error leyendo userRep:", err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [user]);

  useEffect(() => {
    if (!isLoggedIn || !user?.docId) return;

    const ref = doc(db, "repartidores", String(user.docId));

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          cerrarSesionForzada("Tu usuario ya no existe en la central.");
          return;
        }

        const repartidor = {
          docId: snap.id,
          ...snap.data(),
        };

        const validation = validarRepartidorHabilitado(repartidor);

        if (!validation.ok) {
          cerrarSesionForzada(validation.message);
          return;
        }

        const updatedSession = buildSessionUser(repartidor);

        setUser((prev) => ({
          ...updatedSession,
          loggedIn: prev?.loggedIn ?? true,
        }));
      },
      (error) => {
        console.error("Error escuchando repartidor:", error);
      }
    );

    return () => unsubscribe();
  }, [isLoggedIn, user?.docId]);

  const validarRepartidorHabilitado = (repartidor) => {
    if (!repartidor) {
      return {
        ok: false,
        message: "Usuario no encontrado.",
      };
    }

    if (repartidor.activo === false) {
      return {
        ok: false,
        message: "Tu usuario se encuentra inactivo.",
      };
    }

    if (repartidor.visible === false) {
      return {
        ok: false,
        message: "Tu usuario no se encuentra visible para operar.",
      };
    }

    if (repartidor.bloqueado === true) {
      return {
        ok: false,
        message: "Tu usuario se encuentra bloqueado por la central.",
      };
    }

    if (repartidor.usaApp !== true) {
      return {
        ok: false,
        message: "Este repartidor no tiene habilitado el uso de app.",
      };
    }

    if (repartidor.appAccess?.enabled !== true) {
      return {
        ok: false,
        message: "El acceso a la app no está habilitado.",
      };
    }

    return { ok: true };
  };

  const sanitizeFicha = (repartidor) => {
    return {
      docId: repartidor.docId || repartidor.id,
      id: repartidor.id || repartidor.docId,

      nombre: repartidor.nombre || "",
      apellido: repartidor.apellido || "",
      dni: repartidor.dni || "",
      domicilio: repartidor.domicilio || "",
      celular: repartidor.celular || "",
      fotoPerfil: repartidor.fotoPerfil || "",
      observaciones: repartidor.observaciones || "",

      movilidad: repartidor.movilidad || "",
      tipoRepartidor: repartidor.tipoRepartidor || "local",
      sucursal: repartidor.sucursal || "",

      usaApp: repartidor.usaApp === true,
      activo: repartidor.activo !== false,
      visible: repartidor.visible !== false,
      bloqueado: repartidor.bloqueado === true,
      aptoManejoDinero: repartidor.aptoManejoDinero === true,

      direccionBase: repartidor.direccionBase || "",
      baseLat:
        repartidor.baseLat === "" || repartidor.baseLat == null
          ? null
          : Number(repartidor.baseLat),
      baseLng:
        repartidor.baseLng === "" || repartidor.baseLng == null
          ? null
          : Number(repartidor.baseLng),

      dineroDisponible: Number(repartidor.dineroDisponible) || 0,
      deudaActual: Number(repartidor.deudaActual) || 0,
      multaActual: Number(repartidor.multaActual) || 0,
      baseActual: Number(repartidor.baseActual) || 0,

      nivel: Number(repartidor.nivel) || 1,
      valoracionesPositivas: Number(repartidor.valoracionesPositivas) || 0,
      valoracionesNegativas: Number(repartidor.valoracionesNegativas) || 0,
      strikes: Number(repartidor.strikes) || 0,

      fechaAlta: repartidor.fechaAlta || "",
      createdAt: repartidor.createdAt || null,
      updatedAt: repartidor.updatedAt || null,

      appAccess: {
        enabled: repartidor.appAccess?.enabled === true,
        requiereCambioClave:
          repartidor.appAccess?.requiereCambioClave === true,
        lastConnection: repartidor.appAccess?.lastConnection || null,
      },
    };
  };

  const buildSessionUser = (repartidor) => {
    const ficha = sanitizeFicha(repartidor);

    return {
      loggedIn: true,

      docId: ficha.docId,
      id: ficha.id,

      ficha,

      nombre: ficha.nombre,
      apellido: ficha.apellido,
      dni: ficha.dni,
      celular: ficha.celular,
      fotoPerfil: ficha.fotoPerfil,

      movilidad: ficha.movilidad,
      tipoRepartidor: ficha.tipoRepartidor,
      sucursal: ficha.sucursal,

      usaApp: ficha.usaApp,
      activo: ficha.activo,
      visible: ficha.visible,
      bloqueado: ficha.bloqueado,
      aptoManejoDinero: ficha.aptoManejoDinero,

      appAccess: {
        enabled: ficha.appAccess.enabled,
        requiereCambioClave: ficha.appAccess.requiereCambioClave,
        lastConnection: ficha.appAccess.lastConnection,
      },
    };
  };

  const cerrarSesionForzada = (message) => {
    setSessionMessage(message || "Sesión finalizada por la central.");
    setUser(null);
    setIsLoggedIn(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleLogin = async (username, password) => {
    if (!username || !password) {
      return {
        ok: false,
        message: "Completá usuario y clave.",
      };
    }

    try {
      const q = query(
        collection(db, "repartidores"),
        where("appAccess.username", "==", username)
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        return {
          ok: false,
          message: "Usuario no encontrado.",
        };
      }

      if (snapshot.docs.length > 1) {
        return {
          ok: false,
          message:
            "Hay más de un repartidor con este usuario. Revisá la ficha en la central.",
        };
      }

      const docSnap = snapshot.docs[0];

      const repartidor = {
        docId: docSnap.id,
        ...docSnap.data(),
      };

      const validation = validarRepartidorHabilitado(repartidor);

      if (!validation.ok) {
        return validation;
      }

      const savedPassword = String(repartidor.appAccess?.password || "");

      if (savedPassword !== password) {
        return {
          ok: false,
          message: "Clave incorrecta.",
        };
      }

      const sessionUser = buildSessionUser(repartidor);

      await updateDoc(doc(db, "repartidores", repartidor.docId), {
        "appAccess.lastConnection": serverTimestamp(),
      });

      setUser(sessionUser);
      setIsLoggedIn(true);
      setSessionMessage("");

      return { ok: true };
    } catch (error) {
      console.error("Error validando login:", error);

      return {
        ok: false,
        message: "No se pudo validar el acceso. Revisá la conexión.",
      };
    }
  };

  const handleLogout = () => {
    setUser(null);
    setIsLoggedIn(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div>
      {!isLoggedIn ? (
        <>
          {sessionMessage && (
            <div
              style={{
                margin: "12px",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "#fee2e2",
                color: "#991b1b",
                fontWeight: 700,
                fontSize: "0.9rem",
              }}
            >
              {sessionMessage}
            </div>
          )}

          <Login onLogin={handleLogin} />
        </>
      ) : (
        <Home repartidorId={user.id} user={user} onLogout={handleLogout} />
      )}

      <PwaUpdatePrompt />
    </div>
  );
}

export default App;