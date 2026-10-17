import { Directory, File, Paths } from 'expo-file-system';
import { isKeptFile } from './keptFiles';

// The files of the phone's copies of chats, of every Mac signed in to, where expo-sqlite keeps its files.
function keptFiles(): File[] {
  try {
    const dir = new Directory(Paths.document, 'SQLite');
    return dir.exists ? dir.list().filter((f): f is File => f instanceof File && isKeptFile(f.name)) : [];
  } catch {
    return [];
  }
}

// How many bytes they take.
export const keptBytes = () => keptFiles().reduce((n, f) => n + (f.size ?? 0), 0);

// Deletes them, once nothing has them open.
export function deleteKeptFiles(): void {
  for (const f of keptFiles()) {
    try {
      f.delete();
    } catch {
      // gone already
    }
  }
}
