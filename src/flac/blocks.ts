export enum BlockType {
  STREAMINFO,
  PADDING,
  APPLICATION,
  SEEKTABLE,
  VORBIS_COMMENT,
  CUESHEET,
  PICTURE,
}

export interface MetadataBlockHeader {
  blockType: BlockType;
  byteOffset: number;
  blockLen: number;
}

export abstract class MetadataBlock {
  static readonly MAX_SIZE = 16777215 as const;
  abstract readonly TYPE: BlockType;
  protected rawData: Uint8Array;
  protected rawView: DataView;

  constructor(rawData: Uint8Array) {
    this.rawData = rawData;
    this.rawView = new DataView(
      this.rawData.buffer,
      this.rawData.byteOffset,
      this.rawData.byteLength,
    );
    this.load();
  }

  protected abstract load(): void;

  abstract write(): Uint8Array;
}

export class StreamInfo extends MetadataBlock {
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

  constructor(data: Uint8Array) {
    super(data);
  }

  protected load() {
    this.minBlockSize = this.rawView.getUint16(0);
    this.maxBlockSize = this.rawView.getUint16(2);
    this.minFrameSize = (this.rawView.getUint16(4) << 8) +
      this.rawView.getUint8(6);
    this.maxFrameSize = (this.rawView.getUint16(7) << 8) +
      this.rawView.getUint8(9);

    // 20 bits sample rate, 3 bits channels, 5 bits bps, 36 total samples
    const sampleChannelsBpsTotal = this.rawView.getBigUint64(10);

    const sample = sampleChannelsBpsTotal >> 44n;
    const channels = (sampleChannelsBpsTotal >> 41n) & 0b111n;
    const bps = (sampleChannelsBpsTotal >> 36n) & 0b11111n;
    const total = (sampleChannelsBpsTotal) & 0xFFFFFFFFFn;

    this.sampleRate = Number(sample);
    this.nbChannels = Number(channels) + 1;
    this.bitsPerSample = Number(bps) + 1;
    this.totalSamples = total;

    this.md5 = this.rawData.subarray(18);
  }

  write() {
    const buffer = new Uint8Array(34);
    const view = new DataView(buffer.buffer);

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

    buffer.set(this.md5, 18);

    return buffer;
  }
}

export class Padding extends MetadataBlock {
  readonly TYPE = BlockType.PADDING;
  length!: number;

  constructor(data: Uint8Array) {
    super(data);
  }

  protected load() {
    this.length = this.rawData.length;
  }

  write() {
    return new Uint8Array(this.length);
  }
}

export class Application extends MetadataBlock {
  readonly TYPE = BlockType.APPLICATION;
  appId!: number;
  appData!: Uint8Array;

  constructor(data: Uint8Array) {
    super(data);
  }

  protected load() {
    this.appId = this.rawView.getUint32(0);
    this.appData = this.rawData.subarray(4);
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
  seekpoints!: Seekpoint[];

  constructor(data: Uint8Array) {
    super(data);
  }

  protected load() {
    this.seekpoints = [];
    for (let i = 0; i < this.rawData.length; i += 18) {
      const seekpoint: Seekpoint = {
        samples: this.rawView.getBigUint64(i),
        offset: this.rawView.getBigUint64(i + 8),
        targetSamples: this.rawView.getUint16(i + 16),
      };
      this.seekpoints.push(seekpoint);
    }
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
  vendorText!: string;
  tags!: Map<string, string[]>;
  constructor(data: Uint8Array) {
    super(data);
  }

  // https://xiph.org/vorbis/doc/v-comment.html
  protected load() {
    const vendorLen = this.rawView.getUint32(0, true);
    let offset = 4;
    const decoder = new TextDecoder();

    this.vendorText = decoder.decode(
      this.rawData.subarray(offset, offset + vendorLen),
    );
    offset += vendorLen;

    const userCommentLen = this.rawView.getUint32(offset, true);
    offset += 4;

    this.tags = new Map<string, string[]>();

    for (let i = 0; i < userCommentLen; i++) {
      const len = this.rawView.getUint32(offset, true);
      offset += 4;
      const text = decoder.decode(
        this.rawData.subarray(offset, offset + len),
      );

      // deno-lint-ignore prefer-const
      let [key, value] = text.split("=", 2);
      key = key.toLowerCase();

      if (this.tags.has(key)) {
        this.tags.get(key)!.push(value);
      } else {
        this.tags.set(key, [value]);
      }

      offset += len;
    }
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

    const vendorText = encoder.encode(this.vendorText);

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
  constructor(rawData: Uint8Array) {
    super(rawData);
  }

  protected load() {
    // Not implemented yet
  }

  write() {
    return this.rawData;
  }
}

export class Picture extends MetadataBlock {
  readonly TYPE = BlockType.PICTURE;
  type!: number;
  mime!: string;
  description!: string;
  width!: number;
  height!: number;
  depth!: number;
  colors!: number;
  pictureRaw!: Uint8Array;

  constructor(data: Uint8Array) {
    super(data);
  }

  protected load() {
    this.type = this.rawView.getUint32(0);
    let offset = 4;

    const mimeLen = this.rawView.getUint32(offset);
    offset += 4;

    this.mime = new TextDecoder().decode(
      this.rawData!.subarray(offset, offset + mimeLen),
    );
    offset += mimeLen;

    const descLen = this.rawView.getUint32(offset);
    offset += 4;
    this.description = new TextDecoder().decode(
      this.rawData!.subarray(offset, offset + descLen),
    );
    offset += descLen;

    this.width = this.rawView.getUint32(offset);
    offset += 4;
    this.height = this.rawView.getUint32(offset);
    offset += 4;
    this.depth = this.rawView.getUint32(offset);
    offset += 4;
    this.colors = this.rawView.getUint32(offset);
    offset += 4;
    const pictureLen = this.rawView.getUint32(offset);
    offset += 4;
    this.pictureRaw = this.rawData.subarray(
      offset,
      offset + pictureLen,
    );
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
