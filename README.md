# Guitart

Estudio de guitarra en el navegador: afinador, simulador de amplificador, pedalera de efectos, monitor de escucha y grabación en WAV. PWA instalable, sin backend, publicada en GitHub Pages.

**Demo:** https://juhabararj.github.io/guitart/

## Canciones, etapa 1 (esta versión, 1.3)

- Nueva pestaña «Canciones»: subir MP3, M4A, WAV, OGG o FLAC y tocar encima con tu sonido
- Onda de la canción; clic para saltar, arrastrar para crear un bucle A-B (o marcar A y B mientras suena)
- Velocidad del 40 al 125 % sin cambiar el tono
- Tempo estimado (corregible con ÷2 y ×2) y «Usar en el metrónomo», que pasa el tempo a la velocidad elegida al metrónomo, la batería y el looper
- Bucle y velocidad recordados con cada canción; atajos P (reproducir), B (volver al inicio del bucle) y L (bucle)
- La grabación en modo Mezcla incluye la canción

## Tablatura, etapas 4, 5 y 6 (1.2)

- Técnicas en la detección de notas sueltas, siguiendo la curva de tono: hammer-on (h), pull-off (p), slides (/ y \\), bends (7b9) y vibrato (~). Los ataques de púa se distinguen de los ligados por la subida de energía
- Edición de técnicas en el editor y reproducción con ellas (bend, vibrato, slide)
- Acordes nota a nota con el modelo de IA Basic Pitch (Spotify, Apache 2.0): modo «Acordes y notas (IA)». TensorFlow.js y el modelo se cargan solo al usarlo y quedan guardados para la siguiente vez
- Digitación de acordes: cuerdas distintas y al alcance de la mano, descartando notas que no caben (armónicos)
- Reconocimiento de acordes por nombre (mayor, menor, 7, maj7, m7, sus2, sus4, dim, aug y power chords), mostrados sobre la tablatura y en el texto, con diagramas en afinación estándar

## Tablatura, etapas 1 y 2 (1.1)

- Nueva pestaña «Tablatura». Botón «Pasar a TAB» en las tomas de Grabación y en las pistas del Estudio
- Transcripción de notas sueltas: ataques por flujo espectral, tono por YIN, división de ligados, tempo estimado o el del metrónomo, cuantización a semicorcheas y digitación con el menor desplazamiento de la mano (Viterbi). Respeta la afinación elegida
- Vista por compases, reproducción de la grabación o de la tablatura (cuerda pulsada sintética) con cursor
- Editor: añadir, borrar, cambiar traste, cuerda (misma nota), duración y posición, con ratón o teclado
- Tablatura en texto para copiar o descargar

## Fase 6 (1.0)

- Nueva pestaña «Ajustes» con atajos y pedales que funcionan desde cualquier pestaña: looper, ritmo, grabación, estudio, presets, pedales por posición y silencio del afinador
- Asignación por aprendizaje: pulsa Asignar y después la tecla o el interruptor MIDI
- MIDI por cable o USB (Web MIDI) y pedales Bluetooth MIDI (Web Bluetooth). Los pedales pasapáginas funcionan como teclado
- Los cambios de programa MIDI pueden elegir preset
- Aviso en pantalla cada vez que se dispara una acción
- Copia de seguridad completa en un archivo (ajustes, presets e IR, y opcionalmente tomas y proyecto del Estudio) y restauración

## Fase 5b (0.7)

- Nueva pestaña «Estudio»: multipista de 4 pistas con grabación sobre las demás, volumen, panorama, silencio y solo, cabezal movible y formas de onda
- Las tomas se alinean con la latencia medida y empiezan en el instante exacto programado
- Opción de tocar con el tempo (metrónomo y batería alineados con el proyecto) y cuenta atrás al grabar
- Re-amp: las pistas y tomas grabadas en seco se procesan con la pedalera actual sin volver a tocar; se puede volver al original
- Exportar la mezcla a WAV (se guarda también en Grabación). El proyecto se guarda en el navegador
- Nueva fuente de grabación interna «guitarra con efectos» para que el multipista no grabe el metrónomo ni las otras pistas

## Fase 5a (0.6)

- Nueva pestaña «Looper y ritmo»
- Looper con estados visibles, guía de uso integrada, capas, deshacer la última capa, parar y borrar. Compensa la latencia medida para que las capas encajen
- Sincronización con el compás: arranca tras la cuenta atrás y cierra la vuelta en compases enteros (o modo libre)
- Tempo de 40 a 240 BPM, marcar el tempo pulsando, compases de 2/4 a 7/4 y metrónomo con acento
- Caja de ritmos con sonidos generados por código, 6 ritmos (rock, pop, funk, balada, shuffle y vals), editor de casillas con golpes fuertes y suaves, y swing
- La grabación en modo Mezcla incluye looper y ritmo

## Fase 4 (0.5)

- El contexto de audio adopta la frecuencia de muestreo de la interfaz (sin remuestreo); al cambiar de entrada o de modo se reconstruye conservando todo el estado
- Modo de latencia mínima opcional
- Medición real de la latencia de ida y vuelta con clics y correlación
- Pantalla siempre encendida mientras el audio está activo, y reanudación automática del audio al volver a la app en Android
- Afinaciones alternativas (Drop D, medio tono y un tono abajo, Drop C, Open G, Open D, DADGAD) y silencio de la salida al afinar
- Puerta de ruido con ajuste automático del umbral

## Versión 0.4

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
public/worklets/probe-processor.js    Captura para medir la latencia
public/worklets/looper-processor.js   Looper con capas y compensación de latencia
src/audio/transport.ts                 Reloj de tempo: metrónomo y caja de ritmos
src/audio/drums.ts                     Sonidos de batería y patrones
src/audio/looper.ts                    Control del looper
src/audio/studio.ts                    Reproductor y mezcla del multipista
src/storage/studio.ts                  Proyecto del multipista en IndexedDB
src/storage/backup.ts                  Copia de seguridad completa
src/control/                           Acciones, asignaciones, teclado, MIDI y Bluetooth
src/tab/                               Transcripción, digitación, tablatura de texto y sonido de cuerda
src/audio/song.ts                      Reproductor de canciones (velocidad y bucle A-B)
src/storage/songs.ts                   Canciones guardadas en el navegador
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
4. ~~Audio y latencia~~
5. ~~Looper y estudio: looper, metrónomo, caja de ritmos, multipista y re-amp~~
6. ~~Control: MIDI, pedal Bluetooth, atajos de teclado y copia de seguridad~~
7. **Tablatura.** ~~Etapas 1, 2, 4, 5 y 6~~. Pendiente: etapa 3, exportar a MusicXML y guardar varias tablaturas
8. **Canciones.** ~~Etapa 1: reproductor con bucle A-B, velocidad y tempo~~. Pendiente: 2 separar instrumentos en el navegador (Demucs); 3 pistas separadas en el Estudio con silenciar y solo; 4 tablatura desde una pista separada; 5 opcionales (servidor local, transportar el tono, tablatura de batería)
9. **Futuro.** Presets por enlace, modelos de amplificador neuronales (NAM) en WASM y conservar el bucle del looper al reconstruir el motor

## Componentes de terceros

- [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify), licencia Apache 2.0. El modelo está en `public/models/basic-pitch/` junto a su licencia.
- [TensorFlow.js](https://github.com/tensorflow/tfjs), licencia Apache 2.0.
