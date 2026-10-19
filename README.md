# Guitart

Estudio de guitarra en el navegador: afinador, monitor de escucha y grabación en WAV. PWA instalable, sin backend, publicada en GitHub Pages.

**Demo:** https://juhabararj.github.io/guitart/

## Fase 1 (esta versión)

- Selección de entrada (interfaz USB o micrófono) sin el procesado de voz del navegador
- Elección de canal (1, 2 o estéreo), ganancia y medidor de nivel con indicador de saturación
- Escucha en directo con volumen y selección de salida (Chrome/Edge de escritorio)
- Afinador cromático (YIN) con referencia de La ajustable
- Grabación sin pérdida a WAV de 24 bits, guardada en el navegador (IndexedDB) y descargable
- Latencia estimada en pantalla

## Desarrollo local

Requisitos: Node.js 20 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:5173/guitart/ (localhost cuenta como contexto seguro, el micrófono funciona sin HTTPS).

## Publicación

Cada push a `main` compila y publica con GitHub Actions. Solo hay que activarlo una vez:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Uso con la NUX MG-30

Conecta la MG-30 por USB antes de pulsar «Activar audio» y elígela como dispositivo de entrada.
La MG-30 envía por USB la señal ya procesada por sus propios modelos. Para que en fases siguientes
los efectos de Guitart suenen sobre la guitarra limpia, usa un preset limpio o con los bloques desactivados.
Desactiva la escucha de Guitart si ya oyes la guitarra por los auriculares de la MG-30, o sonará duplicada.

## Estructura

```
public/worklets/capture-processor.js  Captura PCM en el hilo de audio
src/audio/engine.ts                    Grafo de audio (entrada, canal, ganancia, monitor, captura)
src/audio/pitch.ts                     Detección de tono YIN y notas
src/audio/wav.ts                       Codificador WAV 24 bits
src/storage/recordings.ts              Grabaciones en IndexedDB
src/components/                        Afinador, medidor y grabadora
```

## Hoja de ruta

1. ~~MVP: entrada, monitor, afinador, grabación~~
2. Cadena de efectos reordenable y presets
3. Simulador de amplificador (AudioWorklet + WASM) y cargador de IR
4. Looper, metrónomo, caja de ritmos y multipista
5. MIDI, pedal Bluetooth y presets compartibles
