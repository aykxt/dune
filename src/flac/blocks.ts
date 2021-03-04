export enum BlockType {
  STREAMINFO,
  PADDING,
  APPLICATION,
  SEEKTABLE,
  VORBIS_COMMENT,
  CUESHEET,
  PICTURE,
}

export abstract class MetadataBlock {
  static readonly MAX_SIZE = 16777215 as const;
  abstract readonly TYPE: BlockType;

  abstract write(): Uint8Array;
}

interface StreamInfoI {
  minBlockSize: number;
  maxBlockSize: number;
  minFrameSize: number;
  maxFrameSize: number;
  sampleRate: number;
  nbChannels: number;
  bitsPerSample: number;
  totalSamples: bigint;
  md5: Uint8Array;
}

export class StreamInfo extends MetadataBlock implements StreamInfoI {
  readonly TYPE = BlockType.STREAMINFO;
  minBlockSize!: number;
  maxBlockSize!: number;
  minFrameSize!: number;
  maxFrameSize!: number;
  sampleRate!: number;
  nbChannels!: number;
  bitsPerSample!: number;
  totalSamples!: bigint;
  md5!: Uint8Array;

  constructor(data: StreamInfoI) {
    super();
    Object.assign(this, data);
  }

  static load(data: Uint8Array): StreamInfo {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const minBlockSize = view.getUint16(0);
    const maxBlockSize = view.getUint16(2);
    const minFrameSize = (view.getUint16(4) << 8) + view.getUint8(6);
    const maxFrameSize = (view.getUint16(7) << 8) + view.getUint8(9);

    // 20 bits sample rate, 3 bits channels, 5 bits bps, 36 bits total samples
    const sampleChannelsBpsTotal = view.getBigUint64(10);

    const sampleRate = Number(sampleChannelsBpsTotal >> 44n);
    const nbChannels = Number((sampleChannelsBpsTotal >> 41n) & 7n) + 1;
    const bitsPerSample = Number((sampleChannelsBpsTotal >> 36n) & 31n) + 1;
    const totalSamples = (sampleChannelsBpsTotal) & 0xFFFFFFFFFn;
    const md5 = data.subarray(18);

    return new StreamInfo({
      minBlockSize,
      maxBlockSize,
      minFrameSize,
      maxFrameSize,
      sampleRate,
      nbChannels,
      bitsPerSample,
      totalSamples,
      md5,
    });
  }

  write() {
    const data = new Uint8Array(34);
    const view = new DataView(data.buffer);

    view.setUint16(0, this.minBlockSize);
    view.setUint16(2, this.maxBlockSize);

    view.setUint16(4, this.minFrameSize >>> 8);
    view.setUint8(6, this.minFrameSize & 0xFF);

    view.setUint16(7, (this.maxFrameSize >>> 8) & 0xFF);
    view.setUint8(9, this.maxFrameSize & 0xFF);

    const sampleChannelsBpsTotal =
      ((BigInt(this.sampleRate) & 0xFFFFFn) << 44n) |
      ((BigInt(this.nbChannels - 1) & 0b111n) << 41n) |
      ((BigInt(this.bitsPerSample - 1) & 0b11111n) << 36n) |
      (this.totalSamples & 0xFFFFFFFFFn);

    view.setBigUint64(10, sampleChannelsBpsTotal);

    data.set(this.md5, 18);

    return data;
  }
}

export class Padding extends MetadataBlock {
  readonly TYPE = BlockType.PADDING;

  constructor(public length: number) {
    super();
  }

  static load(data: Uint8Array): Padding {
    return new Padding(data.length);
  }

  write() {
    return new Uint8Array(this.length);
  }
}

interface ApplicationI {
  appId: number;
  appData: Uint8Array;
}

export class Application extends MetadataBlock implements ApplicationI {
  readonly TYPE = BlockType.APPLICATION;
  appId!: number;
  appData!: Uint8Array;

  constructor(data: ApplicationI) {
    super();
    this.appId = data.appId;
    this.appData = data.appData;
  }

  static load(data: Uint8Array): Application {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const appId = view.getUint32(0);
    const appData = data.subarray(4);

    return new Application({
      appId,
      appData,
    });
  }

  write() {
    const buffer = new Uint8Array(4 + this.appData.length);
    new DataView(buffer.buffer).setUint32(0, this.appId);
    buffer.set(this.appData, 4);
    return buffer;
  }
}

interface Seekpoint {
  samples: bigint;
  offset: bigint;
  targetSamples: number;
}

export class Seektable extends MetadataBlock {
  readonly TYPE = BlockType.SEEKTABLE;

  constructor(public seekpoints: Seekpoint[]) {
    super();
  }

  static load(data: Uint8Array) {
    const seekpoints: Seekpoint[] = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    for (let i = 0; i < data.length; i += 18) {
      const seekpoint: Seekpoint = {
        samples: view.getBigUint64(i),
        offset: view.getBigUint64(i + 8),
        targetSamples: view.getUint16(i + 16),
      };
      seekpoints.push(seekpoint);
    }

    return new Seektable(seekpoints);
  }

  write() {
    const buf = new Uint8Array(18 * this.seekpoints.length);
    const view = new DataView(buf.buffer);

    for (const [i, seekpoint] of this.seekpoints.entries()) {
      view.setBigUint64(i * 18, seekpoint.samples);
      view.setBigUint64(i * 18 + 8, seekpoint.offset);
      view.setUint16(i * 18 + 16, seekpoint.targetSamples);
    }

    return buf;
  }
}

export class VorbisComment extends MetadataBlock {
  readonly TYPE = BlockType.VORBIS_COMMENT;

  constructor(public vendor: string, public tags: Map<string, string[]>) {
    super();
  }

  static load(data: Uint8Array): VorbisComment {
    // https://xiph.org/vorbis/doc/v-comment.html
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const vendorLen = view.getUint32(0, true);
    let offset = 4;
    const decoder = new TextDecoder();

    const vendor = decoder.decode(
      data.subarray(offset, offset + vendorLen),
    );
    offset += vendorLen;

    const userCommentLen = view.getUint32(offset, true);
    offset += 4;

    const tags = new Map<string, string[]>();

    for (let i = 0; i < userCommentLen; i++) {
      const len = view.getUint32(offset, true);
      offset += 4;
      const text = decoder.decode(
        data.subarray(offset, offset + len),
      );

      const comment = text.split("=", 2);
      const key = comment[0].toLowerCase();
      const value = comment[1];

      if (tags.has(key)) {
        tags.get(key)!.push(value);
      } else {
        tags.set(key, [value]);
      }

      offset += len;
    }

    return new VorbisComment(vendor, tags);
  }

  write() {
    const encoder = new TextEncoder();
    const entries: Uint8Array[] = [];
    let entriesDataLen = 0;
    for (const [key, entry] of this.tags) {
      for (const value of entry) {
        const bytes = encoder.encode(key + "=" + value);
        entriesDataLen += bytes.length;
        entries.push(bytes);
      }
    }

    const vendorText = encoder.encode(this.vendor);

    const blockData = new Uint8Array(
      4 + vendorText.length + 4 + (entries.length * 4) + entriesDataLen,
    );
    const blockView = new DataView(blockData.buffer);

    blockView.setUint32(0, vendorText.length, true);
    blockData.set(vendorText, 4);

    let offset = 4 + vendorText.length;
    blockView.setUint32(offset, entries.length, true);

    offset += 4;
    for (const entryData of entries) {
      blockView.setUint32(offset, entryData.length, true);
      offset += 4;
      blockData.set(entryData, offset);
      offset += entryData.length;
    }

    return blockData;
  }
}

export class CueSheet extends MetadataBlock {
  readonly TYPE = BlockType.CUESHEET;
  constructor(public rawData: Uint8Array) {
    super();
  }

  static load(data: Uint8Array): CueSheet {
    // Not implemented yet
    return new CueSheet(data);
  }

  write() {
    return this.rawData;
  }
}

interface PictureI {
  type: number;
  mime: string;
  description: string;
  width: number;
  height: number;
  depth: number;
  colors: number;
  pictureRaw: Uint8Array;
}

export class Picture extends MetadataBlock implements PictureI {
  readonly TYPE = BlockType.PICTURE;
  type!: number;
  mime!: string;
  description!: string;
  width!: number;
  height!: number;
  depth!: number;
  colors!: number;
  pictureRaw!: Uint8Array;

  constructor(data: PictureI) {
    super();
    Object.assign(this, data);
  }

  static load(data: Uint8Array): Picture {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const type = view.getUint32(0);
    let offset = 4;

    const mimeLen = view.getUint32(offset);
    offset += 4;

    const mime = new TextDecoder().decode(
      data.subarray(offset, offset + mimeLen),
    );
    offset += mimeLen;

    const descLen = view.getUint32(offset);
    offset += 4;
    const description = new TextDecoder().decode(
      data.subarray(offset, offset + descLen),
    );
    offset += descLen;

    const width = view.getUint32(offset);
    offset += 4;
    const height = view.getUint32(offset);
    offset += 4;
    const depth = view.getUint32(offset);
    offset += 4;
    const colors = view.getUint32(offset);
    offset += 4;
    const pictureLen = view.getUint32(offset);
    offset += 4;
    const pictureRaw = data.subarray(offset, offset + pictureLen);

    return new Picture({
      type,
      mime,
      description,
      width,
      height,
      depth,
      colors,
      pictureRaw,
    });
  }

  write() {
    const encoder = new TextEncoder();
    const mime = encoder.encode(this.mime);
    const description = encoder.encode(this.description);
    const data = new Uint8Array(
      32 + mime.length + description.length + this.pictureRaw.length,
    );
    const view = new DataView(data.buffer);

    view.setUint32(0, this.type);
    let offset = 4;
    view.setUint32(4, mime.length);
    offset += 4;
    data.set(mime, offset);
    offset += mime.length;
    view.setUint32(offset, description.length);
    offset += 4;
    data.set(description, offset);
    offset += description.length;
    view.setUint32(offset, this.width);
    offset += 4;
    view.setUint32(offset, this.height);
    offset += 4;
    view.setUint32(offset, this.depth);
    offset += 4;
    view.setUint32(offset, this.colors);
    offset += 4;
    view.setUint32(offset, this.pictureRaw.length);
    offset += 4;
    data.set(this.pictureRaw, offset);
    return data;
  }
}
