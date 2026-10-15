import { promises } from './fs.ts';

export const { readFile, writeFile, appendFile, mkdir, rename, rm, unlink, stat, readdir, copyFile } =
  promises;
export default promises;
