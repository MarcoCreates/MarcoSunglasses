# marco. – Sonnenbrillen, auf dein Gesicht designt

Live: **https://marcocreates.github.io/MarcoSunglasses/**

Web-App: Look wählen, Gesicht mit der Kamera scannen, passendes Modell aus der Kollektion vorschlagen lassen, live anprobieren, Modelfoto machen und Druckdateien (STL) herunterladen. Alles läuft im Browser. Kamerabild und Fotos verlassen das Gerät nicht.

## Funktionen
- **Live-Scan:** 478 Gesichtspunkte (MediaPipe), Massstab über den Irisdurchmesser (11.7 mm). Misst Augenabstand, Gesichtsbreite, Nasenrücken, Bügellänge.
- **Gesichtsform** (Faustregel aus der Optikerpraxis) und **Empfehlung** aus der Kollektion, passend zum Look.
- **Passform** nach Optikerregeln: Rahmenbreite, Steg, Glashöhe, Bügellänge (Format z. B. 49□18-135).
- **Live-Anprobe** in echter Grösse: Gesicht verdeckt die Bügel, Licht passt sich dem Raum an.
- **3D-Ansicht** mit Hintergrund (Weiss, Grau, Fotostudio, eigene Farbe) und Licht (Studio, natürlich).
- **Fotomodus:** Modelfoto 4:5 mit freigestellter Person, 7 Hintergründe oder eigenes Foto, 5 Farblooks.
- **Druckdateien:** ZIP mit Front (mit Nut für die Gläser), zwei Bügeln und Massen.

## Die Kollektion (15 Modelle)
| Modell | Stil |
|---|---|
| Limmat | Eckig mit abgeschrägten Ecken, kräftige Front |
| Aare | Panto, zeitlos |
| Rigi | Trapez, der Klassiker |
| Säntis | Browline, betonte Oberkante |
| Lugano | Schmales, flaches Oval |
| Zug | Kreisrund |
| Pilatus | Tropfenform mit Doppelsteg |
| Bern | Weich-eckig, für jeden Tag |
| Tessin | Cat-Eye |
| Engadin | Gross und kantig |
| Davos | Sechseckig, geometrisch |
| Luzern | Schmal eckig, oben abgeschrägt |
| Basel | Schmales Achteck |
| Genf | Breit, flache Oberkante, sportlich |
| Uri | Schmal rechteckig |

Oberflächen: glänzend, matt, Havanna, Kristall. Gläser: Grau, Braun, Grün klassisch, Orange, Pfirsich, Verlauf, verspiegelt Blau/Gold/Silber. Gläser immer zertifiziert kaufen (UV400, CE, Kategorie 2–3).

## Dateien
- `index.html` Oberfläche · `app.js` Ablauf, Kamera, Anprobe, Download
- `analysis.js` Vermessung, Gesichtsform, Empfehlung, Grössen · `models.js` Kollektion
- `glasses.js` 3D-Modell der Brille · `scene.js` Licht, Hintergrund, Verdeckung · `photo.js` Fotomodus

## Technik
MediaPipe Tasks Vision 1.2.3 (Face Landmarker, Selfie-Segmentierung), three.js 0.160, JSZip. Hosting über GitHub Pages.
