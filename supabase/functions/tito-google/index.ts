const clientId = "712915809457-mltu2vl3ahr96dq82o8b35vfjo9ujfoq.apps.googleusercontent.com";
const base = Deno.env.get("SUPABASE_URL")!;
const redirect = "https://hlhlwkxobecoelnvylvy.supabase.co/functions/v1/tito-google/oauth/callback";
const panel = "https://matheuszaninicode.github.io/visitas-tito/agenda.html";
const calendarScope = "https://www.googleapis.com/auth/calendar.app.created";
const gmailScope = "https://www.googleapis.com/auth/gmail.send";

function reply(message: string, status = 200) {
  return new Response(message, { status, headers: {
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Content-Type": "text/plain; charset=utf-8",
  } });
}

async function rpc(name: string, params: Record<string, unknown>) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Database operation failed");
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function processJobs(workerKey: string, secret: string) {
  const job = await rpc("tito_google_claim", { worker_key: workerKey });
  if (!job) return reply("Sem avisos pendentes.");
  const connection = await rpc("tito_google_worker_config", {});
  if (!connection?.calendar_id) return reply("Calendário pendente.", 503);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId, client_secret: secret, refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenResponse.ok) return reply("Renovação Google pendente.", 502);
  const { access_token } = await tokenResponse.json();
  const headers = { Authorization: "Bearer " + access_token, "Content-Type": "application/json" };
  const resource = "https://www.googleapis.com/calendar/v3/calendars/" +
    encodeURIComponent(connection.calendar_id) + "/events";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(job.booking_id));
  const eventId = "tito" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const hour = job.start_time.slice(0, 5);
  const start = job.day + "T" + hour + ":00-03:00";
  const end = new Date(Date.parse(start) + 1800000).toISOString();
  const progress = { job_id: job.id, job_lease: job.lease };
  if (!job.calendar_done) {
    const event = {
      summary: "Visita ao Tito",
      description: job.names.join(", "),
      location: "São Luiz Anália Franco",
      start: { dateTime: start, timeZone: "America/Sao_Paulo" },
      end: { dateTime: end, timeZone: "America/Sao_Paulo" },
      transparency: "opaque", visibility: "private",
    };
    const options = { headers, signal: AbortSignal.timeout(10000) };
    let result;
    if (job.action === "cancelled") {
      result = await fetch(resource + "/" + eventId, { ...options, method: "DELETE" });
      if (!result.ok && ![404, 410].includes(result.status)) return reply("Cancelamento Google pendente.", 502);
    } else {
      result = await fetch(resource + "/" + eventId, { ...options, method: "PATCH", body: JSON.stringify(event) });
      if (result.status === 404) {
        result = await fetch(resource, { ...options, method: "POST", body: JSON.stringify({ ...event, id: eventId }) });
      }
      if (!result.ok) return reply("Evento Google pendente.", 502);
    }
    await rpc("tito_google_progress", { ...progress, mailed: false });
  }
  const subject = { confirmed: "Visita confirmada", changed: "Visita remarcada", cancelled: "Visita cancelada" }[job.action];
  const mime = [
    "To: " + connection.email, "Subject: Visitas do Tito - " + subject,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "",
    subject + " para " + job.day.split("-").reverse().join("/") + " às " + hour + " (São Paulo).",
    "Visitantes: " + job.names.join(", ") + " (" + job.guests + ").",
  ].join("\r\n");
  const mail = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers, body: JSON.stringify({ raw: base64Url(mime) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!mail.ok) return reply("Envio Gmail pendente.", 502);
  await rpc("tito_google_progress", { ...progress, mailed: true });
  return reply("Aviso processado.");
}

Deno.serve(async req => {
  const url = new URL(req.url);
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (req.method === "POST" && url.pathname.endsWith("/process")) {
    const state = req.headers.get("x-tito-worker");
    if (!secret || !state || !/^[0-9a-f-]{36}$/i.test(state)) return reply("Solicitação inválida.", 403);
    try { return await processJobs(state, secret); }
    catch { return reply("Não foi possível processar o aviso.", 502); }
  }
  if (req.method !== "GET") return reply("Método indisponível.", 405);
  if (url.pathname.endsWith("/health")) return reply(secret ? "Configuração presente." : "Configuração pendente.", secret ? 200 : 503);
  if (!url.pathname.endsWith("/oauth/callback")) return reply("Página indisponível.", 404);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !/^[0-9a-f-]{36}$/i.test(state) || !code || !secret) {
    return reply("Autorização incompleta. Volte ao painel e tente novamente.", 400);
  }
  try {
    if (await rpc("tito_google_consume", { oauth_state: state }) !== true) {
      return reply("Solicitação expirada. Volte ao painel e tente novamente.", 400);
    }
    const result = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: clientId, client_secret: secret, code,
        redirect_uri: redirect, grant_type: "authorization_code",
      }),
    });
    if (!result.ok) return reply("O Google recusou a conexão. Volte ao painel e tente novamente.", 400);
    const data = await result.json();
    const scopes = String(data.scope || "").split(" ");
    if (!data.refresh_token || !scopes.includes(calendarScope) || !scopes.includes(gmailScope)) {
      return reply("Autorize Agenda e Gmail para concluir a conexão.", 400);
    }
    const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + data.access_token },
    });
    if (!profile.ok) throw new Error("Google profile unavailable");
    const user = await profile.json();
    if (user.email_verified !== true || typeof user.email !== "string") {
      return reply("Use uma conta Google com e-mail verificado.", 400);
    }
    await rpc("tito_google_save", { account_email: user.email, account_token: data.refresh_token });
    return new Response(null, { status: 303, headers: {
      Location: panel + "?google=connected", "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    } });
  } catch {
    return reply("Não foi possível concluir a conexão. Volte ao painel e tente novamente.", 502);
  }
});
