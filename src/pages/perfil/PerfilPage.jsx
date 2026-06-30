import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import {
  Trophy, Fire, Star, ThumbsUp, ThumbsDown,
  SignOut, Motorcycle, Bicycle, Car, User,
  CaretDown, CaretUp, Wallet, ThermometerCold,
  Truck, CreditCard, Clock,
} from "@phosphor-icons/react";
import {
  updateCashOnHand,
  updateHasThermalBag,
  requestVehicleChange,
  requestMercadoPagoChange,
} from "../../services/perfilService";
import { calcRacha } from "../../utils/gamification";
import "./PerfilPage.css";

const VEHICLE_OPTIONS = [
  { value: "bike", label: "Bicicleta" },
  { value: "moto", label: "Moto" },
  { value: "car",  label: "Auto" },
  { value: "van",  label: "Camioneta" },
];

function fmt$(v) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

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

  // ── Estadísticas plegables ───────────────────────────────
  const [statsOpen, setStatsOpen] = useState(false);

  // ── Mi efectivo — edición directa ────────────────────────
  const [editingCash, setEditingCash] = useState(false);
  const [cashHandForm, setCashHandForm] = useState("");
  const [cashAccForm, setCashAccForm] = useState("");
  const [savingCash, setSavingCash] = useState(false);

  const startEditCash = () => {
    setCashHandForm(String(ficha?.dineroDisponible ?? 0));
    setCashAccForm(String(ficha?.dineroEnCuenta ?? 0));
    setEditingCash(true);
  };

  const handleSaveCash = async () => {
    setSavingCash(true);
    try {
      await updateCashOnHand(repartidorId, {
        cashOnHand: cashHandForm,
        cashInAccount: cashAccForm,
      });
      setEditingCash(false);
    } catch (err) {
      console.error("Error guardando efectivo:", err);
    } finally {
      setSavingCash(false);
    }
  };

  // ── Caja térmica — toggle directo ────────────────────────
  const [savingThermalBag, setSavingThermalBag] = useState(false);

  const handleToggleThermalBag = async () => {
    setSavingThermalBag(true);
    try {
      await updateHasThermalBag(repartidorId, !ficha?.hasThermalBag);
    } catch (err) {
      console.error("Error guardando caja térmica:", err);
    } finally {
      setSavingThermalBag(false);
    }
  };

  // ── Movilidad — solicitud con aprobación de admin ────────
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);
  const vehiclePending = Boolean(ficha?.pendingVehicleType);

  const handleRequestVehicle = async () => {
    if (!vehicleForm) return;
    setSavingVehicle(true);
    try {
      await requestVehicleChange(repartidorId, vehicleForm);
      setEditingVehicle(false);
    } catch (err) {
      console.error("Error solicitando cambio de movilidad:", err);
    } finally {
      setSavingVehicle(false);
    }
  };

  // ── MercadoPago — solicitud con aprobación de admin ──────
  const [editingMp, setEditingMp] = useState(false);
  const [mpAliasForm, setMpAliasForm] = useState("");
  const [mpCvuForm, setMpCvuForm] = useState("");
  const [savingMp, setSavingMp] = useState(false);
  const mpPending = Boolean(ficha?.pendingPaymentMpAlias || ficha?.pendingPaymentMpCvu);

  const startEditMp = () => {
    setMpAliasForm(ficha?.paymentMpAlias || "");
    setMpCvuForm(ficha?.paymentMpCvu || "");
    setEditingMp(true);
  };

  const handleRequestMp = async () => {
    if (!mpAliasForm.trim() && !mpCvuForm.trim()) return;
    setSavingMp(true);
    try {
      await requestMercadoPagoChange(repartidorId, { alias: mpAliasForm, cvu: mpCvuForm });
      setEditingMp(false);
    } catch (err) {
      console.error("Error solicitando cambio de MercadoPago:", err);
    } finally {
      setSavingMp(false);
    }
  };

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

      {/* Stats operacionales — plegable */}
      <button className="pfp-section-title pfp-section-title--toggle" onClick={() => setStatsOpen(v => !v)}>
        <span>Estadísticas</span>
        {statsOpen ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
      </button>
      {statsOpen && (
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
      )}

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

      {/* Mi efectivo — edición directa */}
      <div className="pfp-section-title">
        <Wallet size={12} weight="bold" /> Mi efectivo
      </div>
      <div className="pfp-card">
        {!editingCash ? (
          <>
            <div className="pfp-rows">
              <div className="pfp-row">
                <span>Efectivo encima</span>
                <strong>{fmt$(ficha?.dineroDisponible)}</strong>
              </div>
              <div className="pfp-row">
                <span>En cuenta</span>
                <strong>{fmt$(ficha?.dineroEnCuenta)}</strong>
              </div>
            </div>
            <button className="pfp-link-btn" onClick={startEditCash}>Editar</button>
          </>
        ) : (
          <div className="pfp-edit-form">
            <div className="pfp-edit-form__field">
              <label>Efectivo encima</label>
              <input type="number" inputMode="numeric" value={cashHandForm} onChange={(e) => setCashHandForm(e.target.value)} />
            </div>
            <div className="pfp-edit-form__field">
              <label>En cuenta</label>
              <input type="number" inputMode="numeric" value={cashAccForm} onChange={(e) => setCashAccForm(e.target.value)} />
            </div>
            <div className="pfp-edit-form__actions">
              <button className="pfp-btn-secondary" onClick={() => setEditingCash(false)} disabled={savingCash}>Cancelar</button>
              <button className="pfp-btn-primary" onClick={handleSaveCash} disabled={savingCash}>
                {savingCash ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mis capacidades — toggles libres, sin aprobación */}
      <div className="pfp-section-title">Mis capacidades</div>
      <div className="pfp-card">
        <label className="pfp-toggle-row">
          <input
            type="checkbox"
            checked={Boolean(ficha?.hasThermalBag)}
            disabled={savingThermalBag}
            onChange={handleToggleThermalBag}
          />
          <ThermometerCold size={16} weight="fill" />
          <span>Tengo caja térmica</span>
        </label>
        <small className="pfp-hint">Más tildes acá significan más posibilidades de match con pedidos.</small>
      </div>

      {/* Movilidad — solicitud con aprobación de admin */}
      <div className="pfp-section-title">
        <Truck size={12} weight="bold" /> Movilidad
      </div>
      <div className="pfp-card">
        <div className="pfp-rows">
          <div className="pfp-row">
            <VehicleIcon size={15} weight="fill" />
            <span>Actual</span>
            <strong>{ficha?.movilidad || "—"}</strong>
          </div>
        </div>

        {vehiclePending ? (
          <div className="pfp-pending-badge">
            <Clock size={13} weight="bold" />
            Solicitud pendiente de aprobación: {VEHICLE_OPTIONS.find(v => v.value === ficha.pendingVehicleType)?.label || ficha.pendingVehicleType}
          </div>
        ) : !editingVehicle ? (
          <button className="pfp-link-btn" onClick={() => setEditingVehicle(true)}>Solicitar cambio</button>
        ) : (
          <div className="pfp-edit-form">
            <div className="pfp-edit-form__field">
              <label>Nueva movilidad</label>
              <select value={vehicleForm} onChange={(e) => setVehicleForm(e.target.value)}>
                <option value="">Seleccionar...</option>
                {VEHICLE_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="pfp-edit-form__actions">
              <button className="pfp-btn-secondary" onClick={() => setEditingVehicle(false)} disabled={savingVehicle}>Cancelar</button>
              <button className="pfp-btn-primary" onClick={handleRequestVehicle} disabled={savingVehicle || !vehicleForm}>
                {savingVehicle ? "Enviando…" : "Solicitar"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MercadoPago — solicitud con aprobación de admin */}
      <div className="pfp-section-title">
        <CreditCard size={12} weight="bold" /> MercadoPago
      </div>
      <div className="pfp-card">
        <div className="pfp-rows">
          <div className="pfp-row">
            <span>Alias</span>
            <strong>{ficha?.paymentMpAlias || "No configurado"}</strong>
          </div>
        </div>

        {mpPending ? (
          <div className="pfp-pending-badge">
            <Clock size={13} weight="bold" />
            Solicitud pendiente de aprobación: {ficha.pendingPaymentMpAlias || ficha.pendingPaymentMpCvu}
          </div>
        ) : !editingMp ? (
          <button className="pfp-link-btn" onClick={startEditMp}>
            {ficha?.paymentMpAlias ? "Cambiar" : "Configurar"}
          </button>
        ) : (
          <div className="pfp-edit-form">
            <div className="pfp-edit-form__field">
              <label>Alias</label>
              <input type="text" value={mpAliasForm} onChange={(e) => setMpAliasForm(e.target.value)} placeholder="Ej: juan.perez" />
            </div>
            <div className="pfp-edit-form__field">
              <label>CVU</label>
              <input type="text" value={mpCvuForm} onChange={(e) => setMpCvuForm(e.target.value)} placeholder="21 dígitos" />
            </div>
            <div className="pfp-edit-form__actions">
              <button className="pfp-btn-secondary" onClick={() => setEditingMp(false)} disabled={savingMp}>Cancelar</button>
              <button className="pfp-btn-primary" onClick={handleRequestMp} disabled={savingMp}>
                {savingMp ? "Enviando…" : "Solicitar"}
              </button>
            </div>
          </div>
        )}
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
