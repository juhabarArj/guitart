// Entradas de control: MIDI por cable/USB (Web MIDI) y pedales Bluetooth MIDI (Web Bluetooth).

export interface ControlEvent {
  /** "cc:64", "note:60" o "pc:3" */
  key: string;
  value: number;
  /** true en la pulsación (nota activada, CC que sube de 64, cambio de programa) */
  trigger: boolean;
  device: string;
}

type Listener = (e: ControlEvent) => void;

const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3';

const dataLength = (status: number) => {
  const t = status & 0xf0;
  return t === 0xc0 || t === 0xd0 ? 1 : t >= 0x80 && t <= 0xe0 ? 2 : 0;
};

class ControlInputs {
  private listeners = new Set<Listener>();
  private midi: MIDIAccess | null = null;
  private ccState = new Map<string, number>();
  private ble: { name: string; device: BluetoothDevice }[] = [];
  onDevicesChange: (() => void) | null = null;

  get midiSupported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get bleSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  get midiEnabled() {
    return this.midi != null;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  devices(): string[] {
    const midi = this.midi ? [...this.midi.inputs.values()].map((i) => i.name || 'Entrada MIDI') : [];
    return [...midi, ...this.ble.map((b) => `${b.name} (Bluetooth)`)];
  }

  async enableMidi() {
    if (this.midi || !this.midiSupported) return;
    this.midi = await navigator.requestMIDIAccess({ sysex: false });
    const attach = () => {
      this.midi!.inputs.forEach((input) => {
        input.onmidimessage = (e) => e.data && this.handle(Array.from(e.data), input.name || 'MIDI');
      });
      this.onDevicesChange?.();
    };
    this.midi.onstatechange = attach;
    attach();
  }

  /** Conecta un pedal Bluetooth que hable BLE MIDI (el navegador muestra la lista de dispositivos). */
  async connectBle(): Promise<string> {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    const ch = await service.getCharacteristic(BLE_MIDI_CHAR);
    await ch.startNotifications();
    const name = device.name || 'Pedal Bluetooth';
    ch.addEventListener('characteristicvaluechanged', () => {
      if (ch.value) this.parseBle(new Uint8Array(ch.value.buffer), name);
    });
    device.addEventListener('gattserverdisconnected', () => {
      this.ble = this.ble.filter((b) => b.device !== device);
      this.onDevicesChange?.();
    });
    this.ble.push({ name, device });
    this.onDevicesChange?.();
    return name;
  }

  /** Paquete BLE MIDI: cabecera, y luego [marca de tiempo] [estado] datos…, con estado implícito. */
  private parseBle(data: Uint8Array, device: string) {
    let i = 1;
    let status = 0;
    while (i < data.length) {
      if (data[i] & 0x80) {
        i++; // marca de tiempo
        if (i < data.length && data[i] & 0x80) status = data[i++];
      }
      const n = dataLength(status);
      if (!n || data[i] === 0xf0) break; // sysex u otros: se ignoran
      if (i + n > data.length) break;
      this.handle([status, ...data.slice(i, i + n)], device);
      i += n;
    }
  }

  private emit(e: ControlEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private handle(bytes: number[], device: string) {
    const [status, d1 = 0, d2 = 0] = bytes;
    const type = status & 0xf0;
    if (type === 0x90 && d2 > 0) this.emit({ key: `note:${d1}`, value: d2, trigger: true, device });
    else if (type === 0xc0) this.emit({ key: `pc:${d1}`, value: d1, trigger: true, device });
    else if (type === 0xb0) {
      // Los pedales envían 127 al pisar y 0 al soltar: se dispara solo al pasar de <64 a ≥64
      const id = `${device}:${d1}`;
      const prev = this.ccState.get(id) ?? 0;
      this.ccState.set(id, d2);
      this.emit({ key: `cc:${d1}`, value: d2, trigger: prev < 64 && d2 >= 64, device });
    }
  }
}

export const controlInputs = new ControlInputs();
