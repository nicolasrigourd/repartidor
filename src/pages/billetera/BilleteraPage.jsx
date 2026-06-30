import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { repartidorDb } from "../../db/repartidorDb";
import { Warning, TrendUp, Wallet, CreditCard } from "@phosphor-icons/react";
import { updateCashOnHand } from "../../services/perfilService";
import "./BilleteraPage.css";

function fmt$(v) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

function MoneyCard({ variant, icon, label, value, editing, formValue, saving, onStartEdit, onChangeForm, onSave, onCancel }) {
  return (
    <div className={`bp-money-card bp-money-card--${variant}`}>
      {!editing ? (
        <button className="bp-money-card__tap" onClick={onStartEdit}>
          {icon}
          <span className="bp-money-card__label">{label}</span>
          <strong className="bp-money-card__amount">{fmt$(value)}</strong>
          <span className="bp-money-card__edit-hint">Tocar para editar</span>
        </button>
      ) : (
        <div className="bp-money-card__edit">
          <span className="bp-money-card__label">{label}</span>
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            value={formValue}
            onChange={(e) => onChangeForm(e.target.value)}
          />
          <div className="bp-money-card__actions">
            <button className="bp-money-card__cancel" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button className="bp-money-card__save" onClick={onSave} disabled={saving}>
              {saving ? "..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BilleteraPage({ ficha, repartidorId }) {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const statsHoy   = useLiveQuery(() => repartidorDb.estadisticas.get(`hoy_${today}`),     [today]);
  const statsMes   = useLiveQuery(() => repartidorDb.estadisticas.get(`mes_${thisMonth}`), [thisMonth]);
  const statsTotal = useLiveQuery(() => repartidorDb.estadisticas.get("total"),             []);

  const hayDeuda = (ficha?.deudaActual || 0) > 0;
  const hayMulta = (ficha?.multaActual || 0) > 0;

  // ── Efectivo / En cuenta — tap para editar, cada card independiente ──
  const [editingCash, setEditingCash] = useState(null); // "hand" | "account" | null
  const [cashForm, setCashForm] = useState("");
  const [savingCash, setSavingCash] = useState(false);

  const startEdit = (field, currentValue) => {
    setCashForm(String(currentValue ?? 0));
    setEditingCash(field);
  };

  const handleSave = async () => {
    setSavingCash(true);
    try {
      await updateCashOnHand(repartidorId, {
        cashOnHand:    editingCash === "hand"    ? cashForm : ficha?.dineroDisponible,
        cashInAccount: editingCash === "account" ? cashForm : ficha?.dineroEnCuenta,
      });
      setEditingCash(null);
    } catch (err) {
      console.error("Error guardando dinero:", err);
    } finally {
      setSavingCash(false);
    }
  };

  return (
    <div className="bp-root">
      {/* Efectivo / En cuenta — separados, tap para editar */}
      <div className="bp-money-cards">
        <MoneyCard
          variant="green"
          icon={<Wallet size={20} weight="fill" />}
          label="Efectivo encima"
          value={ficha?.dineroDisponible}
          editing={editingCash === "hand"}
          formValue={cashForm}
          saving={savingCash}
          onStartEdit={() => startEdit("hand", ficha?.dineroDisponible)}
          onChangeForm={setCashForm}
          onSave={handleSave}
          onCancel={() => setEditingCash(null)}
        />
        <MoneyCard
          variant="blue"
          icon={<CreditCard size={20} weight="fill" />}
          label="En cuenta · MercadoPago"
          value={ficha?.dineroEnCuenta}
          editing={editingCash === "account"}
          formValue={cashForm}
          saving={savingCash}
          onStartEdit={() => startEdit("account", ficha?.dineroEnCuenta)}
          onChangeForm={setCashForm}
          onSave={handleSave}
          onCancel={() => setEditingCash(null)}
        />
      </div>

      {/* Alertas */}
      {(hayDeuda || hayMulta) && (
        <div className="bp-alerts">
          {hayDeuda && (
            <div className="bp-alert bp-alert--danger">
              <Warning size={15} weight="fill" />
              <span>Deuda: <strong>{fmt$(ficha.deudaActual)}</strong></span>
            </div>
          )}
          {hayMulta && (
            <div className="bp-alert bp-alert--warning">
              <Warning size={15} weight="fill" />
              <span>Multa: <strong>{fmt$(ficha.multaActual)}</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Estado del día */}
      <div className="bp-section">
        <span className="bp-section__title">Estado del día</span>
        <div className="bp-cards">
          <div className="bp-card">
            <span>Base hoy</span>
            <strong>{fmt$(ficha?.baseActual)}</strong>
          </div>
          <div className="bp-card bp-card--green">
            <span>Ganancia hoy</span>
            <strong>{fmt$(statsHoy?.gananciaTotal)}</strong>
          </div>
          <div className="bp-card">
            <span>Pedidos hoy</span>
            <strong>{statsHoy?.pedidosCompletados ?? 0}</strong>
          </div>
        </div>
      </div>

      {/* Ganancias */}
      <div className="bp-section">
        <span className="bp-section__title">
          <TrendUp size={13} weight="bold" /> Ganancias
        </span>
        <div className="bp-rows">
          <div className="bp-row">
            <span>Este mes</span>
            <strong>{fmt$(statsMes?.gananciaTotal)}</strong>
          </div>
          <div className="bp-row">
            <span>Pedidos este mes</span>
            <strong>{statsMes?.pedidosCompletados ?? 0}</strong>
          </div>
          <div className="bp-row bp-row--total">
            <span>Total histórico</span>
            <strong>{fmt$(statsTotal?.gananciaTotal)}</strong>
          </div>
          <div className="bp-row bp-row--total">
            <span>Pedidos totales</span>
            <strong>{statsTotal?.pedidosCompletados ?? 0}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
