// Racha de días consecutivos con al menos un pedido completado.
// Se corta apenas hay un día sin entregas (salvo "hoy", que todavía puede sumar).
export function calcRacha(historial) {
  if (!historial?.length) return 0;
  const dias = new Set(
    historial.filter((o) => o.status === "completed").map((o) => o.dateKey).filter(Boolean)
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
