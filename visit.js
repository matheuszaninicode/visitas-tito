import { configured, dateLabel, rpc } from "./api.js";

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
    booking.hidden = !slots.length || !receipt.hidden;
    availability.textContent = slots.length ? "" : "Nenhum horário de visita disponível no momento.";
  } catch {
    booking.hidden = true;
    availability.textContent = "Não foi possível carregar os horários. Recarregue a página para tentar novamente.";
  }
}

async function showReceipt(visit) {
  booking.hidden = true;
  receipt.hidden = false;
  document.querySelector("#details").textContent =
    `Visita confirmada para ${dateLabel(visit.day)}, às ${visit.start_time.slice(0, 5)}. Grupo de ${visit.guests}.`;
  document.querySelector("#reservation-link").value = location.href;
}

booking.addEventListener("submit", async event => {
  event.preventDefault();
  const button = booking.querySelector("button");
  button.disabled = true;
  feedback.textContent = "";
  try {
    const [visit] = await rpc("reserve_slot", {
      requested_slot: Number(booking.elements.slot.value),
      visitor_name: booking.elements.visitor.value.trim(),
      group_size: Number(booking.elements.guests.value)
    });
    code = visit.cancel_code;
    history.replaceState(null, "", `#${code}`);
    await showReceipt(visit);
  } catch (error) {
    feedback.textContent = error.message === "slot_unavailable"
      ? "Esse horário ficou indisponível. Escolha outro horário."
      : "Não foi possível confirmar a visita. Confira os dados e tente novamente.";
    await loadSlots();
  } finally {
    button.disabled = false;
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
    await loadSlots();
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
await loadSlots();
