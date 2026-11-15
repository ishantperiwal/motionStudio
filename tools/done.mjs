// npm run done -- <scene> <note id> "<what changed, where to look>"
// Finishes a note in one step: its To check item is written (frame, span, region and attachments carried over), then
// the note and its crop are deleted. Agents use this instead of editing notes/ by hand.
import { finishNote } from '../server/done.mjs';

const [scene, id, ...words] = process.argv.slice(2);
if (!scene || !id || !words.length) {
  console.error('usage: npm run done -- <scene> <note id> "<what changed, where to look>"');
  process.exit(1);
}
try {
  const item = finishNote(scene, id.replace(/\.(json|png)$/, ''), words.join(' '));
  console.log(`Done · ${scene}/${item.id} → To check (${item.range ? `f${item.range[0]}–${item.range[1]}` : `f${item.frame}`})`);
} catch (e) {
  console.error(`Not done: ${e.message}`);
  process.exit(1);
}
