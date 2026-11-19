/* Native, offline ZIP and PDF writers. The embedded typeface is licensed separately. */
(() => {
  "use strict";
  const utf8 = new TextEncoder();
  const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
    let value = byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
  });

  async function crc32(blob) {
    let crc = 0xffffffff;
    for (let at = 0; at < blob.size; at += 1024 * 1024) {
      const block = new Uint8Array(
        await blob.slice(at, at + 1024 * 1024).arrayBuffer(),
      );
      for (const byte of block)
        crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipHeader(size, fields) {
    const view = new DataView(new ArrayBuffer(size));
    fields.forEach(([offset, bytes, value]) => {
      if (bytes === 4) view.setUint32(offset, value, true);
      else view.setUint16(offset, value, true);
    });
    return view.buffer;
  }

  async function zip(entries) {
    if (!Array.isArray(entries) || entries.length > 65535)
      throw Error("This package exceeds the ZIP entry limit.");
    const files = [],
      directory = [],
      paths = new Set();
    let offset = 0,
      directorySize = 0;
    for (const entry of entries) {
      const path = String(entry.name || "").normalize("NFC");
      if (
        /^[a-z]:/i.test(path) ||
        /[\\\x00-\x1f]/.test(path) ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      ) {
        throw Error(
          "An archive filename is invalid. Please revise the filename.",
        );
      }
      const key = path.toLowerCase();
      if (paths.has(key))
        throw Error("The package contains two files with the same name.");
      paths.add(key);
      const name = utf8.encode(path);
      if (name.length > 65535) throw Error("The archive filename is too long.");
      const blob =
        entry.data instanceof Blob ? entry.data : new Blob([entry.data]);
      if (blob.size > 0xffffffff || offset + blob.size > 0xffffff00)
        throw Error("This archive exceeds the 4 GB ZIP limit.");
      const crc = await crc32(blob);
      const common = [
        [4, 2, 20],
        [6, 2, 0x800],
        [12, 2, 0x21],
        [14, 4, crc],
        [18, 4, blob.size],
        [22, 4, blob.size],
        [26, 2, name.length],
      ];
      files.push(zipHeader(30, [[0, 4, 0x04034b50], ...common]), name, blob);
      directory.push(
        zipHeader(46, [
          [0, 4, 0x02014b50],
          [4, 2, 20],
          ...common.map(([i, n, v]) => [i + 2, n, v]),
          [42, 4, offset],
        ]),
        name,
      );
      offset += 30 + name.length + blob.size;
      directorySize += 46 + name.length;
    }
    if (offset + directorySize > 0xffffffff)
      throw Error("This archive exceeds the ZIP limit.");
    const end = zipHeader(22, [
      [0, 4, 0x06054b50],
      [8, 2, entries.length],
      [10, 2, entries.length],
      [12, 4, directorySize],
      [16, 4, offset],
    ]);
    return new Blob([...files, ...directory, end], { type: "application/zip" });
  }

  let face;
  function typeface() {
    if (face) return face;
    if (!globalThis.PM_PDF_FONT)
      throw Error(
        "The PDF font is unavailable. Reopen the installed app after cache verification.",
      );
    const bytes = Uint8Array.from(atob(globalThis.PM_PDF_FONT), (ch) =>
      ch.charCodeAt(0),
    );
    const v = new DataView(bytes.buffer);
    const u16 = (n) => v.getUint16(n),
      i16 = (n) => v.getInt16(n),
      u32 = (n) => v.getUint32(n);
    const table = {};
    for (let idx = 0; idx < u16(4); idx++) {
      const at = 12 + idx * 16;
      table[String.fromCharCode(...bytes.subarray(at, at + 4))] = u32(at + 8);
    }
    const units = u16(table.head + 18),
      cmap = table.cmap;
    let format4, format12;
    for (let idx = 0; idx < u16(cmap + 2); idx++) {
      const pos = cmap + 4 + 8 * idx,
        sub = cmap + u32(pos + 4);
      if (u16(pos) !== 0 && u16(pos) !== 3) continue;
      if (u16(sub) === 4) format4 = sub;
      if (u16(sub) === 12) format12 = sub;
    }
    const cache = new Map();
    function metrics(ch) {
      if (cache.has(ch)) return cache.get(ch);
      const code = ch.codePointAt(0);
      let glyph = 0;
      if (format12) {
        let lo = 0,
          hi = u32(format12 + 12) - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1,
            pos = format12 + 16 + 12 * mid;
          if (code < u32(pos)) hi = mid - 1;
          else if (code > u32(pos + 4)) lo = mid + 1;
          else {
            glyph = u32(pos + 8) + code - u32(pos);
            break;
          }
        }
      }
      if (!glyph && format4 && code <= 65535) {
        const count = u16(format4 + 6) / 2,
          ends = format4 + 14,
          starts = ends + 2 * count + 2;
        for (let i = 0; i < count; i++) {
          if (code > u16(ends + 2 * i)) continue;
          const start = u16(starts + 2 * i);
          if (code < start) break;
          const delta = i16(starts + 2 * count + 2 * i),
            rangeAt = starts + 4 * count + 2 * i,
            range = u16(rangeAt);
          if (!range) glyph = (code + delta) & 65535;
          else {
            const initial = u16(rangeAt + range + (code - start) * 2);
            glyph = initial ? (initial + delta) & 65535 : 0;
          }
          break;
        }
      }
      if (!glyph)
        throw Object.assign(Error(
          "The PDF typeface cannot render the character “" +
            ch +
            "”. Use the printable HTML version to preserve this text.",
        ), {code: "PDF_TEXT_UNSUPPORTED"});
      const horizontal = Math.min(glyph, u16(table.hhea + 34) - 1);
      const item = {
        glyph,
        width: Math.round((u16(table.hmtx + 4 * horizontal) * 1000) / units),
      };
      cache.set(ch, item);
      return item;
    }
    face = { bytes, metrics };
    return face;
  }

  function pdf(title, sections = []) {
    const { bytes, metrics } = typeface();
    const chars = new Map(),
      cidTable = [0],
      widths = [];
    const hex = (n) => n.toString(16).padStart(4, "0");
    const normalize = (s) => {
      const value = String(s ?? "")
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "    ")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
      if (
        /[\u0590-\u109f\u1780-\u18af\u200c-\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufeff]/u.test(
          value,
        )
      ) {
        throw Object.assign(Error(
          "This text needs script shaping or right-to-left layout. Use the printable HTML version to preserve its reading order.",
        ), {code: "PDF_TEXT_UNSUPPORTED"});
      }
      return value;
    };
    const encode = (s) =>
      Array.from(s, (ch) => {
        if (!chars.has(ch)) {
          if (chars.size >= 65534)
            throw Error("Too many distinct characters in this PDF.");
          const cid = chars.size + 1,
            m = metrics(ch);
          chars.set(ch, cid);
          cidTable.push(m.glyph);
          widths.push(m.width);
        }
        return hex(chars.get(ch));
      }).join("");
    const measure = (s, size) =>
      Array.from(s).reduce((w, ch) => w + (metrics(ch).width * size) / 1000, 0);
    function wrap(value, size, max = 508) {
      const result = [];
      for (const sourceLine of normalize(value).split("\n")) {
        let line = "";
        for (let word of sourceLine.trim().split(/\s+/u)) {
          const joined = line ? line + " " + word : word;
          if (measure(joined, size) <= max) {
            line = joined;
            continue;
          }
          if (line) result.push(line);
          line = "";
          if (measure(word, size) <= max) {
            line = word;
            continue;
          }
          for (const letter of word) {
            if (line && measure(line + letter, size) > max) {
              result.push(line);
              line = "";
            }
            line += letter;
          }
        }
        result.push(line);
      }
      return result;
    }
    const pages = [];
    let ops, y;
    const text = (s, size, x, baseline, color = "0.13 0.17 0.20") => {
      ops.push(
        "BT /F " +
          size +
          " Tf " +
          color +
          " rg 1 0 0 1 " +
          x +
          " " +
          baseline +
          " Tm <" +
          encode(s) +
          "> Tj ET",
      );
    };
    const rule = (baseline) =>
      ops.push(
        "0.76 0.80 0.79 RG 0.55 w 52 " +
          baseline +
          " m 560 " +
          baseline +
          " l S",
      );
    function page() {
      ops = [];
      pages.push(ops);
      text("PROPERTY MANAGER", 9, 52, 751, "0.17 0.38 0.32");
      rule(739);
      y = 709;
    }
    function ensure(height) {
      if (y - height < 65) page();
    }
    page();
    wrap(title, 23).forEach((s) => {
      ensure(29);
      text(s, 23, 52, y);
      y -= 29;
    });
    y -= 5;
    for (const section of sections) {
      const captions = section.heading ? wrap(section.heading, 14) : [];
      const bodySize = section.bodySize === 12 ? 12 : 10.5;
      const lines = (
        Array.isArray(section.lines) ? section.lines : [section.lines ?? ""]
      ).flatMap((line) => wrap(line, bodySize));
      const groupHeight = captions.length * 20 + lines.length * 16 + 19;
      const keep =
        section.keepTogether || /signatur|signer/i.test(section.heading || "");
      ensure(
        keep && groupHeight <= 625
          ? groupHeight
          : captions.length * 20 + Math.min(lines.length, 2) * 16 + 6,
      );
      captions.forEach((s) => {
        ensure(20);
        text(s, 14, 52, y, "0.14 0.32 0.27");
        y -= 20;
      });
      lines.forEach((s) => {
        ensure(16);
        text(s, bodySize, 52, y);
        y -= 16;
      });
      y -= 14;
    }
    pages.forEach((items, index) => {
      ops = items;
      rule(48);
      text("Property Manager", 8.5, 52, 32);
      const label = "Page " + (index + 1) + " of " + pages.length;
      text(label, 8.5, (560 - measure(label, 8.5)).toFixed(2), 32);
    });
    const objects = [null];
    const add = (data) => {
      objects.push(data);
      return objects.length - 1;
    };
    const ref = (id) => id + " 0 R";
    const stream = (data, extra = "") => {
      const binary = typeof data === "string" ? utf8.encode(data) : data;
      return new Blob([
        "<< /Length " + binary.byteLength + " " + extra + " >>\nstream\n",
        binary,
        "\nendstream",
      ]);
    };
    const catalog = add(null),
      tree = add(null),
      fontFile = add(stream(bytes, "/Length1 " + bytes.length));
    const descriptor = add(
      "<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-665 -324 2000 1100] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 688 /StemV 80 /FontFile2 " +
        ref(fontFile) +
        " >>",
    );
    const mapData = new Uint8Array(cidTable.length * 2);
    cidTable.forEach((glyph, idx) => {
      mapData[idx * 2] = glyph >> 8;
      mapData[idx * 2 + 1] = glyph & 255;
    });
    const glyphMap = add(stream(mapData));
    const cid = add(
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor " +
        ref(descriptor) +
        " /CIDToGIDMap " +
        ref(glyphMap) +
        " /W [1 [" +
        widths.join(" ") +
        "]] >>",
    );
    const pairs = Array.from(
      chars,
      ([ch, id]) =>
        "<" +
        hex(id) +
        "> <" +
        Array.from({ length: ch.length }, (_, i) => hex(ch.charCodeAt(i))).join(
          "",
        ) +
        ">",
    );
    const map = [
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /PMUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange",
    ];
    for (let i = 0; i < pairs.length; i += 100)
      map.push(
        Math.min(100, pairs.length - i) + " beginbfchar",
        ...pairs.slice(i, i + 100),
        "endbfchar",
      );
    map.push("endcmap CMapName currentdict /CMap defineresource pop end end");
    const unicode = add(stream(map.join("\n")));
    const font = add(
      "<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [" +
        ref(cid) +
        "] /ToUnicode " +
        ref(unicode) +
        " >>",
    );
    const pageIds = pages.map((commands) => {
      const content = add(stream(commands.join("\n")));
      return add(
        "<< /Type /Page /Parent " +
          ref(tree) +
          " /MediaBox [0 0 612 792] /Resources << /Font << /F " +
          ref(font) +
          " >> >> /Contents " +
          ref(content) +
          " >>",
      );
    });
    objects[catalog] = "<< /Type /Catalog /Pages " + ref(tree) + " >>";
    objects[tree] =
      "<< /Type /Pages /Count " +
      pages.length +
      " /Kids [" +
      pageIds.map(ref).join(" ") +
      "] >>";
    const chunks = [
      utf8.encode("%PDF-1.7\n%"),
      new Uint8Array([226, 227, 207, 211, 10]),
    ];
    let length = chunks.reduce((n, item) => n + item.byteLength, 0);
    const offsets = ["0000000000 65535 f "];
    objects.slice(1).forEach((data, i) => {
      offsets.push(String(length).padStart(10, "0") + " 00000 n ");
      const obj = new Blob([i + 1 + " 0 obj\n", data, "\nendobj\n"]);
      chunks.push(obj);
      length += obj.size;
    });
    chunks.push(
      "xref\n0 " +
        objects.length +
        "\n" +
        offsets.join("\n") +
        "\ntrailer\n<< /Size " +
        objects.length +
        " /Root " +
        ref(catalog) +
        " >>\nstartxref\n" +
        length +
        "\n%%EOF\n",
    );
    return new Blob(chunks, { type: "application/pdf" });
  }

  globalThis.Files = Object.freeze({ pdf, zip });
})();
