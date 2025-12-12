import { useEffect, useState } from "react";
import Login from "./pages/login/login";
import Home from "./pages/home/home";
import PwaUpdatePrompt from "./components/pwaupdate/pwaupdate";

// Nombre de la clave en localStorage
const STORAGE_KEY = "userRep";

function App() {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Al iniciar, intento leer userRep del localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
        setIsLoggedIn(!!parsed.loggedIn);
      } catch (err) {
        console.error("Error leyendo userRep:", err);
      }
    }
  }, []);

  // Cada vez que user cambie, se guarda
  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    }
  }, [user]);

  // Registrar cadete en este dispositivo
  const handleRegister = (id, password) => {
    if (!id || !password) {
      return { ok: false, message: "Completá ID y clave." };
    }

    if (user) {
      return {
        ok: false,
        message: "Ya existe un usuario registrado en este dispositivo.",
      };
    }

    const newUser = { id, password, loggedIn: true };
    setUser(newUser);
    setIsLoggedIn(true);
    return { ok: true };
  };

  // Login
  const handleLogin = (id, password) => {
    if (!user) {
      return { ok: false, message: "No hay usuario registrado. Usá 'Registrarse'." };
    }

    if (id === user.id && password === user.password) {
      const updated = { ...user, loggedIn: true };
      setUser(updated);
      setIsLoggedIn(true);
      return { ok: true };
    }

    return { ok: false, message: "ID o clave incorrectos." };
  };

  // Logout
  const handleLogout = () => {
    if (!user) return;
    const updated = { ...user, loggedIn: false };
    setUser(updated);
    setIsLoggedIn(false);
  };

  return (
    <div>
      {!isLoggedIn ? (
        <Login onLogin={handleLogin} onRegister={handleRegister} hasUser={!!user} />
      ) : (
        <Home repartidorId={user.id} onLogout={handleLogout} />
      )}

      {/* ✅ Siempre visible cuando haya update disponible */}
      <PwaUpdatePrompt />
    </div>
  );
}

export default App;
