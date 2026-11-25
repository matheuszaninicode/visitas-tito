import { configured, dateLabel, rpc } from "./api.js";

const groupForm = document.querySelector("#group-form");
const companionFields = document.querySelector("#companions");
const editGroup = document.querySelector("#edit-group");
let group;
let currentVisit;
const changeForm = document.querySelector("#change-form");
const booking = document.querySelector("#booking");
const availability = document.querySelector("#availability");
const feedback = document.querySelector("#feedback");
const receipt = document.querySelector("#receipt");
const cancel = document.querySelector("#cancel");
let code = location.hash.slice(1);

async function loadSlots() {
  if (!configured) {
    availability.textContent = "Os horários de visita serão liberados em breve.";
    return;
  }
  try {
    const slots = await rpc("available_slots");
    const select = booking.elements.slot;
    const previous = select.value;
    select.replaceChildren(new Option("Escolha um horário", ""));
    for (const slot of slots) {
      select.add(new Option(`${dateLabel(slot.day)} · ${slot.start_time.slice(0, 5)}`, slot.slot_id));
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    booking.hidden = !slots.length;
    if (slots.length) select.focus();
    availability.textContent = slots.length ? "" : "Nenhum horário de visita disponível no momento.";
  } catch {
    booking.hidden = true;
    availability.textContent = "Não foi possível carregar os horários. Volte aos dados do grupo para tentar novamente.";
  }
}

async function showReceipt(visit) {
  currentVisit = visit;
  changeForm.hidden = true;
  booking.hidden = true;
  groupForm.hidden = true;
  editGroup.hidden = true;
  availability.textContent = "";
  receipt.hidden = false;
  document.querySelector("#details").textContent =
    `Visita confirmada para ${dateLabel(visit.day)}, às ${visit.start_time.slice(0, 5)}. Grupo de ${visit.guests}.`;
  document.querySelector("#reservation-link").value = location.href;
}

function showGroupForm() {
  booking.hidden = true;
  editGroup.hidden = true;
  groupForm.hidden = false;
  availability.textContent = "";
  groupForm.elements.visitor.focus();
}

groupForm.elements.guests.addEventListener("change", () => {
  const count = Number(groupForm.elements.guests.value) - 1;
  while (companionFields.children.length > count) companionFields.lastElementChild.remove();
  for (let index = companionFields.children.length; index < count; index++) {
    const label = document.createElement("label");
    label.textContent = `Nome e sobrenome do acompanhante ${index + 1}`;
    const input = document.createElement("input");
    input.name = "companion";
    input.required = true;
    input.maxLength = 100;
    label.append(input);
    companionFields.append(label);
  }
});

groupForm.addEventListener("submit", async event => {
  event.preventDefault();
  feedback.textContent = "";
  const visitor = groupForm.elements.visitor.value.trim();
  const companions = [...companionFields.querySelectorAll("input")].map(input => input.value.trim());
  const keys = [visitor, ...companions].map(name => name.normalize("NFKD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  if (keys.some(key => !/^\p{L}[\p{L}\p{N}]*( \p{L}[\p{L}\p{N}]*)+$/u.test(key))) {
    feedback.textContent = "Preencha o nome e o sobrenome de todas as pessoas.";
    return;
  }
  if (new Set(keys).size !== keys.length) {
    feedback.textContent = "Cada pessoa deve aparecer uma única vez no grupo.";
    return;
  }
  group = { visitor, companions };
  document.querySelector("#group-summary").textContent = [visitor, ...companions].join(", ");
  groupForm.hidden = true;
  availability.textContent = "Carregando horários…";
  await loadSlots();
  editGroup.hidden = false;
});

editGroup.addEventListener("click", () => {
  feedback.textContent = "";
  showGroupForm();
});

booking.addEventListener("submit", async event => {
  event.preventDefault();
  const button = booking.querySelector("button");
  button.disabled = true;
  feedback.textContent = "";
  editGroup.disabled = true;
  try {
    const [visit] = await rpc("reserve_slot", {
      requested_slot: Number(booking.elements.slot.value),
      visitor_name: group.visitor,
      companion_names: group.companions
    });
    code = visit.cancel_code;
    history.replaceState(null, "", `#${code}`);
    await showReceipt(visit);
  } catch (error) {
    if (error.message === "guest_already_booked" || error.message === "invalid_guest_names") {
      showGroupForm();
      feedback.textContent = error.message === "guest_already_booked"
        ? "Uma pessoa do grupo já tem visita reservada. Revise os nomes ou cancele a reserva anterior."
        : "Confira o nome e o sobrenome de todas as pessoas do grupo.";
    } else if (error.message === "slot_unavailable") {
      feedback.textContent = "Esse horário ficou indisponível. Escolha outro horário.";
      await loadSlots();
    } else {
      feedback.textContent = "Não foi possível confirmar a visita. Tente novamente.";
    }
  } finally {
    button.disabled = false;
    editGroup.disabled = false;
  }
});

document.querySelector("#calendar").addEventListener("click", async () => {
  const start = new Date(`${currentVisit.day}T${currentVisit.start_time}-03:00`);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const stamp = date => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const calendarId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const content = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Grande Premio do Tito//Visitas//PT",
    "BEGIN:VEVENT", `UID:${calendarId}@visitas-tito`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    "SUMMARY:Visita ao Tito", "LOCATION:São Luiz Anália Franco", "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
  const href = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = "visita-ao-tito.ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
});

document.querySelector("#change").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  feedback.textContent = "";
  changeForm.hidden = true;
  try {
    const slots = await rpc("available_slots");
    const select = changeForm.elements.slot;
    select.replaceChildren(new Option("Escolha um horário", ""));
    for (const slot of slots) {
      select.add(new Option(`${dateLabel(slot.day)} · ${slot.start_time.slice(0, 5)}`, slot.slot_id));
    }
    if (slots.length) {
      changeForm.hidden = false;
      select.focus();
    } else {
      feedback.textContent = "Nenhum outro horário está disponível no momento.";
    }
  } catch {
    feedback.textContent = "Não foi possível carregar os horários.";
  } finally {
    button.disabled = false;
  }
});

changeForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = changeForm.querySelector("button");
  button.disabled = true;
  cancel.disabled = true;
  try {
    const [visit] = await rpc("reschedule_visit", {
      reservation_code: code, requested_slot: Number(changeForm.elements.slot.value)
    });
    await showReceipt(visit);
    feedback.textContent = "Horário atualizado. Seu link de reserva continua o mesmo.";
  } catch {
    feedback.textContent = "Não foi possível trocar o horário. Consulte os horários novamente.";
  } finally {
    button.disabled = false;
    cancel.disabled = false;
  }
});

cancel.addEventListener("click", async () => {
  if (!confirm("Quer cancelar esta visita e liberar o horário?")) return;
  cancel.disabled = true;
  try {
    const cancelled = await rpc("cancel_visit", { reservation_code: code });
    receipt.hidden = true;
    code = "";
    history.replaceState(null, "", location.pathname + location.search);
    feedback.textContent = cancelled ? "Visita cancelada." : "Esta reserva já está indisponível.";
    showGroupForm();
  } catch {
    feedback.textContent = "Não foi possível cancelar. Tente novamente.";
  } finally {
    cancel.disabled = false;
  }
});

if (configured && /^[0-9a-f-]{36}$/i.test(code)) {
  try {
    const [visit] = await rpc("lookup_visit", { reservation_code: code });
    if (visit) await showReceipt(visit);
    else feedback.textContent = "Esta reserva está indisponível.";
  } catch {
    feedback.textContent = "Não foi possível consultar esta reserva.";
  }
}
