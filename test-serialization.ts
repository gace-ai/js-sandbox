import { serializeHost, MutableRef, Ref, deserializeHost } from 'communication-protocol';
import { encode, decode } from '@msgpack/msgpack';

console.log('Testing MutableRef serialization');
const ref = new MutableRef(42);
console.log('Is instance?', ref instanceof MutableRef);

const bytes = serializeHost(ref, (r) => null);
console.log('Bytes length:', bytes.length);

console.log('Decoding...');
const decoded = deserializeHost(bytes, (r) => null);
console.log('Decoded type:', decoded.constructor.name, decoded.value);
