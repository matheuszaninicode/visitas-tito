import { configured, dateLabel, rpc } from "./api.js";

const groupForm = document.querySelector("#group-form");
const companionFields = document.querySelector("#companions");
const editGroup = document.querySelector("#edit-group");
let group;
const changeForm = document.querySelector("#change-form");
const booking = document.querySelector("#booking");
const availability = document.querySelector("#availability");
const feedback = document.querySelector("#feedback");
const paddockWarning = "Parece que você está querendo levar alguém que não tem acesso ao Paddock do Tito. Confira os nomes e tente de novo.";

function setFeedback(message) {
  feedback.classList.toggle("paddock-warning", message === paddockWarning);
  feedback.textContent = message;
}
const receipt = document.querySelector("#receipt");
const cancel = document.querySelector("#cancel");
let code = location.hash.slice(1);

async function loadSlots() {
  if (!configured) {
    availability.textContent = "Os horários de visita serão liberados em breve.";
    return;
  }
  try {
    const slots = await rpc("invited_visit_slots", { visitor_name: group.visitor, companion_names: group.companions });
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
  } catch (error) {
    if (["guest_not_allowed", "guest_already_booked"].includes(error.message)) {
      showGroupForm();
      setFeedback(error.message === "guest_not_allowed"
        ? paddockWarning
        : "Cada pessoa deve aparecer uma única vez no grupo.");
      return;
    }
    booking.hidden = true;
    availability.textContent = "Não foi possível carregar os horários. Volte aos dados do grupo para tentar novamente.";
  }
}

async function showReceipt(visit) {
  changeForm.hidden = true;
  booking.hidden = true;
  groupForm.hidden = true;
  editGroup.hidden = true;
  availability.textContent = "";
  receipt.hidden = false;
  document.querySelector("#details").textContent =
    `Sua visita foi confirmada para: ${dateLabel(visit.day)}, às ${visit.start_time.slice(0, 5)}.`;
  document.querySelector("#reservation-link").value = location.href;
  document.querySelector("#link-feedback").textContent = "";
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
  setFeedback("");
  const visitor = groupForm.elements.visitor.value.trim();
  const companions = [...companionFields.querySelectorAll("input")].map(input => input.value.trim());
  const keys = [visitor, ...companions].map(name => name.normalize("NFKD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  if (keys.some(key => !/^\p{L}[\p{L}\p{N}]*( \p{L}[\p{L}\p{N}]*)*$/u.test(key))) {
    setFeedback("Preencha o nome e o sobrenome de todas as pessoas.");
    return;
  }
  if (new Set(keys).size !== keys.length) {
    setFeedback("Cada pessoa deve aparecer uma única vez no grupo.");
    return;
  }
  group = { visitor, companions };
  document.querySelector("#group-summary").textContent = [visitor, ...companions].join(", ");
  groupForm.hidden = true;
  availability.textContent = "Carregando horários…";
  await loadSlots();
  editGroup.hidden = !groupForm.hidden;
});

editGroup.addEventListener("click", () => {
  setFeedback("");
  showGroupForm();
});

booking.addEventListener("submit", async event => {
  event.preventDefault();
  const button = booking.querySelector("button");
  button.disabled = true;
  setFeedback("");
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
    if (error.message === "guest_already_booked" || error.message === "invalid_guest_names" || error.message === "guest_not_allowed") {
      showGroupForm();
      setFeedback(error.message === "guest_already_booked"
        ? "Uma pessoa do grupo já tem visita reservada. Revise os nomes ou cancele a reserva anterior."
        : error.message === "guest_not_allowed"
          ? paddockWarning
          : "Confira os nomes de todas as pessoas do grupo.");
    } else if (error.message === "slot_unavailable") {
      setFeedback("Esse horário ficou indisponível. Escolha outro horário.");
      await loadSlots();
    } else {
      setFeedback("Não foi possível confirmar a visita. Tente novamente.");
    }
  } finally {
    button.disabled = false;
    editGroup.disabled = false;
  }
});

const reservationLink = document.querySelector("#reservation-link");
const linkFeedback = document.querySelector("#link-feedback");
const shareReservation = document.querySelector("#share-reservation");

document.querySelector("#copy-reservation").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(reservationLink.value);
    linkFeedback.textContent = "Link copiado!";
  } catch {
    reservationLink.focus();
    reservationLink.select();
    linkFeedback.textContent = "O link está selecionado. Use a opção Copiar do seu aparelho.";
  }
});

shareReservation.hidden = typeof navigator.share !== "function";
shareReservation.addEventListener("click", async () => {
  try {
    const text = ["#paddock-confirmation", "#arrival-instructions", "#start-engines", "#details"]
      .map(selector => document.querySelector(selector).textContent)
      .join("\n\n");
    await navigator.share({ text, url: reservationLink.value });
  } catch (error) {
    if (error.name !== "AbortError") {
      linkFeedback.textContent = "Use Copiar link para compartilhar a reserva.";
    }
  }
});

document.querySelector("#change").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setFeedback("");
  changeForm.hidden = true;
  try {
    const slots = await rpc("reservation_visit_slots", { reservation_code: code });
    const select = changeForm.elements.slot;
    select.replaceChildren(new Option("Escolha um horário", ""));
    for (const slot of slots) {
      select.add(new Option(`${dateLabel(slot.day)} · ${slot.start_time.slice(0, 5)}`, slot.slot_id));
    }
    if (slots.length) {
      changeForm.hidden = false;
      select.focus();
    } else {
      setFeedback("Nenhum outro horário está disponível no momento.");
    }
  } catch {
    setFeedback("Não foi possível carregar os horários.");
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
    setFeedback("Horário atualizado. Seu link de reserva continua o mesmo.");
  } catch {
    setFeedback("Não foi possível trocar o horário. Consulte os horários novamente.");
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
    setFeedback(cancelled ? "Visita cancelada." : "Esta reserva já está indisponível.");
    showGroupForm();
  } catch {
    setFeedback("Não foi possível cancelar. Tente novamente.");
  } finally {
    cancel.disabled = false;
  }
});

if (configured && /^[0-9a-f-]{36}$/i.test(code)) {
  try {
    const [visit] = await rpc("lookup_visit", { reservation_code: code });
    if (visit) await showReceipt(visit);
    else setFeedback("Esta reserva está indisponível.");
  } catch {
    setFeedback("Não foi possível consultar esta reserva.");
  }
}
