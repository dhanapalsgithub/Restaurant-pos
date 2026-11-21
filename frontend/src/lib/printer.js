import { buildReceipt } from "./escpos";

const KEY = "pos_printer";
const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];
let ble = null;
let serial = null;
const listeners = new Set();

export const getPrinterSettings = () => ({
  mode: "dialog", width: 80, autoPrint: true, kot: true,
  ...JSON.parse(localStorage.getItem(KEY) || "{}"),
});
export const printerStatus = () => ({
  connected: !!(ble?.device?.gatt?.connected || serial),
  name: ble?.device?.name || (serial ? "Serial / COM printer" : ""),
});
const emit = () => listeners.forEach((f) => f(printerStatus()));
export const onPrinterChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const savePrinterSettings = (s) => { localStorage.setItem(KEY, JSON.stringify(s)); emit(); };

async function findChar(device) {
  const server = await device.gatt.connect();
  for (const s of await server.getPrimaryServices()) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c;
    }
  }
  throw new Error("No writable print channel found on this device");
}

export async function connectBluetooth() {
  if (!navigator.bluetooth) throw new Error("Bluetooth printing needs Chrome or Edge (Windows / Android)");
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  device.addEventListener("gattserverdisconnected", emit);
  ble = { device, char: await findChar(device) };
  emit();
  return device.name || "Bluetooth printer";
}

export async function connectSerial() {
  if (!navigator.serial) throw new Error("COM-port printing needs Chrome or Edge on desktop");
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  serial = { port, writer: port.writable.getWriter() };
  emit();
  return "Serial / COM printer";
}

export async function disconnectPrinter() {
  try { ble?.device?.gatt?.disconnect(); } catch {}
  try { serial?.writer?.releaseLock(); await serial?.port?.close(); } catch {}
  ble = null; serial = null; emit();
}

async function sendBle(bytes) {
  if (!ble.device.gatt.connected) ble.char = await findChar(ble.device);
  const c = ble.char;
  const fast = c.properties.writeWithoutResponse;
  const step = fast ? 20 : 180;
  for (let i = 0; i < bytes.length; i += step) {
    const chunk = bytes.slice(i, i + step);
    if (fast) await c.writeValueWithoutResponse(chunk); else await c.writeValue(chunk);
    if (fast) await new Promise((r) => setTimeout(r, 4));
  }
}

// Returns "bluetooth" | "serial" | "dialog"
export async function printOrder(order, store, { kot } = {}) {
  const s = getPrinterSettings();
  const bytes = buildReceipt(order, store, s.width, kot ?? s.kot);
  try {
    if (s.mode === "bluetooth" && ble) { await sendBle(bytes); return "bluetooth"; }
    if (s.mode === "serial" && serial) { await serial.writer.write(bytes); return "serial"; }
  } catch (e) {
    console.warn("Direct print failed, falling back to dialog", e);
  }
  window.print();
  return "dialog";
}
