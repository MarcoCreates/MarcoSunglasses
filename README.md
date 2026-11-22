# Sonnenbrillen-Designer V2

Web-App: Look wählen, Gesicht mit der Kamera scannen, Gesichtsform erkennen, perfekte Brille vorschlagen, live anprobieren und Druckdateien (STL) herunterladen.

Alles läuft im Browser. Kamerabild und Fotos verlassen das Gerät nicht.

## Dateien
- `index.html`: Oberfläche
- `app.js`: Ablauf, Kamera, Scan, Anprobe, Download
- `analysis.js`: Vermessung, Gesichtsform, Vorschlag, Grössen
- `glasses.js`: 3D-Modell der Brille

## Online stellen mit GitHub Pages (ca. 10 Minuten)
1. Auf github.com einloggen, oben rechts **+ → New repository**.
2. Name: `MarcoSunglasses`, **Public**, dann **Create repository**.
3. Auf der neuen Seite **uploading an existing file** anklicken und alle Dateien aus diesem Ordner hineinziehen. Unten **Commit changes**.
4. **Settings → Pages**: bei *Source* **Deploy from a branch**, Branch **main**, Ordner **/ (root)**, **Save**.
5. 1–2 Minuten warten. Die App läuft dann unter `https://marcocreates.github.io/MarcoSunglasses/`.
6. Auf Handy oder Mac öffnen und den Kamerazugriff erlauben.

Updates: Im Repository die geänderte Datei neu hochladen (**Add file → Upload files**). Nach 1–2 Minuten ist sie live.

## Technik
- Gesichtserkennung: MediaPipe Face Landmarker 1.2.3 (478 Punkte), Massstab über den Irisdurchmesser (11.7 mm)
- 3D: three.js 0.160, STL-Export, ZIP mit JSZip
- Gesichtsform nach Faustregeln der Optikerpraxis (Kontrastprinzip)
