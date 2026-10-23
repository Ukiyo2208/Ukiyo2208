// Notifications push sur cet appareil (Web Push) : abonnement, désabonnement, état.
import { api } from "./state.js";

const b64ToBytes = s => Uint8Array.from(atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
export const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Pourquoi le push n'est pas possible ici (texte), ou "" s'il l'est. */
export function unsupported() {
  if (!isSecureContext) return "https";
  if (ios() && !standalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "browser";
  return "";
}

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (ios() && !/iPhone/.test(ua)) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const nav = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return standalone() ? `${os} · appli` : `${os}${nav ? " · " + nav : ""}`;
}

async function registration() {
  return navigator.serviceWorker.getRegistration().then(r => r || navigator.serviceWorker.register("/sw.js")).then(() => navigator.serviceWorker.ready);
}

export async function current() {
  if (unsupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

function remember(on) { try { on ? localStorage.setItem("bt-push", "1") : localStorage.removeItem("bt-push"); } catch {} }
export const active = () => { try { return localStorage.getItem("bt-push") === "1"; } catch { return false; } };

export async function enable() {
  const why = unsupported();
  if (why) throw new Error(why === "https" ? "Les notifications push demandent une adresse en https://"
    : why === "ios-install" ? "Sur iPhone, installe d'abord l'appli (Partager → Sur l'écran d'accueil), puis active les notifications depuis l'appli"
    : "Ce navigateur ne gère pas les notifications push");
  if (await Notification.requestPermission() !== "granted") throw new Error("Notifications refusées : autorise-les dans les réglages du navigateur");
  const { key } = await api("/api/push");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey || []))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== key) {
    await sub.unsubscribe();  // clé du serveur changée
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api("/api/push/subscribe", { json: { ...sub.toJSON(), name: deviceName() } });
  remember(true);
  return sub;
}

export async function disable() {
  const sub = await current();
  if (sub) {
    await api("/api/push/unsubscribe", { json: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  remember(false);
}
