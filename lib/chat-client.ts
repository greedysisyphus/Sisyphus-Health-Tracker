"use client";

/** Browser-only helpers for the chat page: photo shrinking and a send outbox that survives the app closing. */

export type OutboxItem = { id: string; text: string; photos: string[]; thumbs: string[]; createdAt: number; failed?: boolean; attempts?: number };

const PHOTO_EDGE = 1280;
const THUMB_EDGE = 320;
/** Keep each history thumbnail small: detailed photos get re-encoded at lower quality. */
const THUMB_TARGET_CHARS = 50_000;
/** Vercel rejects request bodies above ~4.5 MB; leave headroom for JSON and text. */
export const MAX_BODY_CHARS = 4_000_000;

export function newMessageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `m${Date.now().toString(36)}${Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("")}`.slice(0, 40);
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
}

function draw(source: CanvasImageSource, width: number, height: number, edge: number, quality: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** One picked photo → an upload-sized JPEG plus a small thumbnail for the chat history. */
export async function preparePhoto(file: Blob, quality = 0.74) {
  const image = await decode(file);
  try {
    let thumb = draw(image.source, image.width, image.height, THUMB_EDGE, 0.6);
    for (const [edge, q] of [[THUMB_EDGE, 0.45], [240, 0.45], [200, 0.35]] as const) {
      if (thumb.length <= THUMB_TARGET_CHARS) break;
      thumb = draw(image.source, image.width, image.height, edge, q);
    }
    return { photo: draw(image.source, image.width, image.height, PHOTO_EDGE, quality), thumb };
  } finally {
    image.close();
  }
}

/** Shrinks photos further when many large ones would not fit in one request. */
export async function fitPhotos(photos: string[]) {
  let total = photos.reduce((sum, photo) => sum + photo.length, 0);
  if (total <= MAX_BODY_CHARS) return photos;
  const shrunk: string[] = [];
  for (const photo of photos) {
    const blob = await (await fetch(photo)).blob();
    const image = await decode(blob);
    try { shrunk.push(draw(image.source, image.width, image.height, 960, 0.6)); } finally { image.close(); }
  }
  total = shrunk.reduce((sum, photo) => sum + photo.length, 0);
  if (total > MAX_BODY_CHARS) throw new Error("photos_too_large");
  return shrunk;
}

const DB_NAME = "eris-chat";
const STORE = "outbox";

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openOutbox();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const outbox = {
  async all(): Promise<OutboxItem[]> {
    try { return (await withStore<OutboxItem[]>("readonly", store => store.getAll())).sort((a, b) => a.createdAt - b.createdAt); } catch { return []; }
  },
  async put(item: OutboxItem) { try { await withStore("readwrite", store => store.put(item)); } catch { /* private mode: keep in memory only */ } },
  async remove(id: string) { try { await withStore("readwrite", store => store.delete(id)); } catch { /* ignore */ } },
};
