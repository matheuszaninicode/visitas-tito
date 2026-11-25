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

async function rpc(name: string, params: Record<string, string>) {
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

async function integrationTest(state: string, secret: string) {
  if (await rpc("tito_google_consume", { oauth_state: state }) !== true) return reply("Solicitação inválida.", 403);
  const connection = await rpc("tito_google_worker_config", {});
  if (!connection) return reply("Conta Google ainda não conectada.", 409);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId, client_secret: secret, refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) return reply("O Google recusou a renovação da autorização.", 502);
  const { access_token } = await tokenResponse.json();
  const headers = { Authorization: "Bearer " + access_token, "Content-Type": "application/json" };
  const calendarApi = "https://www.googleapis.com/calendar/v3/calendars";
  let calendarId = connection.calendar_id;
  if (!calendarId) {
    const calendar = await fetch(calendarApi, {
      method: "POST", headers,
      body: JSON.stringify({ summary: "Visitas do Tito", timeZone: "America/Sao_Paulo" }),
    });
    if (!calendar.ok) return reply("O Google Agenda recusou a criação do calendário.", 502);
    calendarId = (await calendar.json()).id;
    await rpc("tito_google_set_calendar", { target: calendarId });
  }
  const tomorrow = new Date(Date.now() + 86400000);
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(tomorrow);
  const event = await fetch(calendarApi + "/" + encodeURIComponent(calendarId) + "/events", {
    method: "POST", headers,
    body: JSON.stringify({
      summary: "TESTE - Visita do Tito", description: "Reserva fictícia para testar a integração.",
      start: { dateTime: day + "T13:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: day + "T13:30:00-03:00", timeZone: "America/Sao_Paulo" },
      transparency: "opaque",
    }),
  });
  if (!event.ok) return reply("O Google Agenda recusou o evento de teste.", 502);
  const eventData = await event.json();
  const mime = [
    "To: " + connection.email, "Subject: TESTE - Visita do Tito",
    "Content-Type: text/plain; charset=UTF-8", "",
    "Este aviso confirma o teste do calendario Visitas do Tito.",
    "Evento de teste: " + day + ", das 13h as 13h30 (horario de Sao Paulo).",
  ].join("\r\n");
  const raw = btoa(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const mail = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers, body: JSON.stringify({ raw }),
  });
  return reply(mail.ok
    ? "Evento de teste criado e e-mail aceito pelo Gmail. " + (eventData.htmlLink || "")
    : "Evento de teste criado, mas o Gmail recusou o envio. HTTP " + mail.status, mail.ok ? 200 : 502);
}

Deno.serve(async req => {
  const url = new URL(req.url);
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (req.method === "POST" && url.pathname.endsWith("/integration-test")) {
    const state = req.headers.get("x-tito-test-state");
    if (!secret || !state || !/^[0-9a-f-]{36}$/i.test(state)) return reply("Solicitação inválida.", 403);
    try { return await integrationTest(state, secret); }
    catch { return reply("Falha no teste da integração.", 502); }
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
