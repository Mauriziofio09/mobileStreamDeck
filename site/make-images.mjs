// Erzeugt die Bilder der Startseiten aus lokalen Screenshots (screenshots/ ist nicht im Repo).
// Nur nötig, wenn sich die App sichtbar ändert: node site/make-images.mjs
import sharp from 'sharp';
const jobs = [
  ['screenshots/ipad-landscape-r5.png', 'deck-ipad', 1400],
  ['screenshots/lr-ipad-basic.png', 'lightroom-ipad', 1400],
  ['screenshots/bar-ipad-edit.png', 'edit-ipad', 1400],
  ['screenshots/iphone-landscape-r5.png', 'deck-iphone', 1000],
];
for (const [src, name, w] of jobs) {
  await sharp(src).resize({ width: w }).webp({ quality: 80 }).toFile(`site/src/img/${name}.webp`);
  console.log(name);
}
