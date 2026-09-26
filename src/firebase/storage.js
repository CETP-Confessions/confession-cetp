import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from './config.js';

const imageLimit = Number(import.meta.env.VITE_MAX_IMAGE_MB || 10) * 1024 * 1024;
const videoLimit = Number(import.meta.env.VITE_MAX_VIDEO_MB || 50) * 1024 * 1024;

export const MEDIA_LIMITS = Object.freeze({
  image: imageLimit,
  gif: imageLimit,
  video: videoLimit,
});

const allowedTypes = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['image/gif', 'gif'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
]);

export function validateMedia(file) {
  const type = allowedTypes.get(file.type);
  if (!type) throw new Error('Choose a JPG, PNG, WebP, GIF, MP4, or WebM file.');
  if (file.size < 1) throw new Error('Choose a file that is not empty.');
  if (file.size > MEDIA_LIMITS[type]) {
    throw new Error(`${type === 'video' ? 'Video' : 'Image'} exceeds the allowed size.`);
  }
  return { type, contentType: file.type, size: file.size };
}

export function uploadReservedMedia(path, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType });
    task.on('state_changed', (snapshot) => {
      onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0);
    }, reject, () => resolve({ path, name: file.name }));
  });
}

export function getPrivateMediaUrl(path) {
  return getDownloadURL(ref(storage, path));
}