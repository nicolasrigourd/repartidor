import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import {
  Trophy, Fire, Star, ThumbsUp, ThumbsDown,
  SignOut, Motorcycle, Bicycle, Car, User,
} from "@phosphor-icons/react";
import "./PerfilPage.css";

// Pedidos acumulados necesarios para llegar a cada nivel
const LEVEL_THRESHOLDS = [0, 20, 50, 100, 200, 500];
const LEVEL_NAMES      = ["", "Principiante", "En camino", "Experimentado", "Veterano", "Élite"];

function getLevelProgress(level, totalPedidos) {
  const lvl    = Math.max(1, Math.min(level, LEVEL_THRESHOLDS.length - 1));
  const isMax  = lvl >= LEVEL_THRESHOLDS.length - 1;
  if (isMax) return { progress: 1, pedidosRestantes: 0, nextLevel: lvl, isMaxLevel: true };

  const start  = LEVEL_THRESHOLDS[lvl - 1] || 0;
  const nextAt = LEVEL_THRESHOLDS[lvl];
  const range  = nextAt - start;
  const done   = Math.max(totalPedidos - start, 0);

  return {
    progress: Math.min(done / range, 1),
    pedidosRestantes: Math.max(nextAt - totalPedidos, 0),
    nextLevel: lvl + 1,
    isMaxLevel: false,
    range,
    done: Math.min(done, range),
  };
}

function calcRacha(historial) {
  if (!historial?.length) return 0;
  const dias = new Set(
    historial.filter(o => o.status === "completed").map(o => o.dateKey).filter(Boolean)
  );
  let racha = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    if (dias.has(k)) { racha++; }
    else if (i > 0)  { break; }
  }
  return racha;
}

const VEHICLE_ICONS = { moto: Motorcycle, bici: Bicycle, auto: Car };

export default function PerfilPage({ ficha, nombreCompleto, repartidorId, onLogout }) {
  const statsTotal   = useLiveQuery(() => repartidorDb.estadisticas.get("total"), []);
  const historial    = useLiveQuery(() => repartidorDb.historial.toArray(),       []);
  const valoraciones = useLiveQuery(() => repartidorDb.valoraciones.toArray(),    []);

  const level      = ficha?.nivel || ficha?.level || 1;
  const totalPeds  = statsTotal?.pedidosCompletados || 0;
  const levelData  = useMemo(() => getLevelProgress(level, totalPeds), [level, totalPeds]);
  const racha      = useMemo(() => calcRacha(historial), [historial]);

  const positivas  = ficha?.valoracionesPositivas ?? valoraciones?.filter(v => v.score >= 4).length ?? 0;
  const negativas  = ficha?.valoracionesNegativas ?? valoraciones?.filter(v => v.score <= 2).length ?? 0;
  const avgRating  = statsTotal?.avgRating ?? null;

  const VehicleIcon = VEHICLE_ICONS[ficha?.movilidad?.toLowerCase()] || Motorcycle;
  const initials    = ((ficha?.nombre?.[0] || "") + (ficha?.apellido?.[0] || "")).toUpperCase() || "?";

  return (
    <div className="pfp-root">
      {/* Avatar + nombre */}
      <div className="pfp-hero">
        <div className="pfp-avatar">{initials}</div>
        <div className="pfp-hero__text">
          <strong>{nombreCompleto || "Repartidor"}</strong>
          <span>ID {ficha?.id || repartidorId} · {ficha?.sucursal || "—"}</span>
        </div>
      </div>

      {/* Nivel */}
      <div className="pfp-level">
        <div className="pfp-level__top">
          <div className="pfp-level__badge">
            <Trophy size={14} weight="fill" />
            <span>Nivel {level}</span>
            <em>{LEVEL_NAMES[level] || ""}</em>
          </div>
          <span className="pfp-level__hint">
            {levelData.isMaxLevel
              ? "🏆 Nivel máximo"
              : `${levelData.pedidosRestantes} pedidos para nivel ${levelData.nextLevel}`}
          </span>
        </div>
        <div className="pfp-level__bar">
          <div className="pfp-level__fill" style={{ width: `${levelData.progress * 100}%` }} />
        </div>
        <div className="pfp-level__counts">
          {!levelData.isMaxLevel && (
            <span>{levelData.done} / {levelData.range}</span>
          )}
          <span>{totalPeds} pedidos completados en total</span>
        </div>
      </div>

      {/* Stats destacadas */}
      <div className="pfp-badges">
        <div className="pfp-badge pfp-badge--fire">
          <Fire size={22} weight="fill" />
          <strong>{racha}</strong>
          <span>{racha === 1 ? "día racha" : "días racha"}</span>
        </div>
        <div className="pfp-badge pfp-badge--star">
          <Star size={22} weight="fill" />
          <strong>{avgRating != null ? avgRating.toFixed(1) : "—"}</strong>
          <span>Rating</span>
        </div>
        <div className="pfp-badge pfp-badge--pos">
          <ThumbsUp size={22} weight="fill" />
          <strong>{positivas}</strong>
          <span>Positivas</span>
        </div>
        <div className="pfp-badge pfp-badge--neg">
          <ThumbsDown size={22} weight="fill" />
          <strong>{negativas}</strong>
          <span>Negativas</span>
        </div>
      </div>

      {/* Stats operacionales */}
      <div className="pfp-section-title">Estadísticas</div>
      <div className="pfp-rows">
        <div className="pfp-row">
          <span>Pedidos completados</span>
          <strong>{statsTotal?.pedidosCompletados ?? 0}</strong>
        </div>
        <div className="pfp-row">
          <span>Pedidos cancelados</span>
          <strong>{statsTotal?.pedidosCancelados ?? 0}</strong>
        </div>
        <div className="pfp-row">
          <span>Valoraciones totales</span>
          <strong>{statsTotal?.valoraciones ?? 0}</strong>
        </div>
        <div className="pfp-row">
          <span>Strikes</span>
          <strong className={(ficha?.strikes || 0) > 0 ? "pfp-danger" : ""}>
            {ficha?.strikes ?? 0}
          </strong>
        </div>
      </div>

      {/* Datos operativos */}
      <div className="pfp-section-title">Datos operativos</div>
      <div className="pfp-rows">
        <div className="pfp-row">
          <VehicleIcon size={15} weight="fill" />
          <span>Vehículo</span>
          <strong>{ficha?.movilidad || "—"}</strong>
        </div>
        <div className="pfp-row">
          <User size={15} weight="fill" />
          <span>Tipo</span>
          <strong>{ficha?.tipoRepartidor || "—"}</strong>
        </div>
        <div className="pfp-row">
          <span className="pfp-dot" />
          <span>Sucursal</span>
          <strong>{ficha?.sucursal || "—"}</strong>
        </div>
        <div className="pfp-row">
          <span className="pfp-dot" />
          <span>Celular</span>
          <strong>{ficha?.celular || "—"}</strong>
        </div>
        <div className="pfp-row">
          <span className="pfp-dot" />
          <span>Manejo de dinero</span>
          <strong className={ficha?.aptoManejoDinero ? "pfp-green" : ""}>
            {ficha?.aptoManejoDinero ? "Autorizado" : "No autorizado"}
          </strong>
        </div>
      </div>

      {/* Logout */}
      <div className="pfp-footer">
        <button className="pfp-logout" onClick={onLogout}>
          <SignOut size={16} weight="bold" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
