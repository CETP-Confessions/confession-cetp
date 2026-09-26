import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from './config.js';

export async function findOwnedDestination(ownerId) {
  const result = await getDocs(query(
    collection(db, 'destinations'),
    where('ownerId', '==', ownerId),
    limit(1),
  ));
  const found = result.docs[0];
  return found ? { id: found.id, ...found.data() } : null;
}

export async function listDestinationMessages(destinationId) {
  const result = await getDocs(query(
    collection(db, 'messages'),
    where('destinationId', '==', destinationId),
    orderBy('createdAt', 'desc'),
    limit(100),
  ));
  return result.docs.map((item) => ({ id: item.id, ...item.data() }));
}