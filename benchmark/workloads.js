const HEX_OBJECT_ID = '507f191e810c19729de860ea';

function createStandaloneBytes(index) {
  const bytes = new Uint8Array(12);

  bytes[8] = (index >>> 24) & 0xff;
  bytes[9] = (index >>> 16) & 0xff;
  bytes[10] = (index >>> 8) & 0xff;
  bytes[11] = index & 0xff;

  return bytes;
}

export const workloads = {
  'objectid-generated': {
    label: 'new ObjectId()',
    level: 'per-instance',
    unit: 'ObjectId',
    defaultCount: 1_000_000,
    allocate({ bson, count, target }) {
      const values = target ?? new Array(count);

      for (let index = 0; index < count; index += 1) {
        values[index] = new bson.ObjectId();
      }

      return values;
    }
  },

  'objectid-hex': {
    label: 'new ObjectId(hex)',
    level: 'per-instance',
    unit: 'ObjectId',
    defaultCount: 1_000_000,
    allocate({ bson, count, target }) {
      const values = target ?? new Array(count);

      for (let index = 0; index < count; index += 1) {
        values[index] = new bson.ObjectId(HEX_OBJECT_ID);
      }

      return values;
    }
  },

  'objectid-uint8array': {
    label: 'new ObjectId(uint8Array)',
    level: 'per-instance',
    unit: 'ObjectId',
    defaultCount: 1_000_000,
    allocate({ bson, count, target }) {
      const values = target ?? new Array(count);

      for (let index = 0; index < count; index += 1) {
        values[index] = new bson.ObjectId(createStandaloneBytes(index));
      }

      return values;
    }
  },

  'document-one-objectid': {
    label: 'deserialize document with one ObjectId',
    level: 'per-instance',
    unit: 'document',
    defaultCount: 1_000_000,
    prepare({ bson }) {
      return bson.serialize({
        _id: new bson.ObjectId(HEX_OBJECT_ID)
      });
    },
    allocate({ bson, count, prepared, target }) {
      const values = target ?? new Array(count);

      for (let index = 0; index < count; index += 1) {
        values[index] = bson.deserialize(prepared);
      }

      return values;
    }
  },

  'documents-three-objectids': {
    label: 'deserialize documents with three ObjectIds',
    level: 'process',
    unit: 'document',
    defaultCount: 1_000_000,
    prepare({ bson }) {
      return bson.serialize({
        _id: new bson.ObjectId('507f191e810c19729de860ea'),
        userId: new bson.ObjectId('507f1f77bcf86cd799439011'),
        postId: new bson.ObjectId('64b9523b35795e90949872a1'),
        sequence: 42,
        score: 42.25,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        label: 'objectid-memory'
      });
    },
    allocate({ bson, count, prepared, target }) {
      const values = target ?? new Array(count);

      for (let index = 0; index < count; index += 1) {
        values[index] = bson.deserialize(prepared);
      }

      return values;
    }
  }
};

export const workloadNames = Object.keys(workloads);
