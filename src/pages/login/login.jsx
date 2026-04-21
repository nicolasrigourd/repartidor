import { useState } from "react";
import "./login.css";

function Login({ onLogin }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();

    if (loading) return;

    setError("");
    setInfo("");

    const username = id.trim();
    const pass = password.trim();

    if (!username || !pass) {
      setError("Completá usuario y clave.");
      return;
    }

    try {
      setLoading(true);

      const result = await onLogin(username, pass);

      if (!result?.ok) {
        setError(result?.message || "No se pudo iniciar sesión.");
        return;
      }

      setInfo("Sesión iniciada correctamente.");
    } catch (err) {
      console.error("Error en login:", err);
      setError("Ocurrió un error al iniciar sesión. Revisá la conexión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">REP</div>

        <h1 className="login-title">Repartidor</h1>

        <p className="login-subtitle">
          Ingresá con el usuario y clave asignados por la central.
        </p>

        <form className="login-form" onSubmit={handleLoginSubmit}>
          <div className="form-group">
            <label>Usuario / ID de repartidor</label>
            <input
              type="text"
              placeholder="Ej: 05"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>Clave</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          {error && <p className="login-error">{error}</p>}
          {info && <p className="login-info">{info}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Validando..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;