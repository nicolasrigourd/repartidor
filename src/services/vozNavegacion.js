// Lee en voz alta las instrucciones de la ruta — Web Speech API, nativa del
// navegador/webview, sin costo ni API extra.

export function puedeHablar() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function decirInstruccion(texto) {
  if (!puedeHablar() || !texto) return;

  try {
    window.speechSynthesis.cancel(); // corta lo anterior si seguía hablando
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = "es-AR";
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Si el dispositivo no soporta bien TTS, simplemente no se lee en voz alta.
  }
}

export function detenerVoz() {
  if (puedeHablar()) window.speechSynthesis.cancel();
}
