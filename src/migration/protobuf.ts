/** The small protobuf fields used by Anki's package and note-type metadata. Unknown fields are skipped. */
export function protoFields(bytes: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const fields = new Map<number, (number | Uint8Array)[]>();
  let at = 0;
  const varint = () => {
    let value = 0,
      shift = 0;
    for (let i = 0; i < 10; i++) {
      const b = bytes[at++];
      if (b === undefined) {
        throw new Error('Incomplete Anki metadata.');
      }
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) {
        return value;
      }
      shift += 7;
    }
    throw new Error('Invalid Anki metadata.');
  };
  while (at < bytes.length) {
    const tag = varint(),
      key = Math.floor(tag / 8),
      wire = tag & 7;
    if (!key) {
      throw new Error('Invalid Anki metadata field.');
    }
    let value: number | Uint8Array;
    if (wire === 0) {
      value = varint();
    } else if (wire === 2) {
      const length = varint();
      if (length < 0 || at + length > bytes.length) {
        throw new Error('Incomplete Anki metadata.');
      }
      value = bytes.subarray(at, at + length);
      at += length;
    } else if (wire === 1 || wire === 5) {
      at += wire === 1 ? 8 : 4;
      if (at > bytes.length) {
        throw new Error('Incomplete Anki metadata.');
      }
      continue;
    } else {
      throw new Error('Unsupported Anki metadata encoding.');
    }
    if (at > bytes.length) {
      throw new Error('Incomplete Anki metadata.');
    }
    fields.set(key, [...(fields.get(key) ?? []), value]);
  }
  return fields;
}
export const protoNumber = (fields: ReturnType<typeof protoFields>, key: number) => {
  const value = fields.get(key)?.[0];
  return typeof value === 'number' ? value : 0;
};
export const protoText = (fields: ReturnType<typeof protoFields>, key: number) => {
  const value = fields.get(key)?.[0];
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : '';
};
