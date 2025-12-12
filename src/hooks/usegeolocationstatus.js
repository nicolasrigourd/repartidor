import { useEffect, useState } from "react";

function useGeolocationStatus() {
  const [status, setStatus] = useState("idle"); 
  // idle | prompt | granted | denied | unavailable | checking | error
  const [error, setError] = useState(null);
  const [coords, setCoords] = useState(null);

  // Al montar, vemos si el navegador soporta geolocalización
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      setError("Este dispositivo no soporta geolocalización.");
      return;
    }

    // Si existe la Permissions API, vemos el estado actual
    if ("permissions" in navigator && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (result.state === "granted") {
            setStatus("granted");
          } else if (result.state === "denied") {
            setStatus("denied");
          } else {
            setStatus("prompt"); // el navegador aún no preguntó
          }

          // Escuchamos cambios (si el usuario toca algo en ajustes)
          result.onchange = () => {
            if (result.state === "granted") {
              setStatus("granted");
              setError(null);
            } else if (result.state === "denied") {
              setStatus("denied");
              setError("Permiso de ubicación denegado.");
            } else {
              setStatus("prompt");
            }
          };
        })
        .catch(() => {
          // Si falla, asumimos que hay que pedir permiso cuando el usuario toque el botón
          setStatus("prompt");
        });
    } else {
      setStatus("prompt");
    }
  }, []);

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      setError("Este dispositivo no soporta geolocalización.");
      return;
    }

    setStatus("checking");
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setStatus("granted");
      },
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        if (err.code === 1) {
          setStatus("denied");
          setError(
            "No tenemos permiso para usar tu ubicación. Activala en los ajustes del navegador."
          );
        } else if (err.code === 2) {
          setStatus("error");
          setError(
            "No pudimos obtener tu ubicación. Revisá que el GPS esté encendido."
          );
        } else if (err.code === 3) {
          setStatus("error");
          setError("La solicitud de ubicación tardó demasiado. Probá de nuevo.");
        } else {
          setStatus("error");
          setError("Ocurrió un error al obtener tu ubicación.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  return { status, error, coords, requestLocation };
}

export default useGeolocationStatus;
