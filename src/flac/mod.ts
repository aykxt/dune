import {
  Application,
  BlockType,
  CueSheet,
  MetadataBlock,
  Padding,
  Picture,
  Seektable,
  StreamInfo,
  VorbisComment,
} from "./blocks.ts";
import { readFileChunks } from "./utils.ts";

export class FLAC {
  private filePath!: string;
  private frameStart!: number;
  metadata!: MetadataBlock[];
  vorbis?: VorbisComment;
  info!: StreamInfo;

  private constructor(private file: Deno.File) { }

  static async open(filePath: string) {
    const file = await Deno.open(filePath, { read: true, write: true });
    const flac = new FLAC(file);
    flac.filePath = filePath;
    if (!await flac.isFlac()) throw new Error("File is not a FLAC file.");
    await flac.parseMetadata();
    return flac;
  }

  private async isFlac() {
    try {
      const buf = new Uint8Array(4);
      await this.file.read(buf);
      return new DataView(buf.buffer).getUint32(0) === 0x664C6143;
    } catch {
      return false;
    }
  }

  close() {
    this.file.close();
  }

  async save() {
    const blocks: [BlockType, Uint8Array][] = [];
    let blocksLen = 0;
    for (const block of this.metadata) {
      const blockData = block.write();
      blocksLen += blockData.length + 4;
      if (!(block.TYPE === BlockType.PADDING)) {
        blocks.push([block.TYPE, blockData]);
      }
    }

    await this.file.seek(this.frameStart, Deno.SeekMode.Start);
    const frameData = await Deno.readAll(this.file);
    await Deno.truncate(this.filePath, 4);
    await this.file.seek(4, Deno.SeekMode.Start);

    for (const [i, [type, block]] of blocks.entries()) {
      const header = new Uint8Array(4);
      const isLast = i === blocks.length - 1;
      let blockType = type;
      if (isLast) {
        blockType |= 0x80;
      }
      new DataView(header.buffer).setUint32(
        0,
        (blockType << 24) | block.length,
      );
      await Deno.writeAll(this.file, header);
      await Deno.writeAll(this.file, block);
    }

    await Deno.writeAll(this.file, frameData);
  }

  // https://xiph.org/flac/format.html
  private async parseMetadata() {
    const blocks: MetadataBlock[] = [];
    let isLast = false;
    let offset = 4;

    while (!isLast) {
      const buf = new Uint8Array(4);
      await this.file.read(buf);
      const header = new DataView(buf.buffer).getUint32(0);
      isLast = !!(header >>> 31);

      const blockType: BlockType = (header >>> 24) & 0x7F;
      const blockLen = header & 0xffffff;
      const blockData = await readFileChunks(this.file, blockLen);
      offset += 4 + blockLen;

      if (isLast) this.frameStart = offset;

      let block: MetadataBlock;

      switch (blockType) {
        case BlockType.STREAMINFO: {
          block = StreamInfo.load(blockData);
          if (this.info) {
            throw Error("FLAC file may have only one StreamInfo block.");
          }
          this.info = block as StreamInfo;
          break;
        }
        case BlockType.PADDING: {
          block = Padding.load(blockData);
          break;
        }
        case BlockType.APPLICATION: {
          block = Application.load(blockData);
          break;
        }
        case BlockType.SEEKTABLE: {
          block = Seektable.load(blockData);
          break;
        }
        case BlockType.VORBIS_COMMENT: {
          block = VorbisComment.load(blockData);
          if (this.vorbis) {
            throw Error("FLAC file may have only one VorbisComment block.");
          }
          this.vorbis = block as VorbisComment;
          break;
        }
        case BlockType.CUESHEET: {
          block = CueSheet.load(blockData);
          break;
        }
        case BlockType.PICTURE: {
          block = Picture.load(blockData);
          break;
        }
        default: {
          throw new Error("Unsupported Blocktype");
        }
      }
      blocks.push(block);
    }

    this.metadata = blocks;
  }
}
