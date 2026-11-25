import { supabaseUrl, supabasePublishableKey } from "./config.js";

export const configured = Boolean(supabaseUrl && supabasePublishableKey);

async function request(path, body, token) {
  const headers = { apikey: supabasePublishableKey, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || "Não foi possível concluir.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export const rpc = (name, body = {}, token) => request(`/rest/v1/rpc/${name}`, body, token);
export const signIn = (email, password) =>
  request("/auth/v1/token?grant_type=password", { email, password });

export function dateLabel(day) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC"
  }).format(new Date(`${day}T12:00:00Z`));
}
