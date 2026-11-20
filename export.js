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

  const hex = (n) => n.toString(16).padStart(4, "0");
  const tidy = (s) =>
    String(s ?? "")
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "    ")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  // Glyphs are placed one per character from left to right, without shaping.
  function linear(value) {
    if (
      /[\u0590-\u109f\u1780-\u18af\u200c-\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufeff]/u.test(
        value,
      )
    ) {
      throw Object.assign(
        Error(
          "This text needs script shaping or right-to-left layout. Use the printable HTML version to preserve its reading order.",
        ),
        { code: "PDF_TEXT_UNSUPPORTED" },
      );
    }
    return value;
  }
  const normalize = (s) => linear(tidy(s));

  // Every PDF numbers its characters in order of first use.
  function glyphSet(metrics) {
    const chars = new Map(),
      cidTable = [0],
      widths = [];
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
    return { chars, cidTable, widths, encode, measure };
  }

  // Writes the embedded font, one content stream per page and the file
  // structure. A title adds the document language and information.
  function assemble(bytes, { chars, cidTable, widths }, pages, title) {
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
    const described = title !== undefined;
    objects[catalog] =
      "<< /Type /Catalog /Pages " +
      ref(tree) +
      (described ? " /Lang (en-US)" : "") +
      (title ? " /ViewerPreferences << /DisplayDocTitle true >>" : "") +
      " >>";
    objects[tree] =
      "<< /Type /Pages /Count " +
      pages.length +
      " /Kids [" +
      pageIds.map(ref).join(" ") +
      "] >>";
    const info = described
      ? add(
          "<< /Title <feff" +
            Array.from({ length: title.length }, (_, i) =>
              hex(title.charCodeAt(i)),
            ).join("") +
            "> /Producer (Property Manager) >>",
        )
      : 0;
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
        (info ? " /Info " + ref(info) : "") +
        " >>\nstartxref\n" +
        length +
        "\n%%EOF\n",
    );
    return new Blob(chunks, { type: "application/pdf" });
  }

  function pdf(title, sections = []) {
    const { bytes, metrics } = typeface();
    const glyphs = glyphSet(metrics);
    const { encode, measure } = glyphs;
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
    return assemble(bytes, glyphs, pages);
  }

  /* Block documents: one model, rendered to PDF by pdfDoc and to HTML by
     htmlDoc, so a preview, a printable page and a PDF carry the same text.

     doc = { title, footer, watermark, blocks }. A block is one of:
       { t: "title", text, sub }            centered title and subtitle lines
       { t: "h1", text, breakBefore }       major heading with a rule
       { t: "h2", text }                    section heading, kept with its text
       { t: "p", text | runs, size, bold, indent, align, after }
       { t: "list", items, style, indent }  alpha, number, bullet or none
       { t: "kv", rows }                    [label, value] key terms
       { t: "notice", heading, paras, size, frame }  box, bar or none
       { t: "check", text | runs, checked, indent }  drawn checkbox
       { t: "sign", parties, withDate }     [{ role, name }] signature lines
       { t: "rule" } { t: "space", h } { t: "pagebreak" } { t: "keep", blocks }
     Sizes, indents and spaces are in points. runs is [{ text, bold }]; a list
     item, table value or notice paragraph may be a string or runs. Text may
     hold line breaks. Blocks with no text print nothing. */
  const LIST_STYLES = ["alpha", "number", "bullet", "none"],
    NOTICE_FRAMES = ["none", "box", "bar"],
    ALIGNMENTS = ["left", "center"];
  const flat = (s) => tidy(s).replace(/\s+/gu, " ").trim();

  // Inline content becomes hard lines of { text, bold } spans.
  function rich(value, bold = false) {
    const lines = [[]];
    for (const run of Array.isArray(value) ? value : [value]) {
      const styled = run !== null && typeof run === "object";
      const strong = bold || (styled && !!run.bold);
      tidy(styled ? run.text : run)
        .split("\n")
        .forEach((text, index) => {
          if (index) lines.push([]);
          const line = lines[lines.length - 1],
            last = line[line.length - 1];
          if (!text) return;
          if (last && last.bold === strong) last.text += text;
          else line.push({ text, bold: strong });
        });
    }
    const blank = (line) => !line.some((span) => /\S/u.test(span.text));
    while (lines.length && blank(lines[lines.length - 1])) lines.pop();
    while (lines.length && blank(lines[0])) lines.shift();
    return lines;
  }

  // Validates a document and fills in defaults. Blocks without text drop out.
  function model(doc) {
    const source = doc !== null && typeof doc === "object" ? doc : {};
    const amount = (value, fallback, min, max) => {
      const n = value == null || value === "" ? NaN : Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const choice = (value, options, what, path) => {
      if (value == null) return options[0];
      if (!options.includes(value))
        throw Error(
          "Unknown " + what + " “" + String(value) + "” at " + path + ".",
        );
      return value;
    };
    const marker = (style, index) =>
      style === "alpha"
        ? "(" +
          String.fromCharCode(97 + (index % 26)).repeat(
            Math.floor(index / 26) + 1,
          ) +
          ")"
        : style === "number"
          ? index + 1 + "."
          : style === "bullet"
            ? "•"
            : "";
    const inline = (item, bold) =>
      rich(
        Array.isArray(item.runs) && item.runs.length ? item.runs : item.text,
        bold,
      );
    const list = (value) => (Array.isArray(value) ? value : []);
    const all = (blocks, path) => {
      if (blocks != null && !Array.isArray(blocks))
        throw Error("Document blocks must be an array at " + path + ".");
      return list(blocks)
        .map((item, index) => shape(item, path + "[" + index + "]"))
        .filter(Boolean);
    };
    function shape(item, path) {
      const t = item !== null && typeof item === "object" ? item.t : undefined;
      switch (t) {
        case "title": {
          const text = rich(item.text, true),
            sub = Array.isArray(item.sub) ? item.sub.join("\n") : item.sub;
          return text.length ? { t, text, sub: rich(sub) } : null;
        }
        case "h1":
        case "h2": {
          const text = rich(item.text, true);
          return text.length
            ? { t, text, breakBefore: t === "h1" && !!item.breakBefore }
            : null;
        }
        case "p": {
          const text = inline(item, !!item.bold),
            align = choice(item.align, ALIGNMENTS, "paragraph alignment", path);
          return text.length
            ? {
                t,
                text,
                align,
                size: amount(item.size, 10.5, 4, 144),
                indent: amount(item.indent, 0, 0, 360),
                after: amount(item.after, 6, 0, 720),
              }
            : null;
        }
        case "list": {
          const style = choice(item.style, LIST_STYLES, "list style", path);
          const items = list(item.items)
            .map((entry) => rich(entry))
            .filter((text) => text.length)
            .map((text, index) => ({ marker: marker(style, index), text }));
          return items.length
            ? { t, style, items, indent: amount(item.indent, 14, 0, 360) }
            : null;
        }
        case "kv": {
          const rows = list(item.rows)
            .map((row, index) => {
              if (!Array.isArray(row))
                throw Error(
                  "A key-terms row must be [label, value] at " +
                    path +
                    ".rows[" +
                    index +
                    "].",
                );
              return { label: rich(row[0], true), value: rich(row[1]) };
            })
            .filter((row) => row.label.length || row.value.length);
          return rows.length ? { t, rows } : null;
        }
        case "notice": {
          const frame = choice(item.frame, NOTICE_FRAMES, "notice frame", path),
            heading = rich(item.heading, true);
          const paras = (Array.isArray(item.paras) ? item.paras : [item.paras])
            .map((para) => rich(para))
            .filter((text) => text.length);
          return heading.length || paras.length
            ? { t, frame, heading, paras, size: amount(item.size, 12, 4, 144) }
            : null;
        }
        case "check": {
          const text = inline(item, false);
          return text.length
            ? {
                t,
                text,
                checked: item.checked === true,
                indent: amount(item.indent, 0, 0, 360),
              }
            : null;
        }
        case "sign": {
          const parties = list(item.parties)
            .filter((party) => party !== null && typeof party === "object")
            .map((party) => ({
              caption: rich(
                [flat(party.role), flat(party.name)].filter(Boolean).join(": "),
              ),
            }));
          return parties.length
            ? { t, parties, withDate: item.withDate !== false }
            : null;
        }
        case "rule":
        case "pagebreak":
          return { t };
        case "space": {
          const h = amount(item.h, 0, 0, 720);
          return h ? { t, h } : null;
        }
        case "keep": {
          const blocks = all(item.blocks, path + ".blocks");
          return blocks.length ? { t, blocks } : null;
        }
        default:
          throw Error(
            "Unknown document block type “" +
              String(t) +
              "” at " +
              path +
              ".",
          );
      }
    }
    return {
      title: flat(source.title),
      footer: flat(source.footer),
      watermark: flat(source.watermark),
      blocks: all(source.blocks, "blocks"),
    };
  }

  function pdfDoc(doc) {
    const { bytes, metrics } = typeface();
    const glyphs = glyphSet(metrics);
    const { title, footer, watermark, blocks } = model(doc);
    // U.S. Letter with 64 pt side margins, 62 pt above and 64 pt below.
    const LEFT = 64,
      RIGHT = 548,
      TOP = 730,
      WIDTH = RIGHT - LEFT,
      HEIGHT = TOP - 64;
    const INK = "0.10 0.10 0.10",
      GRAY = "0.40 0.40 0.40",
      HAIR = "0.72 0.72 0.72";
    const BODY = 10.5,
      LEAD = 14.5 / 10.5;
    const n = (value) => String(Math.round(value * 100) / 100);
    // Invisible formatting characters go; no-break spaces share one glyph.
    const printable = (s) =>
      linear(
        s
          .replace(/[\u00ad\u200b\u2060\ufeff]/g, "")
          .replace(/[\u2007\u202f]/g, "\u00a0"),
      );
    const wide = (s, size) => {
      let units = 0;
      for (const ch of s) units += metrics(ch).width;
      return (units * size) / 1000;
    };

    // Breaks one hard line of spans into printed lines of { text, bold, x }
    // segments. Words are separated by one space; a no-break space never wraps.
    function wrap(spans, size, max) {
      const space = wide(" ", size),
        words = [];
      let word;
      for (const span of spans)
        printable(span.text)
          .split(/([^\S\u00a0]+)/u)
          .forEach((part, index) => {
            if (index % 2) word = null;
            else if (part) {
              if (!word) words.push((word = []));
              const last = word[word.length - 1];
              if (last && last.bold === span.bold) last.text += part;
              else word.push({ text: part, bold: span.bold });
            }
          });
      const sum = (parts) =>
        parts.reduce((w, part) => w + wide(part.text, size), 0);
      // A token wider than the line is cut, after URL punctuation if possible.
      const cut = (parts) => {
        const letters = parts.flatMap((part) =>
          Array.from(part.text, (text) => ({ text, bold: part.bold })),
        );
        let count = 0,
          used = 0;
        for (; count < letters.length; count++) {
          used += wide(letters[count].text, size);
          if (count && used > max + 0.001) break;
        }
        for (let at = count; at > 1 && at > count * 0.6; at--)
          if (/[\/\\\-_.?&=#:;,@%+]/.test(letters[at - 1].text)) {
            count = at;
            break;
          }
        const merge = (list) =>
          list.reduce((out, letter) => {
            const last = out[out.length - 1];
            if (last && last.bold === letter.bold) last.text += letter.text;
            else out.push({ ...letter });
            return out;
          }, []);
        return [merge(letters.slice(0, count)), merge(letters.slice(count))];
      };
      const lines = [];
      let line = [],
        used = 0;
      for (let parts of words) {
        let width = sum(parts);
        if (line.length && used + space + width > max + 0.001) {
          lines.push(line);
          line = [];
          used = 0;
        }
        while (!line.length && width > max + 0.001) {
          const [head, rest] = cut(parts);
          if (!rest.length) break;
          lines.push([head]);
          parts = rest;
          width = sum(parts);
        }
        used += (line.length ? space : 0) + width;
        line.push(parts);
      }
      if (line.length || !lines.length) lines.push(line);
      return lines.map((entries) => {
        const segs = [];
        let x = 0;
        entries.forEach((parts, index) => {
          if (index) x += space;
          parts.forEach((part, inner) => {
            const last = segs[segs.length - 1];
            if (last && last.bold === part.bold)
              last.text += (index && !inner ? " " : "") + part.text;
            else segs.push({ ...part, x });
            x += wide(part.text, size);
          });
        });
        return { segs, width: x };
      });
    }
    const flow = (content, size, max) =>
      content.flatMap((hard) => wrap(hard, size, max));

    // Drawing. Every piece of text is one BT ... ET line with a single Tj.
    // Bold is the regular face filled and stroked (text render mode 2).
    let ops, mode;
    const text = (s, size, x, y, bold, color = INK) => {
      let state = "";
      if (bold) state = "2 Tr " + n(size * 0.032) + " w " + color + " RG ";
      else if (mode) state = "0 Tr ";
      mode = bold ? 2 : 0;
      ops.push(
        "BT /F " +
          n(size) +
          " Tf " +
          state +
          color +
          " rg 1 0 0 1 " +
          n(x) +
          " " +
          n(y) +
          " Tm <" +
          glyphs.encode(s) +
          "> Tj ET",
      );
    };
    const stroke = (path, width = 0.5, color = HAIR) =>
      ops.push(color + " RG " + n(width) + " w " + path + " S");
    const across = (y, from = LEFT, to = RIGHT) =>
      n(from) + " " + n(y) + " m " + n(to) + " " + n(y) + " l";
    const put = (line, size, x, y) => {
      for (const seg of line.segs)
        text(seg.text, size, x + seg.x, y, seg.bold);
    };
    // Distance from the top of a line box to its baseline.
    const rise = (size, lead) => lead / 2 + 0.3465 * size;

    // Layout. A page is filled with slabs (unbreakable printed boxes), glue
    // (explicit space) and forced breaks. `link` is the cost of ending a page
    // right after a slab; margins between slabs collapse to the larger one.
    const slab = (h, draw, more) => ({
      h,
      before: 0,
      after: 0,
      link: 0,
      draw,
      ...more,
    });
    const first = (item, draw) => {
      const inner = item.draw;
      item.draw = (top) => {
        draw(top);
        inner(top);
      };
    };
    const pad = (item, above, below) => {
      const inner = item.draw;
      item.h += above + below;
      item.draw = (top) => inner(top - above);
    };
    const tie = (item, cost) => (item.link = Math.max(item.link, cost));
    // One slab per printed line, set flush left or centered in `max`.
    const rowsOf = (content, size, lead, x, max, centered) =>
      flow(content, size, max).map((line) =>
        slab(lead, (top) =>
          put(
            line,
            size,
            centered ? x + (max - line.width) / 2 : x,
            top - rise(size, lead),
          ),
        ),
      );
    // A paragraph never strands a single line at the top or bottom of a page.
    const prose = (content, size, x, max, centered) => {
      const rows = rowsOf(content, size, size * LEAD, x, max, centered);
      if (rows.length > 1) rows[0].link = rows[rows.length - 2].link = 100;
      return rows;
    };
    // The lines of a heading stay together.
    const stack = (content, size, lead, x, max, centered) => {
      const rows = rowsOf(content, size, lead, x, max, centered);
      for (const row of rows.slice(0, -1)) row.link = 10000;
      return rows;
    };
    // Sets the space around a group of slabs and marks its last one.
    const edged = (rows, before, after, more) => {
      rows[0].before = before;
      Object.assign(rows[rows.length - 1], { after }, more);
      return rows;
    };
    const blank = () => ({ rows: [], y: 0, gap: 0, glue: 0 });
    const offset = (page, item) =>
      !page.rows.length
        ? page.glue
        : page.glue
          ? page.y + page.gap + page.glue + item.before
          : page.y + Math.max(page.gap, item.before);
    const place = (page, item) => {
      const top = offset(page, item);
      page.rows.push({ item, top });
      page.y = top + item.h;
      page.gap = item.after;
      page.glue = 0;
    };
    // Height of items stacked from the top of a page.
    const extent = (items) => {
      const page = blank();
      for (const item of items)
        if (item.draw) place(page, item);
        else if (item.glue) page.glue += item.h;
      return page.y;
    };

    function lay(block, out) {
      switch (block.t) {
        case "title": {
          const main = stack(block.text, 20, 25, LEFT, WIDTH, true),
            sub = stack(block.sub, 11, 15.5, LEFT, WIDTH, true);
          if (sub.length) main[main.length - 1].link = 10000;
          out.push(...edged(main, 0, 4), ...sub);
          out[out.length - 1].after = 16;
          break;
        }
        case "h1": {
          if (block.breakBefore) out.push({ brk: true });
          const rows = stack(block.text, 13, 17, LEFT, WIDTH),
            last = rows[rows.length - 1];
          // A thin rule runs under the heading, inside its own slab.
          first(last, (top) =>
            stroke(across(top - 20), 0.75, "0.35 0.35 0.35"),
          );
          last.h += 4;
          out.push(...edged(rows, 16, 8, { head: true }));
          break;
        }
        case "h2":
          out.push(
            ...edged(stack(block.text, 11.5, 15.5, LEFT, WIDTH), 10, 2, {
              head: true,
            }),
          );
          break;
        case "p": {
          const rows = prose(
            block.text,
            block.size,
            LEFT + block.indent,
            WIDTH - block.indent,
            block.align === "center",
          );
          rows[rows.length - 1].after = block.after;
          out.push(...rows);
          break;
        }
        case "list": {
          const x = LEFT + block.indent,
            lead = BODY * LEAD;
          const column =
            block.style === "none"
              ? 0
              : Math.max(
                  BODY * 1.1,
                  ...block.items.map(
                    (item) => wide(item.marker, BODY) + BODY / 2,
                  ),
                );
          block.items.forEach((item, index) => {
            const rows = prose(item.text, BODY, x + column, RIGHT - x - column);
            if (item.marker)
              first(rows[0], (top) =>
                text(item.marker, BODY, x, top - rise(BODY, lead)),
              );
            rows[rows.length - 1].after =
              index < block.items.length - 1 ? 3 : 6;
            out.push(...rows);
          });
          break;
        }
        case "kv": {
          const lead = BODY * LEAD,
            split = LEFT + 150,
            start = out.length;
          const edge = (top) => stroke(across(top));
          for (const row of block.rows) {
            const label = flow(row.label, BODY, 140),
              value = flow(row.value, BODY, RIGHT - split),
              count = Math.max(label.length, value.length);
            // The label prints with the first line, so its lines stay together.
            const rows = Array.from({ length: count }, (_, index) =>
              slab(
                lead,
                (top) => {
                  const y = top - rise(BODY, lead);
                  if (!index)
                    label.forEach((line, at) =>
                      put(line, BODY, LEFT, y - at * lead),
                    );
                  if (value[index]) put(value[index], BODY, split, y);
                },
                {
                  frame: edge,
                  link:
                    index < count - 1 &&
                    (count <= 8 || index < label.length - 1)
                      ? 10000
                      : 0,
                },
              ),
            );
            if (count > 8) {
              tie(rows[0], 100);
              tie(rows[count - 2], 100);
            }
            pad(rows[0], 4, 0);
            pad(rows[count - 1], 0, 4);
            const last = rows[count - 1],
              inner = last.draw;
            last.draw = (top) => {
              inner(top);
              edge(top - last.h);
            };
            out.push(...rows);
          }
          out[start].before = 4;
          out[out.length - 1].after = 10;
          break;
        }
        case "notice": {
          const size = block.size,
            lead = size * LEAD;
          const build = (frame) => {
            const inset = frame === "box" ? 10 : frame === "bar" ? 12 : 0,
              x = LEFT + inset,
              max = WIDTH - inset - (frame === "box" ? 10 : 0),
              rows = [];
            if (block.heading.length)
              rows.push(
                ...edged(
                  stack(block.heading, size, lead, x, max),
                  0,
                  size * 0.3,
                  { head: true },
                ),
              );
            block.paras.forEach((para, index) => {
              const part = prose(para, size, x, max);
              part[part.length - 1].after =
                index < block.paras.length - 1 ? size * 0.5 : 0;
              rows.push(...part);
            });
            if (frame === "box") {
              pad(rows[0], 10, 0);
              pad(rows[rows.length - 1], 0, 10);
              for (const row of rows.slice(0, -1)) tie(row, 10000);
            }
            return rows;
          };
          let frame = block.frame,
            rows = build(frame);
          // A box that cannot fit on one page flows with a side rule instead.
          if (frame === "box" && extent(rows) > HEIGHT)
            rows = build((frame = "bar"));
          const outline =
            frame === "box"
              ? (top, bottom) =>
                  stroke(
                    n(LEFT + 0.4) +
                      " " +
                      n(bottom + 0.4) +
                      " " +
                      n(WIDTH - 0.8) +
                      " " +
                      n(top - bottom - 0.8) +
                      " re",
                    0.8,
                    "0.25 0.25 0.25",
                  )
              : frame === "bar"
                ? (top, bottom) =>
                    stroke(
                      n(LEFT + 1) +
                        " " +
                        n(top) +
                        " m " +
                        n(LEFT + 1) +
                        " " +
                        n(bottom) +
                        " l",
                      2,
                      "0.35 0.35 0.35",
                    )
                : null;
          if (outline) for (const row of rows) row.frame = outline;
          rows[0].before = 8;
          rows[rows.length - 1].after = 10;
          out.push(...rows);
          break;
        }
        case "check": {
          const x = LEFT + block.indent,
            rows = prose(block.text, BODY, x + 16, RIGHT - x - 16);
          // The box is drawn, so it never depends on a font glyph.
          first(rows[0], (top) => {
            const y = top - rise(BODY, BODY * LEAD) - 1;
            stroke(n(x + 0.4) + " " + n(y + 0.4) + " 8.2 8.2 re", 0.8, INK);
            if (block.checked)
              ops.push(
                INK +
                  " RG 1.1 w 1 J " +
                  [
                    [2.3, 2.3, "m"],
                    [6.7, 6.7, "l"],
                    [2.3, 6.7, "m"],
                    [6.7, 2.3, "l"],
                  ]
                    .map(
                      ([dx, dy, op]) => n(x + dx) + " " + n(y + dy) + " " + op,
                    )
                    .join(" ") +
                  " S 0 J",
              );
          });
          rows[rows.length - 1].after = 4;
          out.push(...rows);
          break;
        }
        case "sign":
          block.parties.forEach((party, index) => {
            const caption = flow(party.caption, 8.5, 250),
              more = index < block.parties.length - 1;
            // Blank space, the lines and their captions form one slab.
            out.push(
              slab(
                32 + Math.max(caption.length, 1) * 11,
                (top) => {
                  const y = top - 30,
                    under = y - 2 - rise(8.5, 11);
                  stroke(across(y, LEFT, LEFT + 250), 0.75, INK);
                  if (block.withDate)
                    stroke(across(y, LEFT + 274, LEFT + 394), 0.75, INK);
                  caption.forEach((line, at) =>
                    put(line, 8.5, LEFT, under - at * 11),
                  );
                  if (block.withDate) text("Date", 8.5, LEFT + 274, under);
                },
                {
                  before: index ? 0 : 6,
                  after: more ? 4 : 10,
                  link: more ? 3000 : 0,
                  signs: !index,
                },
              ),
            );
          });
          break;
        case "rule":
          out.push(
            slab(1, (top) => stroke(across(top - 0.5)), {
              before: 8,
              after: 8,
            }),
          );
          break;
        case "space":
          out.push({ glue: true, h: block.h });
          break;
        case "pagebreak":
          out.push({ brk: true });
          break;
        case "keep": {
          const inner = [];
          for (const child of block.blocks) lay(child, inner);
          if (!inner.some((item) => item.brk) && extent(inner) <= HEIGHT)
            for (const item of inner.filter((entry) => entry.draw).slice(0, -1))
              tie(item, 5000);
          out.push(...inner);
          break;
        }
      }
    }
    const items = [];
    for (const block of blocks) lay(block, items);
    // A heading stays with the two lines that follow it, and a signature
    // block takes the line before it along rather than open a page alone.
    const near = (from, step) => {
      for (let at = from + step; items[at] && !items[at].brk; at += step)
        if (items[at].draw) return at;
      return -1;
    };
    items.forEach((item, index) => {
      if (item.signs && near(index, -1) >= 0) tie(items[near(index, -1)], 2000);
      const one = item.head ? near(index, 1) : -1;
      if (one < 0) return;
      tie(item, 1000);
      const two = near(one, 1);
      if (two >= 0 && !items[two].head) tie(items[one], 200);
    });

    // When a page is full it ends at the cheapest break, preferring the last.
    const sheets = [];
    let page = blank(),
      breaks = [],
      keepGlue = true;
    const close = () => {
      sheets.push(page.rows);
      page = blank();
      breaks = [];
    };
    for (let at = 0; at < items.length; ) {
      const item = items[at];
      if (item.brk) {
        if (page.rows.length) close();
        page.glue = 0;
        keepGlue = true;
        at++;
      } else if (item.glue) {
        if (page.rows.length || keepGlue) page.glue += item.h;
        at++;
      } else if (
        page.rows.length &&
        offset(page, item) + item.h > HEIGHT + 0.01
      ) {
        const best = breaks.reduce((a, b) => (b.cost <= a.cost ? b : a));
        page.rows.length = best.rows;
        at = best.resume;
        close();
        keepGlue = false;
      } else {
        place(page, item);
        breaks.push({ rows: page.rows.length, resume: ++at, cost: item.link });
      }
    }
    if (page.rows.length || !sheets.length) sheets.push(page.rows);

    // Page furniture is checked against the typeface whatever the page count.
    const [head, foot, mark] = [title, footer, watermark].map(printable);
    wide(head + foot + mark, 8);
    // Shortens furniture text that would not fit on its line.
    const fit = (s, size, max) => {
      if (wide(s, size) <= max) return s;
      let kept = "";
      for (const ch of s) {
        if (wide(kept + ch + "…", size) > max) break;
        kept += ch;
      }
      return kept.trimEnd() + "…";
    };
    const pages = sheets.map((rows, index) => {
      ops = ["1 j"];
      mode = 0;
      if (mark) {
        // Light, diagonal and behind the text; long marks shrink to fit.
        const size =
            Math.floor(Math.min(96, (96 * 720) / wide(mark, 96)) * 100) / 100,
          half = wide(mark, size) / 2,
          lift = 0.344 * size;
        ops.push(
          "BT /F " +
            n(size) +
            " Tf 0.90 0.90 0.90 rg 0.6428 0.766 -0.766 0.6428 " +
            n(306 - 0.6428 * half + 0.766 * lift) +
            " " +
            n(396 - 0.766 * half - 0.6428 * lift) +
            " Tm <" +
            glyphs.encode(mark) +
            "> Tj ET",
        );
      }
      if (index && head) {
        text(fit(head, 8, WIDTH), 8, LEFT, 752, false, GRAY);
        stroke(across(745));
      }
      rows.forEach(({ item, top }, at) => {
        if (item.frame && item.frame !== rows[at - 1]?.item.frame) {
          let end = at;
          while (rows[end + 1]?.item.frame === item.frame) end++;
          item.frame(TOP - top, TOP - rows[end].top - rows[end].item.h);
        }
        item.draw(TOP - top);
      });
      const label = "Page " + (index + 1) + " of " + sheets.length,
        room = wide(label, 8);
      stroke(across(48));
      if (foot)
        text(fit(foot, 8, WIDTH - room - 18), 8, LEFT, 36, false, GRAY);
      text(label, 8, RIGHT - room, 36, false, GRAY);
      return ops;
    });
    return assemble(bytes, glyphs, pages, title);
  }

  // Styles for htmlDoc output on screen and in print. The reset under .doc
  // keeps a host page's own heading, paragraph and table rules out of the
  // document, so every part rule is written as a descendant of .doc.
  const docCss = [
    '.doc{box-sizing:border-box;position:relative;z-index:0;max-width:8.5in;margin:0 auto;padding:clamp(16px,6vw,.75in);overflow:clip;background:#fff;color:#1a1a1a;color-scheme:light;font:400 10.5pt/1.38 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","Liberation Sans",sans-serif;letter-spacing:normal;text-align:start;text-transform:none;overflow-wrap:anywhere;orphans:2;widows:2;-webkit-text-size-adjust:100%;text-size-adjust:100%}',
    ".doc.doc *{box-sizing:border-box;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-align:inherit;text-decoration:none;text-transform:inherit}",
    ".doc.doc strong{font-weight:700}",
    ".doc .doc-title{margin-bottom:16pt;font-size:20pt;line-height:1.25;font-weight:700;text-align:center}",
    ".doc .doc-sub{margin:-12pt 0 16pt;font-size:11pt;line-height:1.41;text-align:center}",
    ".doc .doc-h1{margin:16pt 0 8pt;padding-bottom:3pt;border-bottom:.75pt solid #595959;font-size:13pt;line-height:1.31;font-weight:700}",
    ".doc .doc-h1-break{margin-top:14pt;padding-top:14pt;border-top:1px dashed #b8b8b8;break-before:page;page-break-before:always}",
    ".doc .doc-h1-break:first-child,.doc .doc-watermark+.doc-h1-break{margin-top:0;padding-top:0;border-top:0}",
    ".doc .doc-h2{margin:10pt 0 2pt;font-size:11.5pt;line-height:1.35;font-weight:700}",
    ".doc .doc-h1,.doc .doc-h2,.doc .doc-notice-heading{break-after:avoid;page-break-after:avoid}",
    ".doc .doc-p{margin-bottom:6pt}",
    ".doc .doc-list{margin-bottom:6pt;list-style:none}",
    ".doc .doc-list li{display:flex;column-gap:.5em;margin-bottom:3pt}",
    ".doc .doc-list li:last-child{margin-bottom:0}",
    ".doc .doc-marker{flex:none;min-width:1.6em}",
    ".doc .doc-list-bullet .doc-marker{min-width:.6em}",
    ".doc .doc-item{flex:1;min-width:0}",
    ".doc .doc-kv{width:100%;margin:4pt 0 10pt;border-collapse:collapse;border-top:.5pt solid #b8b8b8}",
    ".doc .doc-kv th,.doc .doc-kv td{padding:4pt 0;border-bottom:.5pt solid #b8b8b8;text-align:start;vertical-align:top}",
    ".doc .doc-kv th{width:31%;padding-inline-end:10pt;font-weight:700}",
    ".doc .doc-kv tr{break-inside:avoid;page-break-inside:avoid}",
    ".doc .doc-notice{margin:8pt 0 10pt}",
    ".doc .doc-notice-box{padding:10pt;border:.8pt solid #404040;break-inside:avoid;page-break-inside:avoid}",
    ".doc .doc-notice-bar{padding-inline-start:11pt;border-inline-start:2pt solid #595959}",
    ".doc .doc-notice-heading{margin-bottom:.3em;font-weight:700}",
    ".doc .doc-notice p{margin-bottom:.5em}",
    ".doc .doc-notice p:last-child{margin-bottom:0}",
    ".doc .doc-check{display:flex;margin-bottom:4pt}",
    ".doc .doc-box{flex:none;width:9pt;height:9pt;margin-top:.2em;margin-inline-end:7pt;overflow:visible}",
    ".doc .doc-sign{margin:6pt 0 10pt}",
    ".doc .doc-sign-party{display:flex;flex-wrap:wrap;column-gap:24pt;margin-bottom:4pt}",
    ".doc .doc-sign-name{flex:0 1 250pt;min-width:0}",
    ".doc .doc-sign-date{flex:0 1 120pt;min-width:0}",
    ".doc .doc-sign-line{display:block;height:30pt;border-bottom:.75pt solid currentColor}",
    ".doc .doc-sign-caption{display:block;min-height:11pt;margin-top:2pt;font-size:8.5pt;line-height:11pt}",
    ".doc .doc-keep,.doc .doc-sign,.doc .doc-sign-party{break-inside:avoid;page-break-inside:avoid}",
    ".doc .doc-rule{height:0;margin:8pt 0;border-top:.5pt solid #b8b8b8}",
    ".doc .doc-break{height:0;margin:14pt 0;border-top:1px dashed #b8b8b8}",
    ".doc .doc-watermark{position:sticky;top:50vh;z-index:-1;height:0;pointer-events:none;-webkit-user-select:none;user-select:none}",
    ".doc .doc-watermark span{position:absolute;top:0;left:50%;transform:translate(-50%,-50%) rotate(-50deg);color:#e6e6e6;font-size:min(96pt,24vw);line-height:1;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    "@media print{.doc{max-width:none;margin:0;padding:0;overflow:visible}.doc .doc-h1-break{margin-top:0;padding-top:0;border-top:0}.doc .doc-break{margin:0;border:0;break-after:page;page-break-after:always}.doc .doc-watermark{position:fixed;top:50%;left:0;right:0}.doc .doc-watermark span{font-size:96pt}}",
    "@page{size:letter;margin:.75in}",
  ].join("\n");

  const escapeHtml = (s) =>
    s.replace(
      /[&<>"']/g,
      (ch) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ||
        "&#39;",
    );

  function htmlDoc(doc, options) {
    const { title, footer, watermark, blocks } = model(doc);
    const pt = (value) => Math.round(value * 100) / 100 + "pt";
    const plain = (lines) =>
      lines
        .map((line) => escapeHtml(line.map((span) => span.text).join("")))
        .join("<br>");
    const marked = (lines) =>
      lines
        .map((line) =>
          line
            .map((span) =>
              span.bold
                ? "<strong>" + escapeHtml(span.text) + "</strong>"
                : escapeHtml(span.text),
            )
            .join(""),
        )
        .join("<br>");
    const style = (...rules) => {
      const css = rules.filter(Boolean).join(";");
      return css ? ' style="' + css + '"' : "";
    };
    const inset = (points) => points && "margin-inline-start:" + pt(points);
    const draw = (block) => {
      switch (block.t) {
        case "title":
          return (
            '<h1 class="doc-title" dir="auto">' +
            plain(block.text) +
            "</h1>" +
            (block.sub.length
              ? '\n<p class="doc-sub" dir="auto">' + marked(block.sub) + "</p>"
              : "")
          );
        case "h1":
          return (
            '<h2 class="doc-h1' +
            (block.breakBefore ? " doc-h1-break" : "") +
            '" dir="auto">' +
            plain(block.text) +
            "</h2>"
          );
        case "h2":
          return '<h3 class="doc-h2" dir="auto">' + plain(block.text) + "</h3>";
        case "p":
          return (
            '<p class="doc-p" dir="auto"' +
            style(
              block.size !== 10.5 && "font-size:" + pt(block.size),
              inset(block.indent),
              block.after !== 6 && "margin-bottom:" + pt(block.after),
              block.align === "center" && "text-align:center",
            ) +
            ">" +
            marked(block.text) +
            "</p>"
          );
        case "list": {
          const tag =
            block.style === "alpha" || block.style === "number" ? "ol" : "ul";
          return (
            "<" +
            tag +
            ' class="doc-list doc-list-' +
            block.style +
            '"' +
            style(inset(block.indent)) +
            ">\n" +
            block.items
              .map(
                (item) =>
                  '<li dir="auto">' +
                  (item.marker
                    ? '<span class="doc-marker" dir="ltr">' +
                      escapeHtml(item.marker) +
                      "</span> "
                    : "") +
                  '<span class="doc-item">' +
                  marked(item.text) +
                  "</span></li>",
              )
              .join("\n") +
            "\n</" +
            tag +
            ">"
          );
        }
        case "kv":
          return (
            '<table class="doc-kv">\n<tbody>\n' +
            block.rows
              .map(
                (row) =>
                  '<tr><th scope="row" dir="auto">' +
                  plain(row.label) +
                  '</th><td dir="auto">' +
                  marked(row.value) +
                  "</td></tr>",
              )
              .join("\n") +
            "\n</tbody>\n</table>"
          );
        case "notice": {
          const size = style("font-size:" + pt(block.size));
          return (
            '<section class="doc-notice doc-notice-' +
            block.frame +
            '">\n' +
            (block.heading.length
              ? '<h4 class="doc-notice-heading" dir="auto"' +
                size +
                ">" +
                plain(block.heading) +
                "</h4>\n"
              : "") +
            block.paras
              .map(
                (para) => '<p dir="auto"' + size + ">" + marked(para) + "</p>",
              )
              .join("\n") +
            "\n</section>"
          );
        }
        case "check":
          return (
            '<p class="doc-check" dir="auto"' +
            style(inset(block.indent)) +
            '><svg class="doc-box" viewBox="0 0 9 9" role="img" aria-label="' +
            (block.checked ? "Checked" : "Not checked") +
            '"><rect x=".4" y=".4" width="8.2" height="8.2" fill="none" stroke="currentColor" stroke-width=".8"/>' +
            (block.checked
              ? '<path d="M2.3 2.3l4.4 4.4M6.7 2.3l-4.4 4.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'
              : "") +
            '</svg> <span class="doc-item">' +
            marked(block.text) +
            "</span></p>"
          );
        case "sign":
          return (
            '<div class="doc-sign">\n' +
            block.parties
              .map(
                (party) =>
                  '<div class="doc-sign-party"><div class="doc-sign-name"><span class="doc-sign-line"></span><span class="doc-sign-caption" dir="auto">' +
                  marked(party.caption) +
                  "</span></div>" +
                  (block.withDate
                    ? '<div class="doc-sign-date"><span class="doc-sign-line"></span><span class="doc-sign-caption">Date</span></div>'
                    : "") +
                  "</div>",
              )
              .join("\n") +
            "\n</div>"
          );
        case "rule":
          return '<hr class="doc-rule">';
        case "space":
          return (
            '<div class="doc-space"' + style("height:" + pt(block.h)) + "></div>"
          );
        case "pagebreak":
          return '<div class="doc-break"></div>';
        case "keep":
          return (
            '<div class="doc-keep">\n' +
            block.blocks.map(draw).join("\n") +
            "\n</div>"
          );
      }
    };
    const article =
      '<article class="doc">\n' +
      (watermark
        ? '<div class="doc-watermark"><span dir="auto">' +
          escapeHtml(watermark) +
          "</span></div>\n"
        : "") +
      blocks.map(draw).join("\n") +
      "\n</article>";
    if (!options || !options.standalone) return article;
    // Page margins repeat the title, footer and page count where supported.
    const quoted = (s) =>
      '"' +
      s.replace(
        /[^ !#-&(-;=?-\[\]-~]/gu,
        (ch) => "\\" + ch.codePointAt(0).toString(16) + " ",
      ) +
      '"';
    const edge = "font:8pt/1.2 system-ui,sans-serif;color:#666;",
      above =
        edge +
        "vertical-align:bottom;margin-bottom:9pt;padding-bottom:4pt;border-bottom:.5pt solid #b8b8b8;",
      below =
        edge +
        "vertical-align:top;margin-top:9pt;padding-top:5pt;border-top:.5pt solid #b8b8b8;";
    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">",
      "<title>" + escapeHtml(title || "Document") + "</title>",
      "<style>",
      docCss,
      "html{background:#eceff1}body{margin:0;padding:24px 12px}.doc{box-shadow:0 1px 4px rgba(0,0,0,.18)}",
      "@media print{html{background:none}body{padding:0}.doc{box-shadow:none}}",
      "@page{" +
        (title
          ? "@top-left{" +
            above +
            "content:" +
            quoted(title) +
            "}@top-right{" +
            above +
            'content:""}'
          : "") +
        "@bottom-left{" +
        below +
        "content:" +
        quoted(footer) +
        "}@bottom-right{" +
        below +
        'content:"Page " counter(page) " of " counter(pages)}}',
      "@page:first{@top-left{content:none}@top-right{content:none}}",
      "</style>",
      "</head>",
      "<body>",
      article,
      "</body>",
      "</html>",
      "",
    ].join("\n");
  }

  globalThis.Files = Object.freeze({ pdf, zip, pdfDoc, htmlDoc, docCss });
})();
