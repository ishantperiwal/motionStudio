// Where the studio is (ROOT: the tool) and where a project's own work lives (PROJECT: its scenes/, notes/ and out/).
// PROJECT, first one set wins:
//   --project <dir>            on any command (npm run dev -- --project ../film)
//   MOTION_PROJECT=<dir>       environment variable
//   project.txt                in the studio folder, one line: the project folder (relative to the studio)
//   (none)                     the studio folder itself, as before
// A relative --project / MOTION_PROJECT is taken from where the command was typed (npm runs scripts from the studio
// folder; INIT_CWD is the folder npm was started in).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = process.env.INIT_CWD || process.cwd();
const i = process.argv.indexOf('--project');
const flag = i > 1 ? process.argv.splice(i, 2)[1] : '';   // taken out of argv, so the tools never see it
const file = path.join(ROOT, 'project.txt');
const listed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';

export const PROJECT = flag ? path.resolve(here, flag)
  : process.env.MOTION_PROJECT ? path.resolve(here, process.env.MOTION_PROJECT)
  : listed ? path.resolve(ROOT, listed)
  : ROOT;
if (!fs.existsSync(PROJECT)) { console.error(`Motion Studio: project folder not found: ${PROJECT}`); process.exit(1); }
