import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { downloadWord } from "../word-download.js";

// Inspect the generated document content, rather than mirroring the export implementation.
function documentXml(bytes) {
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameSize = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString();
    if (name !== "word/document.xml") continue;
    const size = bytes.readUInt32LE(offset + 20);
    const local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const content = bytes.subarray(start, start + size);
    return bytes.readUInt16LE(offset + 10) === 8 ? inflateRawSync(content).toString() : content.toString();
  }
  throw new Error("Word document XML was not found.");
}

test("Free Writing Word downloads contain the original prompt and requested story", async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  let blob;
  let filename;
  globalThis.document = { createElement: () => ({ click() { filename = this.download; } }) };
  URL.createObjectURL = (value) => { blob = value; return "blob:word-test"; };
  try {
    const record = { mode: "free", title: "Lantern", free: "Keep the ending hopeful.",
      story: "Lantern\n\nMira left a light in the window." };
    await downloadWord(record, [], "prompt-and-story");
    let xml = documentXml(Buffer.from(await blob.arrayBuffer()));
    assert.match(xml, /Keep the ending hopeful\./);
    assert.match(xml, /Mira left a light in the window\./);
    assert.match(filename, /prompt-and-story\.docx$/);
    await downloadWord(record, [], "choices");
    xml = documentXml(Buffer.from(await blob.arrayBuffer()));
    assert.match(xml, /Free Writing prompt/);
    assert.match(xml, /Keep the ending hopeful\./);
    assert.doesNotMatch(xml, /Questions and choices|Mira left a light/);
    assert.match(filename, /-prompt\.docx$/);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
  }
});
