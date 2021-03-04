import { assertEquals } from "https://deno.land/std@0.89.0/testing/asserts.ts";
import {
  Application,
  CueSheet,
  Padding,
  Picture,
  Seektable,
  StreamInfo,
  VorbisComment,
} from "../../src/flac/blocks.ts";

Deno.test("FLAC: StreamInfo", () => {
  const info = new StreamInfo({
    minBlockSize: 4096,
    maxBlockSize: 4096,
    minFrameSize: 1350,
    maxFrameSize: 7228,
    sampleRate: 44100,
    nbChannels: 2,
    bitsPerSample: 24,
    totalSamples: 5027400n,
    md5: new Uint8Array(16),
  });

  assertEquals(StreamInfo.load(info.write()), info);
});

Deno.test("FLAC: Padding", () => {
  const padding = new Padding(24);

  assertEquals(Padding.load(padding.write()), padding);
});

Deno.test("FLAC: Application", () => {
  const app = new Application({
    appId: 123456,
    appData: new Uint8Array(20),
  });

  assertEquals(Application.load(app.write()), app);
});

Deno.test("FLAC: Seektable", () => {
  const seek = new Seektable(
    [{ samples: 1234567756n, targetSamples: 20, offset: 15665567n }],
  );

  assertEquals(Seektable.load(seek.write()), seek);
});

Deno.test("FLAC: VorbisComment", () => {
  const tags = new Map();
  tags.set("title", ["hello world"]);

  const vc = new VorbisComment("reference libFLAC 1.2.1 20070917", tags);

  assertEquals(VorbisComment.load(vc.write()), vc);
});

Deno.test("FLAC: Cuesheet", () => {
  const cuesheet = new CueSheet(new Uint8Array(24));

  assertEquals(CueSheet.load(cuesheet.write()), cuesheet);
});

Deno.test("FLAC: Picture", () => {
  const picture = new Picture({
    type: 3,
    mime: "image/jpeg",
    description: "Sample",
    width: 100,
    height: 100,
    depth: 32,
    colors: 72,
    pictureRaw: new Uint8Array(24),
  });

  assertEquals(Picture.load(picture.write()), picture);
});
