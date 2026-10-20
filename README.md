# Guitart

Estudio de guitarra en el navegador: afinador, simulador de amplificador, pedalera de efectos, monitor de escucha y grabación en WAV. PWA instalable, sin backend, publicada en GitHub Pages.

**Demo:** https://juhabararj.github.io/guitart/

## Versión 0.4 (esta versión)

- Pestañas: «Afinador y audio» y «Pedalera y grabación». La grabación continúa al cambiar de pestaña
- Afinador, Entrada y Escucha en tres columnas en escritorio
- Temas: Automático, Claro, Oscuro, eBook y Dire (paleta de la portada de «Money for Nothing»)
- El afinador y el medidor se pausan con su pestaña oculta

## Fase 3

- Simulador de amplificador con 3 modelos (limpio, crunch y hi-gain): dos etapas de previo de válvula con sobremuestreo 4x, tonos, etapa de potencia y presencia
- Pantalla por convolución: 1x12, 2x12 y 4x12 generadas por código, con micrófono al centro o al borde
- Carga de IR propias en WAV, guardadas en el navegador
- Compresor reescrito en AudioWorklet: ya no añade los ~6 ms de latencia de DynamicsCompressorNode
- Protección de salida que redondea los picos en lugar de recortarlos
- Los presets de versiones anteriores reciben el amplificador y la pantalla en su posición natural

## Fase 2

- Pedalera de 7 efectos: puerta de ruido, compresor, saturación (overdrive, distorsión, fuzz), ecualizador de 3 bandas, chorus estéreo, delay y reverb
- Orden de la cadena configurable arrastrando los pedales (ratón, táctil o teclado)
- Presets: 4 de fábrica, guardar, guardar como, borrar, exportar e importar en JSON
- Grabación con efectos (estéreo) o en seco

## Fase 1

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
public/worklets/gate-processor.js     Puerta de ruido
public/worklets/comp-processor.js     Compresor sin latencia añadida
src/audio/engine.ts                    Grafo de audio (entrada, canal, ganancia, pedalera, monitor, captura)
src/audio/effects.ts                   Definición y procesado de cada pedal
src/audio/chain.ts                     Cadena de efectos y estado de la pedalera
src/presets.ts                         Presets de fábrica, guardado e importación
src/storage/irs.ts                     IR propias en IndexedDB
src/audio/pitch.ts                     Detección de tono YIN y notas
src/audio/wav.ts                       Codificador WAV 24 bits
src/storage/recordings.ts              Grabaciones en IndexedDB
src/components/                        Afinador, medidor y grabadora
```

## Hoja de ruta

1. ~~MVP: entrada, monitor, afinador, grabación~~
2. ~~Cadena de efectos reordenable y presets~~
3. ~~Simulador de amplificador y cargador de IR~~
4. **Audio y latencia.** Va antes del looper porque la latencia medida sirve para alinear las capas grabadas.
   - Adoptar la frecuencia de muestreo de la interfaz para evitar el remuestreo
   - Modo de latencia mínima (opcional)
   - Medición real de la latencia con un clic de ida y vuelta
   - Pantalla siempre encendida mientras se toca
   - Afinaciones alternativas (Drop D, medio tono abajo…) y silencio de la salida al afinar
   - Puerta de ruido autoajustable
5. **Looper y estudio.** Looper, metrónomo con cuenta atrás, caja de ritmos, multipista y re-amp (aplicar la pedalera a una toma en seco)
6. **Control.** MIDI, pedal Bluetooth, atajos de teclado y copia de seguridad completa de presets e IR
7. **Futuro.** Modelos de amplificador neuronales (NAM) en WASM
