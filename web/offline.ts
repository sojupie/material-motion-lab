import { $ } from "./api";

export async function prepareOffline(): Promise<void> {
  const state = $("offline-state");
  const unavailable = (message: string) => {
    state.textContent = message;
    state.hidden = false;
  };
  if (!("serviceWorker" in navigator)) {
    unavailable("This browser needs a connection to reopen the app.");
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(
      new URL(/* @vite-ignore */ "../sw.js", import.meta.url),
    );
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "redundant") {
        unavailable(
          "Offline files could not be cached. You can still use the app online.",
        );
      }
    });
  } catch (error: unknown) {
    unavailable("Offline caching is unavailable in this browser.");
    console.warn("Offline caching unavailable:", error);
  }
}
