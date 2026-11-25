// lib/printer.js - Bluetooth ESC/POS Printing utility for 80mm/58mm thermal printers
let bluetoothDevice = null;
let bluetoothCharacteristic = null;
let printerSettings = JSON.parse(localStorage.getItem("pos_printer_cfg") || '{"mode":"bluetooth","width":80,"autoPrint":false,"kot":true}');

export function getPrinterSettings() {
  return printerSettings;
}

export function savePrinterSettings(cfg) {
  printerSettings = cfg;
  localStorage.setItem("pos_printer_cfg", JSON.stringify(cfg));
}

let statusListeners = [];
export function onPrinterChange(cb) {
  statusListeners.push(cb);
  cb(printerStatus());
}
export function printerStatus() {
  return { connected: !!bluetoothCharacteristic, name: bluetoothDevice?.name || "" };
}
function notifyStatus() {
  const st = printerStatus();
  statusListeners.forEach(cb => cb(st));
}

export async function connectBluetooth() {
  try {
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455']
    });
    
    const server = await bluetoothDevice.gatt.connect();
    let service;
    const services = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fw', '49535343-fe7d-4ae5-8fa9-9fafd205e455'];
    for (const sUuid of services) {
      try {
        service = await server.getPrimaryService(sUuid);
        if (service) break;
      } catch (e) { /* try next */ }
    }
    if (!service) {
      const primaryServices = await server.getPrimaryServices();
      service = primaryServices[0];
    }
    
    const characteristics = await service.getCharacteristics();
    bluetoothCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse) || characteristics[0];
    
    printerSettings.mode = "bluetooth";
    savePrinterSettings(printerSettings);

    notifyStatus();
    return bluetoothDevice.name || "Bluetooth Printer";
  } catch (err) {
    console.error("Bluetooth connection error:", err);
    throw err;
  }
}

// Dummy fallback for serial to prevent any crash or unhandled errors
export async function connectSerial() {
  return await connectBluetooth();
}

export function disconnectPrinter() {
  if (bluetoothDevice && bluetoothDevice.gatt.connected) {
    bluetoothDevice.gatt.disconnect();
  }
  bluetoothDevice = null;
  bluetoothCharacteristic = null;
  notifyStatus();
}

export async function printOrder(order, store, options = {}) {
  const mode = printerSettings.mode;

  const width = printerSettings.width || 80;
  const lineLen = width === 58 ? 32 : 48;
  
  let raw = "\x1B\x40"; 
  raw += "\x1B\x61\x01"; 
  raw += `\x1B\x21\x20${store?.store_name || "RESTAURANT"}\x1B\x21\x00\n`;
  if (store?.address) raw += `${store.address}\n`;
  if (store?.phone) raw += `Phone: ${store.phone}\n`;
  if (store?.gst_number) raw += `GSTIN: ${store.gst_number}\n`;
  raw += "-".repeat(lineLen) + "\n";
  
  raw += `\x1B\x61\x00`; 
  raw += `Bill No : ${order.order_number}\n`;
  raw += `Type    : ${order.order_type} ${order.table_no ? "· Table: " + order.table_no : ""}\n`;
  raw += `Date    : ${new Date(order.created_at || Date.now()).toLocaleString()}\n`;
  raw += "-".repeat(lineLen) + "\n";
  raw += "Item Name               Qty      Price      Total\n";
  raw += "-".repeat(lineLen) + "\n";

  if (order.items && Array.isArray(order.items)) {
    order.items.forEach(i => {
      const name = (i.name || "").padEnd(20).slice(0, 20);
      const qty = String(i.qty || 1).padStart(3);
      const price = Number(i.price || 0).toFixed(2).padStart(8);
      const tot = ((i.price || 0) * (i.qty || 1)).toFixed(2).padStart(9);
      raw += `${name} ${qty} ${price} ${tot}\n`;
      if (i.notes) raw += `  -> Note: ${i.notes}\n`;
    });
  }

  raw += "-".repeat(lineLen) + "\n";
  raw += `Subtotal : Rs.${Number(order.subtotal || 0).toFixed(2)}\n`;
  if (order.tax > 0) raw += `GST Tax  : Rs.${Number(order.tax).toFixed(2)}\n`;
  if (order.discount > 0) raw += `Discount : -Rs.${Number(order.discount).toFixed(2)}\n`;
  raw += `\x1B\x21\x10TOTAL    : Rs.${Number(order.total || 0).toFixed(2)}\x1B\x21\x00\n`;
  raw += `Payment  : ${order.payment_mode || "Cash"}\n`;
  raw += "-".repeat(lineLen) + "\n";
  raw += "\x1B\x61\x01"; 
  raw += "நன்றி! மீண்டும் வருக!\n";
  raw += "** Thank You · Visit Again **\n\n\n\x1B\x69";

  if (mode === "bluetooth" && bluetoothCharacteristic) {
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(raw);
      for (let i = 0; i < bytes.length; i += 512) {
        const chunk = bytes.slice(i, i + 512);
        await bluetoothCharacteristic.writeValue(chunk);
      }
      return "bluetooth";
    } catch (e) {
      console.error("Bluetooth write failed:", e);
    }
  }

  window.print();
  return "dialog";
}