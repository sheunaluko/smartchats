/**
 * OPFS-backed storage for voice memo audio blobs.
 *
 * Audio lives on the device only; transcripts + metadata go to the cloud DB
 * via a `logs` row with `category='voice_memo'`. Playback on a different
 * device returns null because the blob isn't there.
 */

const DIR_NAME = 'voice_memos';

async function getDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(DIR_NAME, { create: true });
}

export async function saveBlob(id: string, blob: Blob): Promise<void> {
    const dir = await getDir();
    const fh = await dir.getFileHandle(id, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(blob);
    await w.close();
}

export async function readBlob(id: string): Promise<Blob | null> {
    try {
        const dir = await getDir();
        const fh = await dir.getFileHandle(id);
        return await fh.getFile();
    } catch {
        return null;
    }
}

export async function deleteBlob(id: string): Promise<void> {
    try {
        const dir = await getDir();
        await dir.removeEntry(id);
    } catch {
        // Already gone — fine.
    }
}

const DEVICE_ID_KEY = 'smartchats_device_id';

export function getDeviceId(): string {
    let v = localStorage.getItem(DEVICE_ID_KEY);
    if (!v) {
        v = crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, v);
    }
    return v;
}
