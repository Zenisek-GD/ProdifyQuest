import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const clone = value => structuredClone(value);
const field = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);

function assignField(object, path, value) {
  const segments = path.split('.');
  let target = object;
  for (const segment of segments.slice(0, -1)) {
    if (!target[segment] || typeof target[segment] !== 'object') target[segment] = {};
    target = target[segment];
  }
  target[segments.at(-1)] = clone(value);
}

function mergeObject(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      target[key] = mergeObject(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    } else target[key] = clone(value);
  }
  return target;
}

class DocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this._value = clone(value);
  }
  data() { return clone(this._value); }
  get(name) { return field(this.data(), name); }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
  forEach(callback) { this.docs.forEach(callback); }
}

class Query {
  constructor(db, path, filters = [], ordering = [], maximum = Infinity) {
    Object.assign(this, { db, path, filters, ordering, maximum });
  }
  where(name, operation, value) {
    return new Query(this.db, this.path, [...this.filters, { name, operation, value }], this.ordering, this.maximum);
  }
  orderBy(name, direction = 'asc') {
    return new Query(this.db, this.path, this.filters, [...this.ordering, { name, direction }], this.maximum);
  }
  limit(maximum) { return new Query(this.db, this.path, this.filters, this.ordering, maximum); }
  async get() { return this._snapshot(this.db.data); }
  _snapshot(data) {
    const prefix = `${this.path}/`;
    let docs = [...data.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, value]) => new DocumentSnapshot(new DocumentReference(this.db, path), value));
    docs = docs.filter(doc => this.filters.every(({ name, operation, value }) => {
      const actual = name === '__name__' ? doc.id : doc.get(name);
      if (operation === '==') return isDeepStrictEqual(actual, value);
      if (operation === 'array-contains') return Array.isArray(actual) && actual.some(item => isDeepStrictEqual(item, value));
      if (operation === 'in') return value.some(item => isDeepStrictEqual(item, actual));
      if (operation === '>=') return actual >= value;
      if (operation === '>') return actual > value;
      if (operation === '<=') return actual <= value;
      if (operation === '<') return actual < value;
      throw new Error(`Unsupported fake Firestore operator: ${operation}`);
    }));
    docs = docs.filter(doc => this.ordering.every(({ name }) => doc.get(name) !== undefined));
    docs.sort((a, b) => {
      for (const { name, direction } of this.ordering) {
        const left = a.get(name), right = b.get(name);
        const compared = left < right ? -1 : left > right ? 1 : 0;
        if (compared) return direction === 'desc' ? -compared : compared;
      }
      const byId = a.id.localeCompare(b.id);
      return this.ordering.at(-1)?.direction === 'desc' ? -byId : byId;
    });
    return new QuerySnapshot(docs.slice(0, this.maximum));
  }
}

class CollectionReference extends Query {
  get id() { return this.path.split('/').at(-1); }
  doc(id = randomUUID()) {
    if (typeof id !== 'string' || !id || id.includes('/')) throw new Error('Invalid document ID');
    return new DocumentReference(this.db, `${this.path}/${id}`);
  }
  async add(value) {
    const ref = this.doc();
    await ref.set(value);
    return ref;
  }
}

class DocumentReference {
  constructor(db, path) { Object.assign(this, { db, path, id: path.split('/').at(-1) }); }
  collection(name) { return new CollectionReference(this.db, `${this.path}/${name}`); }
  async get() { return this._snapshot(this.db.data); }
  _snapshot(data) { return new DocumentSnapshot(this, data.get(this.path)); }
  async set(value, options) { write(this.db.data, 'set', this, value, options); }
  async update(value) { write(this.db.data, 'update', this, value); }
  async delete() { write(this.db.data, 'delete', this); }
}

function write(data, method, ref, value, options) {
  if (method === 'delete') return data.delete(ref.path);
  if (method === 'update') {
    if (!data.has(ref.path)) throw new Error(`Missing document: ${ref.path}`);
    const updated = clone(data.get(ref.path));
    for (const [path, entry] of Object.entries(value)) assignField(updated, path, entry);
    data.set(ref.path, updated);
  } else if (method === 'create') {
    if (data.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
    data.set(ref.path, clone(value));
  } else {
    data.set(ref.path, options?.merge ? mergeObject(clone(data.get(ref.path) || {}), value) : clone(value));
  }
}

/** Local test double: serial transactions, atomic rollback, and Firestore read/write ordering. */
export class FakeFirestore {
  constructor(initial = {}) {
    this.data = new Map([...(initial instanceof Map ? initial : Object.entries(initial))]
      .map(([path, value]) => [path, clone(value)]));
    this._transactionTail = Promise.resolve();
  }
  collection(path) { return new CollectionReference(this, path); }
  doc(path) { return new DocumentReference(this, path); }
  seed(path, value) { this.data.set(path, clone(value)); return this; }
  async getAll(...refs) { return Promise.all(refs.map(ref => ref.get())); }
  runTransaction(callback) {
    const result = this._transactionTail.then(async () => {
      const working = new Map([...this.data].map(([path, value]) => [path, clone(value)]));
      let hasWritten = false;
      const transaction = {
        async get(ref) {
          if (hasWritten) throw new Error('Firestore transactions require all reads before writes');
          return ref._snapshot(working);
        },
        async getAll(...refs) { return Promise.all(refs.map(ref => transaction.get(ref))); },
      };
      for (const method of ['set', 'update', 'delete', 'create']) {
        transaction[method] = (ref, value, options) => {
          hasWritten = true;
          write(working, method, ref, value, options);
          return transaction;
        };
      }
      const value = await callback(transaction);
      this.data.clear();
      for (const entry of working) this.data.set(...entry);
      return value;
    });
    this._transactionTail = result.catch(() => {});
    return result;
  }
}
