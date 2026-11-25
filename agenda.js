import { configured, dateLabel, rpc, signIn } from "./api.js";

const login = document.querySelector("#login");
const panel = document.querySelector("#panel");
const status = document.querySelector("#status");
const schedule = document.querySelector("#schedule");
const dayForm = document.querySelector("#day-form");
let token = sessionStorage.getItem("tito-family-token");

function clearSession() {
  token = null;
  sessionStorage.removeItem("tito-family-token");
  schedule.replaceChildren();
  panel.hidden = true;
  login.hidden = false;
}

async function refresh() {
  if (!token) return;
  const activeToken = token;
  try {
    const visits = await rpc("family_schedule", {}, activeToken);
    if (token !== activeToken) return;
    const items = visits.map(visit => {
      const item = document.createElement("li");
      const names = [visit.visitor, ...(visit.companions || [])].join(", ");
      item.textContent = `${dateLabel(visit.day)} · ${visit.start_time.slice(0, 5)} · ${names} (${visit.guests})`;
      return item;
    });
    if (!items.length) {
      const item = document.createElement("li");
      item.textContent = "Ainda não há visitas reservadas.";
      items.push(item);
    }
    schedule.replaceChildren(...items);
    panel.hidden = false;
    login.hidden = true;
  } catch (error) {
    if (token !== activeToken) return;
    if ([401, 403].includes(error.status)) {
      clearSession();
      status.textContent = "Entre com uma conta autorizada para consultar a agenda.";
    } else {
      status.textContent = "Não foi possível atualizar o cronograma.";
    }
  }
}

async function setDay(isOpen) {
  const day = dayForm.elements.day.value;
  if (!dayForm.reportValidity()) return;
  try {
    await rpc("manage_day", { visit_day: day, open_for_booking: isOpen }, token);
    status.textContent = isOpen
      ? `Horários liberados para ${dateLabel(day)}.`
      : `Novas reservas pausadas para ${dateLabel(day)}. As visitas confirmadas seguem na agenda.`;
    await refresh();
  } catch {
    status.textContent = "Não foi possível atualizar a data. Confira se ela é válida e se você está conectado.";
  }
}

login.addEventListener("submit", async event => {
  event.preventDefault();
  const button = login.querySelector("button");
  button.disabled = true;
  try {
    const session = await signIn(login.elements.email.value, login.elements.password.value);
    token = session.access_token;
    sessionStorage.setItem("tito-family-token", token);
    login.reset();
    status.textContent = "";
    await refresh();
  } catch {
    status.textContent = "Não foi possível entrar. Confira o e-mail e a senha.";
  } finally {
    button.disabled = false;
  }
});
dayForm.addEventListener("submit", event => {
  event.preventDefault();
  void setDay(true);
});
document.querySelector("#close-day").addEventListener("click", () => setDay(false));
document.querySelector("#refresh").addEventListener("click", refresh);
document.querySelector("#logout").addEventListener("click", () => {
  clearSession();
  status.textContent = "";
});
document.querySelector("#connect-google").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const state = await rpc("tito_google_begin", {}, token);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: "712915809457-mltu2vl3ahr96dq82o8b35vfjo9ujfoq.apps.googleusercontent.com",
      redirect_uri: "https://hlhlwkxobecoelnvylvy.supabase.co/functions/v1/tito-google/oauth/callback",
      response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent select_account",
      state
    });
    location.assign(url.href);
  } catch {
    status.textContent = "Não foi possível abrir a conexão com o Google. Entre novamente e tente outra vez.";
    button.disabled = false;
  }
});
if (new URLSearchParams(location.search).get("google") === "connected") {
  status.textContent = "Conta Google conectada. O envio automático ainda depende da ativação da integração.";
  history.replaceState(null, "", location.pathname);
}
if (configured) {
  await refresh();
  setInterval(refresh, 15000);
} else {
  login.hidden = true;
  status.textContent = "A agenda ainda está sendo configurada.";
}
