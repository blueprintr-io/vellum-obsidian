// File plumbing between core and the vault.
//
// Core saves through a File System Access handle: Save, autosave and the
// "saved" state in its chrome all follow `getActiveHandle()`. The frame
// installs a handle for the diagram's own file whose writer asks the plugin
// to save, so core's whole save path works unchanged and ends in the vault.
//
// Core's other file dialogs (Open, imports, image and PDF export, Save As)
// call the File System Access pickers. Those are replaced with vault pickers
// owned by the plugin.

import { setActiveHandle } from '@/store/persist';
import { useEditor } from '@/store/editor';
import { host } from './boot';

type WritableChunk = string | Blob | ArrayBuffer | ArrayBufferView | { type?: string; data?: unknown };

interface WritableLike {
  write(data: WritableChunk): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface HandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
  queryPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
}

let fileHandle: HandleLike | null = null;

function abortError() {
  return new DOMException('The user aborted a request.', 'AbortError');
}

/** Point core's saves at the diagram's file. */
export function bindFileHandle(name: string) {
  fileHandle = {
    kind: 'file',
    name,
    getFile: async () => new File([], name),
    async createWritable() {
      return {
        // Core hands over the YAML it serialized. The plugin serializes the
        // current state itself when it writes, so the chunk is not needed.
        write: async () => {},
        close: () => host.save(),
        abort: async () => {},
      };
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  };
  restoreFileHandle();
}

/** Undo what core's Save As does to the session: it adopts the copy's
 *  handle and name, and this view keeps editing the diagram's own file. */
export function restoreFileHandle() {
  if (!fileHandle) return;
  setActiveHandle(fileHandle as unknown as FileSystemFileHandle);
  if (useEditor.getState().filePath !== fileHandle.name) useEditor.getState().setFilePath(fileHandle.name);
}

async function toBuffer(parts: WritableChunk[]): Promise<ArrayBuffer> {
  const blobParts: BlobPart[] = [];
  for (const part of parts) {
    if (typeof part === 'string' || part instanceof Blob || part instanceof ArrayBuffer) blobParts.push(part);
    else if (ArrayBuffer.isView(part)) blobParts.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength).slice());
    else if (part && typeof part === 'object' && 'data' in part && part.data != null) blobParts.push(part.data as BlobPart);
  }
  return new Blob(blobParts).arrayBuffer();
}

function savedFileHandle(path: string, name: string, restoreAfterWrite: boolean): HandleLike {
  return {
    kind: 'file',
    name,
    getFile: async () => new File([], name),
    async createWritable() {
      const parts: WritableChunk[] = [];
      return {
        write: async (data) => { parts.push(data); },
        async close() {
          await host.writeFile(path, await toBuffer(parts));
          if (restoreAfterWrite) window.setTimeout(restoreFileHandle, 0);
        },
        abort: async () => {},
      };
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  };
}

interface PickerType { accept?: Record<string, string[]> }

function extensionsOf(types: PickerType[] | undefined): string[] {
  return (types ?? []).flatMap((type) => Object.values(type.accept ?? {}).flat()).map((ext) => ext.toLowerCase());
}

const define = (name: string, value: unknown) =>
  Object.defineProperty(window, name, { value, configurable: true, writable: true });

define('showOpenFilePicker', async (options?: { types?: PickerType[] }) => {
  const picked = await host.pickFile(extensionsOf(options?.types));
  if (!picked) throw abortError();
  const file = new File([picked.data], picked.name, { type: picked.type });
  const handle: HandleLike = {
    kind: 'file',
    name: picked.name,
    getFile: async () => file,
    // Opened files are read once and loaded; core never writes back to them
    // here because the plugin restores the diagram's own handle.
    createWritable: async () => { throw new DOMException('This file is read-only in Vellum for Obsidian.', 'NotAllowedError'); },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  };
  return [handle];
});

define('showSaveFilePicker', async (options?: { suggestedName?: string; types?: PickerType[] }) => {
  const name = options?.suggestedName || 'untitled';
  const path = await host.chooseSaveTarget(name);
  if (!path) throw abortError();
  const isDiagram = extensionsOf(options?.types).some((ext) => ext === '.vellum');
  return savedFileHandle(path, path.split('/').pop() ?? name, isDiagram);
});

// Core's download fallback, used when no picker is available.
define('__vellumSaveBlob', async (name: string, blob: Blob) => {
  const path = await host.chooseSaveTarget(name);
  if (!path) return false;
  await host.writeFile(path, await blob.arrayBuffer());
  return true;
});
