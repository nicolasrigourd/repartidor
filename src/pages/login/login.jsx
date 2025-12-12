import { useState } from "react";
import "./login.css";

function Login({ onLogin, onRegister, hasUser }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!id || !password) {
      setError("Completá ID y clave.");
      return;
    }

    const result = onLogin(id.trim(), password.trim());
    if (!result.ok) {
      setError(result.message);
    }
  };

  const handleRegisterClick = () => {
    setError("");
    setInfo("");

    if (!id || !password) {
      setError("Para registrarte, completá ID y clave.");
      return;
    }

    const result = onRegister(id.trim(), password.trim());
    if (!result.ok) {
      setError(result.message);
    } else {
      setInfo("Usuario registrado y sesión iniciada.");
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">REP</div>

        <h1 className="login-title">Repartidor</h1>
        <p className="login-subtitle">
          {hasUser
            ? "Ingresá con tu ID y clave"
            : "Registrá tu usuario en este dispositivo"}
        </p>

        <form className="login-form" onSubmit={handleLoginSubmit}>
          <div className="form-group">
            <label>ID de repartidor</label>
            <input
              type="text"
              placeholder="Ej: REP001"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Clave</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="login-error">{error}</p>}
          {info && <p className="login-info">{info}</p>}

          <button type="submit" className="btn-primary">
            Iniciar sesión
          </button>
        </form>

        <button onClick={handleRegisterClick} className="btn-secondary">
          Registrarse en este dispositivo
        </button>
      </div>
    </div>
  );
}

export default Login;
