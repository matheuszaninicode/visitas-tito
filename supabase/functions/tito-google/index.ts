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

Deno.serve(async req => {
  const url = new URL(req.url);
  if (req.method !== "GET") return reply("Método indisponível.", 405);
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
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
